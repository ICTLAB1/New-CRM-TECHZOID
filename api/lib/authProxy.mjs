/**
 * Supabase Auth, reached through this API instead of from the browser.
 *
 * WHY THIS EXISTS. The CRM's data, files and API all moved to Azure. The one
 * thing still spoken from the browser to Supabase was the password check —
 * and on the office network `<ref>.supabase.co` answers NXDOMAIN, a DNS
 * resolver saying the name does not exist. The sign-in screen reports
 * "couldn't reach the server", which is accurate and useless: nothing about
 * the CRM is wrong, and nothing about the CRM could fix it.
 *
 * So the browser stops asking. It calls this origin, which it can plainly
 * reach — it just loaded the page from it — and the function app, which sits
 * in Azure with ordinary egress, does the asking. One hop moves, nothing
 * else: the same request, the same anon key, the same token comes back, and
 * `identity.mjs` verifies it exactly as before.
 *
 * WHAT IT WILL NOT DO, and why each one matters:
 *
 *   It forwards to ONE host, from configuration, never from the request. A
 *   proxy that takes its destination from the caller is an open relay: it
 *   would let anyone on the internet make this function app fetch anything,
 *   from an address inside Azure, with this app's reputation on it.
 *
 *   It forwards only `auth/v1/*`. The data path is `/api/q`, which checks a
 *   token and runs under row-level security. Forwarding `rest/v1` as well
 *   would quietly reopen the PostgREST surface this migration replaced.
 *
 *   It adds no credential of its own. The anon key travels from the browser,
 *   where it already lives. Nothing here can reach for the service role key,
 *   because a proxy holding one would hand every caller admin.
 */

const AUTH_PREFIX = "auth/v1/";

/* An ALLOW-list, not a deny-list.
   Copying the provider's response headers wholesale and handing them to the
   Functions host produced a 500 with an empty body -- the handler ran, did
   not throw, and returned a response the host then refused. Which header it
   objected to was never visible: the logs for this app were unreachable
   from where it was diagnosed. Guessing at a deny-list means guessing again
   the next time the provider adds a header. supabase-js reads the status
   and the JSON body; `content-type` is the only header it needs, and
   nothing else is worth the risk of another blank 500. */
const COPY_RESPONSE_HEADERS = ["content-type"];

/* Sent on, because Supabase reads them: `apikey` and `authorization` are the
   credentials, `content-type` the body's shape. Everything else -- cookies,
   forwarding headers, the caller's own host -- is dropped rather than
   relayed, so nothing about this hop is attributable to the browser. */
const FORWARD_REQUEST_HEADERS = ["apikey", "authorization", "content-type", "accept"];

export class ProxyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ProxyError";
    this.status = status;
  }
}

/** The configured project, or null when the proxy is switched off. */
export function proxyTarget(env = process.env) {
  const url = String(env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!url) return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in|net)$/i.test(url)) {
    throw new ProxyError("SUPABASE_URL is not a Supabase project URL.", 500);
  }
  return url;
}

/**
 * Forward one request.
 *
 * `path` is whatever followed `/api/auth/` in the route. It is checked
 * against the allowed prefix and then used verbatim -- no `..` can escape a
 * prefix test that happens after normalisation, and the URL constructor
 * normalises before this compares.
 */
export async function handleAuthProxy(request, options = {}) {
  /* NOTHING ESCAPES. An exception leaving this function is a bare 500 with
     an empty body, and on a platform whose logs were unreachable that is
     indistinguishable from the route not existing, the provider being down,
     or the worker crashing -- three days of guessing between them. The
     stage is named in the response because a proxy that cannot say which
     hop failed is not debuggable from the outside, which is the only side
     anyone had. It names a stage, never an exception message: those carry
     paths, hosts and occasionally credentials. */
  let stage = "start";
  try {
    return await proxyExchange(request, options, (s) => { stage = s; });
  } catch (err) {
    options.log?.(`auth proxy failed at ${stage}:`, err?.stack ?? err);
    return { status: 502, jsonBody: { error: { message: "Could not reach the sign-in service.", at: stage } } };
  }
}

async function proxyExchange(request, options, mark) {
  const env = options.env ?? process.env;
  const doFetch = options.fetch ?? globalThis.fetch;

  mark("config");
  const target = proxyTarget(env);
  if (!target) return { status: 503, jsonBody: { error: { message: "Sign-in is not configured." } } };

  /* The route binding supplies `path`, but falling back to the URL means
     this module is whole on its own -- testable without a Functions host,
     and not silently a 404 for everything if the route template is ever
     renamed. */
  mark("path");
  let raw = String(options.path ?? "").replace(/^\/+/, "");
  if (!raw) {
    const p = new URL(request.url ?? "https://placeholder.invalid/").pathname;
    /* `idp`, not `auth`: Static Web Apps treats some auth-shaped paths as
       its own, and a route it intercepts never reaches this function --
       which presents as a 500 with an empty body and no log, because
       nothing here ever ran. */
    const at = p.indexOf("/api/idp/");
    raw = at === -1 ? "" : p.slice(at + "/api/idp/".length);
  }
  /* Normalised FIRST, then checked: `auth/v1/../../rest/v1/customers`
     collapses to `rest/v1/customers` and must fail the prefix test, not
     sneak past it as a literal string that happens to start correctly. */
  const normalised = new URL(raw, "https://placeholder.invalid/").pathname.replace(/^\/+/, "");
  if (!normalised.startsWith(AUTH_PREFIX)) {
    return { status: 404, jsonBody: { error: { message: "Not found." } } };
  }

  mark("url");
  const url = new URL(`${target}/${normalised}`);
  const incoming = new URL(request.url ?? "https://placeholder.invalid/");
  url.search = incoming.search;

  const headers = {};
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers?.get?.(name);
    if (value) headers[name] = value;
  }

  mark("body");
  const method = String(request.method ?? "GET").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.text();

  /* The WHOLE exchange, not just the call. Reading the body and copying the
     headers can fail too -- a connection dropped mid-response, a header the
     host will not accept -- and an exception escaping this function is a
     bare 500 with an empty body, which says nothing about whether the
     provider was reached. Every failure here is the same thing from the
     caller's side: this API could not complete the exchange. */
  mark("fetch");
  try {
    /* A DEADLINE, because a hang is worse than a failure here. Without one,
       an unreachable provider leaves the request open until the Functions
       host gives up on the whole invocation -- which it reports as a bare
       500 with an empty body and no indication that anything was waiting on
       the network. Ten seconds is far longer than a sign-in takes and far
       shorter than the host's patience, so the failure is this function's
       to describe rather than the platform's to swallow. */
    const upstream = await doFetch(url.toString(), {
      method, headers, body,
      signal: options.signal ?? AbortSignal.timeout(Number(env.IDP_TIMEOUT_MS || 10_000)),
    });
    const out = {};
    for (const name of COPY_RESPONSE_HEADERS) {
      const value = upstream.headers?.get?.(name);
      if (value) out[name] = value;
    }
    return { status: upstream.status, headers: out, body: await upstream.text() };
  } catch (err) {
    options.log?.("auth proxy could not complete the exchange:", err?.stack ?? err);
    return { status: 502, jsonBody: { error: { message: "Could not reach the sign-in service." } } };
  }
}
