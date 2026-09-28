import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";

/**
 * Who is calling.
 *
 * WHAT THIS REPLACES. Supabase's PostgREST read the caller's JWT, checked
 * the signature against the project secret, and put `sub` where `auth.uid()`
 * could find it. Every one of the 89 policies is written against that value.
 * Azure has nothing that does this, so it is here — and it is the most
 * security-critical file in the migration: the query translator, the RPC
 * whitelist and all the policies are correct only if the user id handed to
 * `asUser` is one the caller actually proved.
 *
 * THE RULE THAT MATTERS: THE SIGNATURE IS CHECKED BEFORE THE PAYLOAD IS
 * BELIEVED. A JWT is three pieces of base64 that anybody can type. The
 * claims inside one are a request, not a fact, until the signature says
 * otherwise. Nothing here reads `sub` before `verify` has run.
 *
 * AND THE ALGORITHM IS NOT TAKEN FROM THE TOKEN. The classic break on
 * hand-written JWT code is letting the token choose: `alg: "none"` skips
 * verification entirely, and an `HS256` token aimed at an RS256 verifier
 * lets an attacker sign with the public key as the HMAC secret. The expected
 * algorithm comes from configuration, the token's header must match it, and
 * a mismatch is rejected before anything else happens.
 *
 * TWO ALGORITHMS, BECAUSE THIS MIGRATION HAS TWO SIGN-INS. Supabase signs
 * with a shared secret (HS256) and is what runs today; Entra ID signs with a
 * rotating key pair (RS256) published as a JWKS and is what runs after
 * cutover. Both are implemented, so the switch is a configuration change
 * rather than a rewrite on the day.
 */

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tokens longer than this are not tokens. Checked before anything costly. */
const MAX_TOKEN_BYTES = 8 * 1024;

/* -- configuration ---------------------------------------------------- */

/**
 * Read the verifier's settings from the environment.
 *
 * Deliberately strict: a missing secret is an error, never a fallback to
 * "accept anything". An endpoint that quietly stops checking signatures
 * looks exactly like one that is working.
 */
export function identityConfig(env = process.env) {
  const alg = (env.JWT_ALG || "HS256").toUpperCase();
  if (alg !== "HS256" && alg !== "RS256") {
    throw new AuthError("Unsupported JWT_ALG: expected HS256 or RS256.", 500);
  }

  const config = {
    alg,
    issuer: env.JWT_ISSUER || null,
    audience: env.JWT_AUDIENCE || null,
    /* Clocks differ. Sixty seconds is the usual allowance, and is small
       enough that an expired token is not usable for long. */
    clockSkewSeconds: Number(env.JWT_CLOCK_SKEW_SECONDS || 60),
  };

  if (alg === "HS256") {
    const secret = env.JWT_SECRET || env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new AuthError("No JWT secret configured; refusing to accept tokens.", 500);
    }
    config.secret = secret;
  } else {
    config.publicKeyPem = env.JWT_PUBLIC_KEY || null;
    config.jwksUri = env.JWT_JWKS_URI || null;
    if (!config.publicKeyPem && !config.jwksUri) {
      throw new AuthError("No JWT public key or JWKS URI configured.", 500);
    }
  }
  return config;
}

/* -- decoding --------------------------------------------------------- */

function decodeSegment(segment, what) {
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const value = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value;
  } catch {
    throw new AuthError(`Malformed token ${what}.`);
  }
}

function split(token) {
  if (typeof token !== "string" || token.length === 0) {
    throw new AuthError("No token supplied.");
  }
  if (Buffer.byteLength(token) > MAX_TOKEN_BYTES) {
    throw new AuthError("Token is too large.");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Malformed token.");
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) throw new AuthError("Malformed token.");
  return { headerB64, payloadB64, signatureB64 };
}

/**
 * The token's header WITHOUT verifying anything.
 *
 * Exported for one purpose: finding the `kid` so the right JWKS key can be
 * fetched. Named to be impossible to mistake for the real thing, and
 * nothing here reads a payload through it.
 */
export function unsafeDecodeHeader(token) {
  const { headerB64 } = split(token);
  return decodeSegment(headerB64, "header");
}

/* -- signature checks ------------------------------------------------- */

