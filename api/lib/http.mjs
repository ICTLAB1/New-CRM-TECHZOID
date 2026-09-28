import { asAnon, asUser } from "./db.mjs";
import { QueryError, runQuery } from "./query.mjs";
import { RpcError, compileRpc, runRpc } from "./rpc.mjs";
import { AuthError, bearerToken, callerOf, verifyToken } from "./identity.mjs";

/**
 * The two endpoints the browser talks to: `/api/q` and `/api/rpc`.
 *
 * Written against a Fetch-shaped request and returning a plain object rather
 * than against Azure's own types, for two reasons. The first is that it can
 * then be tested end to end — real token, real translator, real database,
 * real policies — without a Functions host in the loop, which is what
 * `http.test.mjs` does. The second is that the Functions host is the part of
 * this migration most likely to be swapped for something else (Container
 * Apps, App Service), and when it is, only the adapters in `api/src/functions`
 * change.
 *
 * WHAT EVERY REQUEST GOES THROUGH, IN THIS ORDER:
 *
 *   1. The method and content type, so a form post from another site is
 *      refused before anything reads a body.
 *   2. The body's size, before it is parsed.
 *   3. The token — verified, never merely decoded. See `identity.mjs`.
 *   4. `asUser(verified id)` or `asAnon()`, which opens a transaction and
 *      stamps the identity with SET LOCAL so row-level security can judge it.
 *   5. The translator or the RPC whitelist, which refuse anything that is
 *      not a well-formed query over a table that exists.
 *
 * There is no step where a caller's user id is taken from the request body,
 * and no step where a query runs on a connection with no identity on it.
 */

/**
 * Two body limits, because the two callers are not the same risk.
 *
 * ANONYMOUS: 1 MB. Nobody has proved anything yet, the path is reachable by
 * the whole internet (the registration form and the customer portal run as
 * `anon`), and every legitimate unauthenticated request here is a few
 * hundred bytes. The cap exists so the JSON parser cannot be used as a
 * denial of service by someone who has not even got an account.
 *
 * SIGNED IN: 8 MB. This is not generosity, it is the settings row. The CRM
 * keeps the company's whole configuration in one jsonb document — product
 * catalogue, bank details, ISO certificates, letterhead, stamp and logos,
 * all base64 — and `syncSettings` sends the ENTIRE document back on every
 * save, including a one-word edit to the company address. Production's two
 * rows are 2.88 MB and 2.72 MB today. At 1 MB for everyone, reading
 * settings worked and SAVING them returned 413: the company's address could
 * not be corrected, and the screen said "That request is too large."
 *
 * Why 8 and not 3: the catalogue grows, and a limit that has to be raised
 * again the next time somebody uploads a certificate is a limit that will
 * be met by an outage first. It is ~2.7x the largest document that exists,
 * and far below the Functions host's own request ceiling, so it constrains
 * rather than merely restating it.
 *
 * The size is checked BEFORE the body is read, and the larger allowance is
 * unlocked by the token's SIGNATURE — which costs one hash of the header
 * and touches no database. An unauthenticated flood still meets 1 MB.
 */
const MAX_ANON_BODY_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const json = (status, body) => ({ status, jsonBody: body });

/**
 * Turn whatever went wrong into an answer.
 *
 * Postgres errors PASS THROUGH with their message and SQLSTATE, because
 * that is what PostgREST did and the CRM reads them: "duplicate key"
 * becomes "a company by that name already exists" on screen. `detail`,
 * `hint` and `where` do NOT pass through — `where` carries the body of the
 * function that failed, which is internals, not the caller's business.
 *
 * Anything with no SQLSTATE is a bug in this code, and the browser gets a
 * flat 500 while the real error goes to the log. A stack trace in a response
 * is a map of the server drawn for whoever asked.
 */
function errorResponse(err, log) {
  if (err instanceof AuthError) return json(err.status, { error: { message: err.message } });
  if (err instanceof QueryError) return json(err.status, { error: { message: err.message } });
  if (err instanceof RpcError) return json(err.status, { error: { message: err.message } });

  if (err && typeof err.code === "string" && /^[0-9A-Z]{5}$/.test(err.code)) {
    return json(400, { error: { message: String(err.message ?? "The database refused that."), code: err.code } });
  }

  log?.("unhandled error in the api:", err?.stack ?? err);
  return json(500, { error: { message: "Something went wrong." } });
}

