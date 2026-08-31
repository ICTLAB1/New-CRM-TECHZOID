import { createHash } from "node:crypto";

/**
 * Turning the secret in a link into the row that describes it.
 *
 * The hash is SHA-256 hex, computed identically here and in the browser that
 * issued the link (src/domain/portal/token.ts uses SubtleCrypto). If those two
 * ever disagree, every link stops working at once and loudly, which is the
 * failure mode to want from a pair of functions that must agree.
 *
 * Plain SHA-256 rather than bcrypt or argon2, and that is a considered choice
 * rather than the usual mistake. Those exist to make GUESSING feasible inputs
 * expensive — a password somebody chose. This input is 32 bytes from a CSPRNG;
 * there is no dictionary for it and no amount of hashing work changes that.
 * What matters is that the stored value is not itself usable as a link, and a
 * one-way hash gives that.
 */

/** The shape a token must have before the database is asked about it. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export const looksLikeToken = (value) => TOKEN_RE.test(String(value ?? ""));

export function hashToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

/**
 * Look a link up and say whether it may be used.
 *
 * Returns `{ ok: false, reason }` for every rejection, never an error, and
 * never a different one for "no such link" than for "revoked": a caller
 * probing tokens must not be able to tell the two apart, and a customer whose
 * link has been withdrawn is told the same thing either way — ask for a new
 * one. `reason` is for the log, not for the response body.
 */
export async function resolveToken(admin, token) {
  if (!looksLikeToken(token)) return { ok: false, reason: "malformed" };

  const { data, error } = await admin
    .from("portal_tokens")
    .select("id, customer_id, expires_at, revoked_at, view_count")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, reason: "unknown" };
  if (data.revoked_at) return { ok: false, reason: "revoked" };
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, link: data };
}

/**
 * Record that somebody opened it.
 *
 * Deliberately not awaited by the caller and deliberately swallowing its own
 * error: this is a nice-to-have column on a staff screen, and a customer must
 * never see a page fail because a counter did.
 */
export function noteView(admin, link) {
  admin
    .from("portal_tokens")
    .update({ last_seen_at: new Date().toISOString(), view_count: (link.view_count ?? 0) + 1 })
    .eq("id", link.id)
    .then(({ error }) => { if (error) console.error("portal view counter:", error.message); });
}
