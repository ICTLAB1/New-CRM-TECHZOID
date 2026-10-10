/**
 * Issuing the tokens this API then verifies.
 *
 * `identity.mjs` already checks HS256 tokens whose `sub` is the user's id.
 * It does not care who signed them, only that the signature holds and the
 * secret is the configured one. So issuing here changes nothing downstream:
 * the same verifier, the same claims, the same `auth.uid()` in all 89
 * policies.
 *
 * Written against node:crypto rather than a JWT library, because the whole
 * surface is sign-and-verify of one algorithm and a dependency on the
 * authentication path is a supply-chain risk for no gain. Ported from
 * techzoid-oms, where it is already in service.
 */

import { createHmac, randomUUID } from "node:crypto";

export const ACCESS_TTL_SECONDS = Number(process.env.ACCESS_TTL_SECONDS || 3600);
export const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TTL_DAYS || 14);

const b64 = (buf) => buf.toString("base64url");

function secret(env = process.env) {
  const s = env.JWT_SECRET;
  /* Short secrets make HS256 brute-forceable offline from a single captured
     token, and the attacker needs nothing from us to try. */
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters.");
  }
  return Buffer.from(s, "utf8");
}

/**
 * A signed access token for one person.
 *
 * `role: "authenticated"` is not decoration: `auth.role()` reads it, and
 * policies written for Supabase compare against that exact string. `sub`
 * is this CRM's own user id -- the id every `owner_id` already holds --
 * so nothing has to be translated or rewritten.
 */
export function issue(userId, email, ttlSeconds = ACCESS_TTL_SECONDS, env = process.env) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: userId,
    email: String(email ?? ""),
    role: "authenticated",
    iat: now,
    exp: now + ttlSeconds,
    jti: randomUUID(),
  };
  const header = b64(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64(Buffer.from(JSON.stringify(claims)));
  const mac = b64(createHmac("sha256", secret(env)).update(`${header}.${body}`).digest());
  return { token: `${header}.${body}.${mac}`, claims };
}