/**
 * How many bytes this caller is allowed to send.
 *
 * Only asked when the request is already over the anonymous limit, so the
 * ordinary case pays nothing. `verifyToken` checks the signature and
 * nothing else — no `resolveCaller`, no connection, no query — because the
 * question here is "is this a real token", not "whose". A token that is
 * present and bad raises AuthError and becomes a 401, which is the truth;
 * no token at all with a large body stays at the anonymous limit.
 */
async function allowanceFor(request, options) {
  const token = bearerToken(request.headers?.get?.("authorization"));
  if (!token) return MAX_ANON_BODY_BYTES;
  await verifyToken(token, options);
  return MAX_BODY_BYTES;
}

/** Method, content type and body, checked in the cheapest order. */
async function readBody(request, options = {}) {
  if (request.method !== "POST") throw new QueryError("Use POST.", 405);

  /* `application/json` is not decoration: it is what stops a plain HTML form
     on another site from posting here, because a form cannot set it. There
     are no cookies in this design, so cross-site forgery is not the threat
     it would otherwise be — but the check costs nothing and closes the door
     anyway. */
  const contentType = String(request.headers?.get?.("content-type") ?? "");
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new QueryError("Send application/json.", 415);
  }

  const declared = Number(request.headers?.get?.("content-length") ?? 0);
  let allowed = MAX_ANON_BODY_BYTES;
  if (declared > allowed) allowed = await allowanceFor(request, options);
  if (declared > allowed) throw new QueryError("That request is too large.", 413);

  const text = await request.text();
  /* Checked again on the actual bytes: `content-length` is whatever the
     caller wrote there, and a caller who understates it is exactly the one
     to distrust. A body that arrives larger than it declared must still be
     measured against what this caller was entitled to send, so the
     allowance is re-derived here when the declared size never triggered
     it. */
  const actual = Buffer.byteLength(text);
  if (actual > allowed) {
    if (allowed === MAX_ANON_BODY_BYTES) allowed = await allowanceFor(request, options);
    if (actual > allowed) throw new QueryError("That request is too large.", 413);
  }

  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body;
  } catch {
    throw new QueryError("That is not a JSON object.");
  }
}

/**
 * Run `fn` as whoever the request proves it is.
 *
 * No token means `anon`, which is correct for the registration form and the
 * customer portal: every policy keyed on `auth.uid()` matches nothing, so an
 * unauthenticated caller sees zero rows rather than all of them. A token
 * that is present and does not verify is refused — never quietly downgraded
 * to anonymous, which would make a forged token work on every public path.
 */
async function asCaller(request, options, fn) {
  const caller = await callerOf(request.headers?.get?.("authorization"), options);
  return caller ? asUser(caller.userId, fn) : asAnon(fn);
}

/* -- POST /api/q ------------------------------------------------------ */

/** Queries: select, insert, upsert, update, delete. See `query.mjs`. */
export async function handleQuery(request, options = {}) {
  try {
    const spec = await readBody(request, options);
    const { data, count } = await asCaller(request, options, (client) => runQuery(client, spec));
    return json(200, count === null || count === undefined ? { data } : { data, count });
  } catch (err) {
    return errorResponse(err, options.log ?? console.error);
  }
}

/* -- POST /api/rpc ---------------------------------------------------- */

/** Stored functions, from a whitelist of eight. See `rpc.mjs`. */
export async function handleRpc(request, options = {}) {
  try {
    const body = await readBody(request, options);

    /* Checked against the whitelist BEFORE a connection is taken. Compiling
       is pure, so a request naming a function that does not exist can be
       turned away without opening a transaction — which means a flood of
       them cannot exhaust the pool and stall the callers who are asking for
       something real. */
    const call = compileRpc(body.fn, body.args ?? {});

    const data = await asCaller(request, options, (client) => runRpc(client, call));
    return json(200, { data });
  } catch (err) {
    return errorResponse(err, options.log ?? console.error);
  }
}