function checkHs256(signingInput, signatureB64, secret) {
  const expected = createHmac("sha256", secret).update(signingInput).digest();
  const actual = Buffer.from(signatureB64, "base64url");
  /* Lengths must match before `timingSafeEqual`, which throws on unequal
     buffers — and comparing lengths first leaks nothing an attacker could
     not measure by sending a shorter signature anyway. */
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function checkRs256(signingInput, signatureB64, publicKey) {
  try {
    return verifySignature(
      "RSA-SHA256",
      Buffer.from(signingInput),
      publicKey,
      Buffer.from(signatureB64, "base64url"),
    );
  } catch {
    return false;
  }
}

/* -- JWKS --------------------------------------------------------------
   Entra ID rotates its signing keys, so the public half is fetched rather
   than configured. Cached, because fetching it on every request would put a
   network round trip in front of every query — and refetched once when a
   `kid` is not in the cache, because that is what a rotation looks like. */

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache = { uri: null, keys: new Map(), fetchedAt: 0 };

/** Drop the cached keys. For tests, and after a rotation. */
export function forgetJwks() {
  jwksCache = { uri: null, keys: new Map(), fetchedAt: 0 };
}

async function loadJwks(uri, doFetch) {
  const res = await doFetch(uri);
  if (!res.ok) throw new AuthError("Could not fetch the signing keys.", 503);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of body?.keys ?? []) {
    if (!jwk || jwk.kty !== "RSA") continue;
    if (jwk.use && jwk.use !== "sig") continue;
    try {
      keys.set(String(jwk.kid), createPublicKey({ key: jwk, format: "jwk" }));
    } catch {
      /* One unusable key in the set must not cost the others. */
    }
  }
  if (keys.size === 0) throw new AuthError("The signing key set is empty.", 503);
  jwksCache = { uri, keys, fetchedAt: Date.now() };
  return keys;
}

async function publicKeyFor(kid, config, doFetch) {
  if (config.publicKeyPem) return createPublicKey(config.publicKeyPem);
  if (!kid) throw new AuthError("Token does not say which key signed it.");

  const fresh = jwksCache.uri === config.jwksUri
    && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  let keys = fresh ? jwksCache.keys : await loadJwks(config.jwksUri, doFetch);

  if (!keys.has(kid) && fresh) {
    /* An unknown `kid` on a warm cache is what a key rotation looks like.
       Refetch once — and only once, so a token naming a key that does not
       exist cannot be replayed into an unbounded number of fetches. */
    keys = await loadJwks(config.jwksUri, doFetch);
  }
  const key = keys.get(kid);
  if (!key) throw new AuthError("Token was signed by an unknown key.");
  return key;
}

/* -- the verifier ----------------------------------------------------- */

/**
 * Verify a token and return the caller.
 *
 * Throws `AuthError` for anything that is not a valid, current token signed
 * by the configured key. There is no path that returns a user id without
 * having checked a signature first.
 */
export async function verifyToken(token, options = {}) {
  const config = options.config ?? identityConfig(options.env);
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Math.floor(Date.now() / 1000);

  const { headerB64, payloadB64, signatureB64 } = split(token);
  const header = decodeSegment(headerB64, "header");

  /* FIRST, and before anything reads the payload: the token does not get to
     choose the algorithm. `none` and an HS256 token aimed at an RS256
     verifier both die here. */
  if (header.alg !== config.alg) {
    throw new AuthError("Token is signed with an unexpected algorithm.");
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const ok = config.alg === "HS256"
    ? checkHs256(signingInput, signatureB64, config.secret)
    : checkRs256(signingInput, signatureB64, await publicKeyFor(header.kid, config, doFetch));
  if (!ok) throw new AuthError("Token signature does not verify.");

  /* Only now is the payload worth reading. */
  const claims = decodeSegment(payloadB64, "payload");
  const skew = config.clockSkewSeconds;

  /* `exp` is required, not optional. A token that never expires is a
     password that cannot be changed. */
  if (typeof claims.exp !== "number") throw new AuthError("Token has no expiry.");
  if (now > claims.exp + skew) throw new AuthError("Token has expired.");
  if (typeof claims.nbf === "number" && now + skew < claims.nbf) {
    throw new AuthError("Token is not valid yet.");
  }

  if (config.issuer && claims.iss !== config.issuer) {
    throw new AuthError("Token was issued by somebody else.");
  }
  if (config.audience) {
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(config.audience)) {
      throw new AuthError("Token was issued for somebody else.");
    }
  }

  /* Entra ID puts the user's object id in `oid`; Supabase uses `sub`. Both
     are read so the same verifier serves before and after cutover. */
  const subject = String(claims.sub ?? claims.oid ?? "");
  if (!UUID.test(subject)) {
    throw new AuthError("Token does not identify a user.");
  }

  return { userId: subject, claims };
}

/**
 * The caller of one request, or null when there is no token at all.
 *
 * A MISSING token is not an error: the registration form and the customer
 * portal are deliberately public, and they run as `anon`, where every policy
 * keyed on `auth.uid()` matches nothing. A token that is PRESENT and does
 * not verify is very much an error — quietly downgrading it to anonymous
 * would turn a forged token into a working request for the public paths.
 */
export async function callerOf(authorizationHeader, options = {}) {
  const raw = String(authorizationHeader ?? "").trim();
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  if (!match) throw new AuthError("Authorization header is not a bearer token.");
  return verifyToken(match[1].trim(), options);
}
