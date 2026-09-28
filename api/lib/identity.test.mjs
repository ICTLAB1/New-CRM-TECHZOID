import { describe, expect, it, beforeEach } from "vitest";
import { createHmac, generateKeyPairSync, sign as signWith } from "node:crypto";
import { AuthError, callerOf, forgetJwks, identityConfig, verifyToken } from "./identity.mjs";

/**
 * The attack cases are the point of this file.
 *
 * Hand-written JWT verification is a place people get wrong in a way that
 * does not show up in normal use: every legitimate token still works, and so
 * does every forged one. So the tests that matter are not "a good token is
 * accepted" — they are the nine ways a bad token could be accepted, each one
 * a real, published break of somebody else's verifier.
 *
 * Everything is signed here with locally generated keys. No secret in this
 * file is real, none reaches a network, and the RSA pair is made fresh on
 * each run.
 */

const SECRET = "a-test-signing-secret-that-is-not-real";
const USER = "77777777-7777-7777-7777-777777777777";

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const soon = () => Math.floor(Date.now() / 1000) + 3600;

/** Build a token and sign it with HMAC, or with whatever is passed. */
function hs256(payload = {}, { header = {}, secret = SECRET } = {}) {
  const head = b64({ alg: "HS256", typ: "JWT", ...header });
  const body = b64({ sub: USER, exp: soon(), ...payload });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" });

function rs256(payload = {}, { header = {}, key = privateKey } = {}) {
  const head = b64({ alg: "RS256", typ: "JWT", kid: "key-1", ...header });
  const body = b64({ sub: USER, exp: soon(), ...payload });
  const sig = signWith("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${body}.${sig}`;
}

const hsConfig = { alg: "HS256", secret: SECRET, issuer: null, audience: null, clockSkewSeconds: 60 };
const rsConfig = { alg: "RS256", publicKeyPem: PUBLIC_PEM, issuer: null, audience: null, clockSkewSeconds: 60 };

describe("a token that is genuine", () => {
  it("identifies the caller", async () => {
    const { userId } = await verifyToken(hs256(), { config: hsConfig });
    expect(userId).toBe(USER);
  });

  it("works the same signed with a key pair", async () => {
    const { userId } = await verifyToken(rs256(), { config: rsConfig });
    expect(userId).toBe(USER);
  });

  it("reads Entra ID's `oid` when there is no `sub`", async () => {
    /* Supabase puts the user id in `sub`; Entra ID puts it in `oid`. The
       same verifier has to serve both sides of the cutover. */
    const token = hs256({ sub: undefined, oid: USER });
    const { userId } = await verifyToken(token, { config: hsConfig });
    expect(userId).toBe(USER);
  });
});

/* -- THE ONES THAT MATTER --------------------------------------------- */

describe("a token that is not genuine", () => {
  const refused = async (token, config = hsConfig) =>
    expect(verifyToken(token, { config })).rejects.toThrow(AuthError);

  it("refuses `alg: none`, the oldest break there is", async () => {
    const head = b64({ alg: "none", typ: "JWT" });
    const body = b64({ sub: USER, exp: soon() });
    await refused(`${head}.${body}.`);
    await refused(`${head}.${body}.anything`);
  });

  it("refuses an HS256 token aimed at an RS256 verifier", async () => {
    /* Algorithm confusion. If the verifier took the algorithm from the
       token, an attacker could HMAC-sign with the PUBLIC key — which is
       public — and be believed. The algorithm comes from configuration, so
       this dies before any signature is checked. */
    const forged = hs256({}, { secret: PUBLIC_PEM.toString() });
    await refused(forged, rsConfig);
  });

  it("refuses an RS256 token aimed at an HS256 verifier", async () => {
    await refused(rs256(), hsConfig);
  });

  it("refuses a token signed with the wrong secret", async () => {
    await refused(hs256({}, { secret: "not-the-secret" }));
  });

  it("refuses a token signed with the wrong key", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await refused(rs256({}, { key: other.privateKey }), rsConfig);
  });

  it("refuses a token whose payload was edited after signing", async () => {
    /* The whole point of a signature. Take a valid token, swap the user id
       for somebody else's, keep the signature. */
    const valid = hs256();
    const [head, , sig] = valid.split(".");
    const tampered = `${head}.${b64({ sub: "88888888-8888-8888-8888-888888888888", exp: soon() })}.${sig}`;
    await refused(tampered);
  });

  it("refuses a token that has expired", async () => {
    await refused(hs256({ exp: Math.floor(Date.now() / 1000) - 3600 }));
  });

  it("refuses a token with no expiry at all", async () => {
    /* A token that never expires is a password that cannot be changed. */
    await refused(hs256({ exp: undefined }));
  });

  it("refuses a token that is not valid yet", async () => {
    await refused(hs256({ nbf: Math.floor(Date.now() / 1000) + 3600 }));
  });

  it("refuses a token from the wrong issuer", async () => {
    const config = { ...hsConfig, issuer: "https://login.microsoftonline.com/tenant/v2.0" };
    await refused(hs256({ iss: "https://elsewhere.example" }), config);
  });

  it("refuses a token issued for a different audience", async () => {
    const config = { ...hsConfig, audience: "api://techzoid-crm" };
    await refused(hs256({ aud: "api://something-else" }), config);
    await refused(hs256({ aud: ["api://a", "api://b"] }), config);
  });

  it("accepts an audience given as a list containing ours", async () => {
    const config = { ...hsConfig, audience: "api://techzoid-crm" };
    const { userId } = await verifyToken(
      hs256({ aud: ["api://other", "api://techzoid-crm"] }), { config });
    expect(userId).toBe(USER);
  });

  it("refuses a token whose subject is not a user id", async () => {
    await refused(hs256({ sub: "admin" }));
    await refused(hs256({ sub: "' or true --" }));
    await refused(hs256({ sub: undefined }));
  });

  it("refuses anything that is not three segments of base64", async () => {
    await refused("");
    await refused("not-a-token");
    await refused("a.b");
    await refused("a.b.c.d");
    await refused(`${b64({ alg: "HS256" })}..sig`);
  });

  it("refuses an absurdly large token before doing any work", async () => {
    await refused(`${"x".repeat(9000)}.y.z`);
  });
});

/* -- the header ------------------------------------------------------- */

describe("the authorization header", () => {
  it("reads a bearer token", async () => {
    const caller = await callerOf(`Bearer ${hs256()}`, { config: hsConfig });
    expect(caller?.userId).toBe(USER);
  });

  it("treats a missing header as anonymous, not as a failure", async () => {
    /* The registration form and the customer portal are deliberately
       public. They run as `anon`, where every policy keyed on auth.uid()
       matches nothing — which is the correct answer, not an error. */
    expect(await callerOf(undefined, { config: hsConfig })).toBeNull();
    expect(await callerOf("", { config: hsConfig })).toBeNull();
  });

  /* THE DISTINCTION THAT MATTERS: absent is anonymous, invalid is refused.
     Falling back to anonymous on a bad token would turn a forged one into a
     working request for every public path. */
  it("refuses a header that is present and wrong", async () => {
    await expect(callerOf("Bearer nonsense", { config: hsConfig })).rejects.toThrow(AuthError);
    await expect(callerOf(`Basic ${hs256()}`, { config: hsConfig })).rejects.toThrow(AuthError);
    await expect(callerOf(hs256(), { config: hsConfig })).rejects.toThrow(AuthError);
  });
});

/* -- configuration ---------------------------------------------------- */

describe("configuration", () => {
  it("refuses to run with no secret rather than accepting anything", async () => {
    /* An endpoint that quietly stops checking signatures looks exactly like
       one that is working. */
    expect(() => identityConfig({ JWT_ALG: "HS256" })).toThrow(AuthError);
    expect(() => identityConfig({ JWT_ALG: "RS256" })).toThrow(AuthError);
  });

  it("refuses an algorithm it does not implement", () => {
    expect(() => identityConfig({ JWT_ALG: "none", JWT_SECRET: "x" })).toThrow(AuthError);
    expect(() => identityConfig({ JWT_ALG: "HS512", JWT_SECRET: "x" })).toThrow(AuthError);
  });

  it("defaults to the shared secret Supabase uses today", () => {
    const config = identityConfig({ SUPABASE_JWT_SECRET: "s" });
    expect(config.alg).toBe("HS256");
    expect(config.secret).toBe("s");
  });

  it("takes Entra ID's settings when given them", () => {
    const config = identityConfig({
      JWT_ALG: "RS256",
      JWT_JWKS_URI: "https://login.microsoftonline.com/t/discovery/v2.0/keys",
      JWT_ISSUER: "https://login.microsoftonline.com/t/v2.0",
      JWT_AUDIENCE: "api://techzoid-crm",
    });
    expect(config.alg).toBe("RS256");
    expect(config.issuer).toContain("microsoftonline");
    expect(config.audience).toBe("api://techzoid-crm");
  });
});

/* -- JWKS --------------------------------------------------------------
   Entra ID rotates its signing keys, so the public half is fetched. A fake
   fetch serves the locally generated key: no network, and the rotation case
   can actually be exercised, which it could not be against a real tenant. */

describe("fetched signing keys", () => {
  const jwksConfig = {
    alg: "RS256",
    jwksUri: "https://login.microsoftonline.com/t/discovery/v2.0/keys",
    issuer: null, audience: null, clockSkewSeconds: 60,
  };

  /* Exported straight off the key object: `createPublicKey` refuses one
     that is already public. */
  const jwkFor = (key, kid) => ({ ...key.export({ format: "jwk" }), kid, use: "sig" });

  const serving = (keys) => {
    let calls = 0;
    const fetch = async () => { calls += 1; return { ok: true, json: async () => ({ keys }) }; };
    return { fetch, calls: () => calls };
  };

  beforeEach(() => { forgetJwks(); });

  it("fetches the key set and verifies against it", async () => {
    const server = serving([jwkFor(publicKey, "key-1")]);
    const { userId } = await verifyToken(rs256(), { config: jwksConfig, fetch: server.fetch });
    expect(userId).toBe(USER);
  });

  it("caches, so every request is not a network round trip", async () => {
    const server = serving([jwkFor(publicKey, "key-1")]);
    await verifyToken(rs256(), { config: jwksConfig, fetch: server.fetch });
    await verifyToken(rs256(), { config: jwksConfig, fetch: server.fetch });
    expect(server.calls()).toBe(1);
  });

  it("refetches once when a token names a key it has not seen", async () => {
    /* What a rotation looks like from here: a valid token signed by a key
       that was not in the set when it was last fetched. */
    const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
    let current = [jwkFor(publicKey, "key-1")];
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return { ok: true, json: async () => ({ keys: current }) };
    };

    await verifyToken(rs256(), { config: jwksConfig, fetch });
    expect(calls).toBe(1);

    current = [jwkFor(rotated.publicKey, "key-2")];
    const token = rs256({}, { header: { kid: "key-2" }, key: rotated.privateKey });
    const { userId } = await verifyToken(token, { config: jwksConfig, fetch });
    expect(userId).toBe(USER);
    expect(calls).toBe(2);
  });

  it("does not refetch forever for a key that does not exist", async () => {
    /* Otherwise one replayed token naming a nonexistent key turns into
       unbounded traffic at the identity provider. */
    const server = serving([jwkFor(publicKey, "key-1")]);
    await verifyToken(rs256(), { config: jwksConfig, fetch: server.fetch });
    const before = server.calls();
    await expect(verifyToken(rs256({}, { header: { kid: "nope" } }),
      { config: jwksConfig, fetch: server.fetch })).rejects.toThrow(AuthError);
    expect(server.calls()).toBe(before + 1);
  });

  it("refuses when the key set cannot be fetched", async () => {
    const fetch = async () => ({ ok: false, json: async () => ({}) });
    await expect(verifyToken(rs256(), { config: jwksConfig, fetch })).rejects.toThrow(AuthError);
  });

  it("refuses when the key set is empty", async () => {
    const fetch = async () => ({ ok: true, json: async () => ({ keys: [] }) });
    await expect(verifyToken(rs256(), { config: jwksConfig, fetch })).rejects.toThrow(AuthError);
  });
});
