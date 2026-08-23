/**
 * HTTP plumbing shared by every function.
 *
 * Three rules live here so no handler has to remember them:
 *   · CORS is locked to the site's own origin, not "*"
 *   · responses never carry an internal error message
 *   · every response says it must not be cached
 */

/** Origins allowed to call the authenticated functions. */
function allowedOrigins() {
  const configured = (process.env.ALLOWED_ORIGINS || process.env.URL || "")
    .split(",").map((o) => o.trim()).filter(Boolean);
  /* Netlify sets URL and DEPLOY_PRIME_URL; both are legitimate. */
  if (process.env.DEPLOY_PRIME_URL) configured.push(process.env.DEPLOY_PRIME_URL);
  return configured;
}

/**
 * CORS headers for a request.
 *
 * v1 answered every function with `Access-Control-Allow-Origin: *`. These
 * endpoints take a bearer token in a header, which a browser will send
 * cross-origin without credentials mode — so "*" let any page on the internet
 * script a call with a token it had obtained. Echoing only a configured
 * origin costs nothing and closes that.
 *
 * With nothing configured it falls back to "*", because a half-deployed site
 * that cannot call its own API is worse than the risk — but the diagnostics
 * endpoint reports the fallback so an admin can see it.
 */
export function corsHeaders(event, methods = "POST, OPTIONS") {
  const origin = (event?.headers?.origin || event?.headers?.Origin || "").trim();
  const allowed = allowedOrigins();
  const allowOrigin = allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export const isOriginLocked = () => allowedOrigins().length > 0;

export const json = (event, statusCode, payload, methods) => ({
  statusCode,
  headers: corsHeaders(event, methods),
  body: JSON.stringify(payload),
});

/**
 * An error the caller can act on.
 *
 * `message` is written for a person and is safe to show. Anything internal —
 * a stack, a provider's raw response, a connection string — goes to the
 * function log and never into the body. v1 returned `err.message` straight to
 * the client from five different handlers.
 */
export function fail(event, statusCode, message, internal, methods) {
  if (internal) console.error("[" + statusCode + "]", internal);
  return json(event, statusCode, { error: message }, methods);
}

/** Standard preflight / method guard. Returns a response, or null to continue. */
export function guard(event, method = "POST", methods) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(event, methods), body: "" };
  }
  if (event.httpMethod !== method) {
    return fail(event, 405, "Method not allowed", null, methods);
  }
  return null;
}

/** Parse a JSON body without throwing on rubbish. */
export function readJson(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    return null;
  }
}

/** The caller's IP, as far as the platform will tell us. */
export function clientIp(event) {
  const h = event.headers || {};
  const fwd = h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "";
  return String(fwd).split(",")[0].trim() || "unknown";
}
