import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The OAuth `state` parameter.
 *
 * This is the single most security-critical piece of the integration. The
 * state carries the CRM user id through Microsoft's redirect, and the
 * callback trusts it to decide whose account a mailbox is attached to.
 *
 * Unsigned, an attacker consents with THEIR OWN Microsoft account while
 * handing back a state naming YOUR user id — and from then on your
 * quotations send from their mailbox, and their Sent Items hold your
 * customer correspondence. So: HMAC-signed, compared in constant time, and
 * expiring in fifteen minutes so an old link cannot be replayed.
 */

export const STATE_TTL_MS = 15 * 60 * 1000;

/**
 * What the connection is for. `own` attaches the mailbox to the person who
 * signed in; `shared` records it as a company mailbox anybody authorised may
 * send from. It rides inside the SIGNED payload rather than the query string
 * for the same reason the user id does: a caller who could change it could
 * turn their own mailbox into the company's sending address, or the other
 * way round. The set is closed so nothing else can be smuggled through, and
 * so a purpose can never contain the separator.
 */
export const PURPOSES = new Set(["own", "shared"]);

function secretOf(env) {
  const secret = env.MS_STATE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("No MS_STATE_SECRET or SUPABASE_SERVICE_ROLE_KEY configured");
  return secret;
}

export function signState(userId, env, now = Date.now(), purpose = "own") {
  if (!userId) throw new Error("signState needs a user id");
  if (!PURPOSES.has(purpose)) throw new Error(`signState: unknown purpose ${purpose}`);
  const nonce = randomBytes(8).toString("hex");
  /* Appended, not inserted: a state signed by the previous version has three
     parts and must keep verifying, or everyone mid-connection at the moment
     this deploys gets "that link is no longer valid". */
  const payload = `${userId}.${now}.${nonce}.${purpose}`;
  const sig = createHmac("sha256", secretOf(env)).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

/**
 * Verify and unpack a state.
 *
 * Returns `{ ok: true, userId, purpose }` or `{ ok: false, reason }`. A state
 * from before purposes existed has three parts and reads as `own`, which is
 * what it was. Never throws on
 * bad input: every failure is a caller error, and the caller shows one
 * message for all of them so nothing is learned from which failed.
 */
export function verifyState(state, env, now = Date.now(), ttlMs = STATE_TTL_MS) {
  if (!state || typeof state !== "string") return { ok: false, reason: "missing" };
  let decoded;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const idx = decoded.lastIndexOf(".");
  if (idx <= 0) return { ok: false, reason: "malformed" };
  const payload = decoded.slice(0, idx);
  const sig = decoded.slice(idx + 1);

  let expected;
  try {
    expected = createHmac("sha256", secretOf(env)).update(payload).digest("hex");
  } catch {
    return { ok: false, reason: "unconfigured" };
  }

  /* Constant time, and length-checked first because timingSafeEqual throws
     on a length mismatch. */
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature" };

  const parts = payload.split(".");
  if (parts.length !== 3 && parts.length !== 4) return { ok: false, reason: "malformed" };
  const [userId, ts] = parts;
  const purpose = parts.length === 4 ? parts[3] : "own";
  if (!PURPOSES.has(purpose)) return { ok: false, reason: "purpose" };
  const issued = Number(ts);
  if (!userId || !Number.isFinite(issued)) return { ok: false, reason: "malformed" };
  /* A state timestamped in the future is not one we issued. */
  if (issued > now + 60_000) return { ok: false, reason: "future" };
  if (now - issued > ttlMs) return { ok: false, reason: "expired" };

  return { ok: true, userId, purpose };
}
