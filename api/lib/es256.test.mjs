import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { forgetJwks, verifyToken, AuthError } from "./identity.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "ES256", use: "sig" };
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");

function es256(claims, kid = "k1") {
  const h = b64({ alg: "ES256", typ: "JWT", kid });
  const p = b64(claims);
  const sig = createSign("SHA256").update(`${h}.${p}`).end()
    .sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${sig.toString("base64url")}`;
}
const fetchJwks = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const cfg = { alg: "ES256", jwksUri: "https://x/jwks", issuer: null, audience: null,
              clockSkewSeconds: 60, directory: "supabase" };
const SUB = "11111111-1111-1111-1111-111111111111";

describe("ES256, which is how Supabase signs now", () => {
  it("accepts a genuine token and returns the subject", async () => {
    forgetJwks();
    const v = await verifyToken(es256({ sub: SUB, exp: Math.floor(Date.now()/1e3)+3600 }),
      { config: cfg, fetch: fetchJwks });
    expect(v.subject).toBe(SUB);
  });

  it("rejects a tampered payload", async () => {
    forgetJwks();
    const t = es256({ sub: SUB, exp: Math.floor(Date.now()/1e3)+3600 });
    const [h,,s] = t.split(".");
    const forged = `${h}.${b64({ sub: "22222222-2222-2222-2222-222222222222", exp: Math.floor(Date.now()/1e3)+3600 })}.${s}`;
    await expect(verifyToken(forged, { config: cfg, fetch: fetchJwks })).rejects.toThrow(AuthError);
  });

  it("rejects a token signed by a different key", async () => {
    forgetJwks();
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    const h = b64({ alg: "ES256", typ: "JWT", kid: "k1" });
    const p = b64({ sub: SUB, exp: Math.floor(Date.now()/1e3)+3600 });
    const sig = createSign("SHA256").update(`${h}.${p}`).end().sign({ key: other, dsaEncoding: "ieee-p1363" });
    await expect(verifyToken(`${h}.${p}.${sig.toString("base64url")}`,
      { config: cfg, fetch: fetchJwks })).rejects.toThrow(/does not verify/);
  });

  it("will not let a token downgrade the algorithm", async () => {
    forgetJwks();
    /* A real signature, on a header claiming a weaker algorithm. An EMPTY
       signature would be refused as malformed before the algorithm check,
       which would make this test pass without proving anything. */
    const h = b64({ alg: "HS256", typ: "JWT", kid: "k1" });
    const p = b64({ sub: SUB, exp: Math.floor(Date.now()/1e3)+3600 });
    const sig = createSign("SHA256").update(`${h}.${p}`).end()
      .sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
    await expect(verifyToken(`${h}.${p}.${sig.toString("base64url")}`,
      { config: cfg, fetch: fetchJwks })).rejects.toThrow(/unexpected algorithm/);
  });
});
