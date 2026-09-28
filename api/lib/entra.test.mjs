import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { asService, asUser, closePool } from "./db.mjs";
import { forgetCatalog, runQuery } from "./query.mjs";
import { AuthError, callerOf, resolveCaller, verifyToken } from "./identity.mjs";

/**
 * Signing in with Entra ID, against the real mapping and the real policies.
 *
 * WHAT IS ACTUALLY BEING TESTED. Entra gives each person a uuid of its own,
 * and it is not the one every `owner_id` in this database already holds.
 * Nothing rewrites those — the translation happens here, on the way in. So
 * the questions are: does a linked person end up as THEMSELVES, does an
 * unlinked one get refused rather than passed through, and can anyone claim
 * somebody else by naming their address.
 *
 * The failure that would be worst is not an error. Stamping the Entra id
 * straight onto the connection would leave all 77 policies comparing
 * against a uuid that owns nothing, and the CRM would sign you in and then
 * show you no customers — which looks, to the person holding the mouse,
 * exactly like the data being gone.
 */
const HAVE_DB = !!(process.env.PGCONNECTION_STRING || process.env.DATABASE_URL);
const d = HAVE_DB ? describe : describe.skip;

const SECRET = "a-test-signing-secret-that-is-not-real";

/* The internal ids — what the rows already say. */
const NEHA_INTERNAL  = "c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1";
const RAJIV_INTERNAL = "d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2";

/* What Entra would call the same people. Deliberately different. */
const NEHA_OID  = "e3e3e3e3-e3e3-e3e3-e3e3-e3e3e3e3e3e3";
const RAJIV_OID = "f4f4f4f4-f4f4-f4f4-f4f4-f4f4f4f4f4f4";
const STRANGER_OID = "a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9";

const entraConfig = {
  alg: "HS256", secret: SECRET, issuer: null, audience: null,
  clockSkewSeconds: 60, directory: "entra",
};

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
function entraToken(oid, email) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ oid, email, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}

d("signing in with Entra ID", () => {
  beforeAll(async () => {
    forgetCatalog();
    await asService(async (c) => {
      await c.query(`
        insert into auth.users (id, email, raw_user_meta_data) values
          ($1,'neha@techzoid.in','{"name":"Neha"}'),
          ($2,'rajiv@techzoid.in','{"name":"Rajiv"}')
        on conflict (id) do nothing`, [NEHA_INTERNAL, RAJIV_INTERNAL]);
      await c.query(`update public.profiles set entra_oid = null where id in ($1,$2)`,
        [NEHA_INTERNAL, RAJIV_INTERNAL]);

      const company = (await c.query(
        `select id from public.companies order by created_at limit 1`)).rows[0].id;
      await c.query(`insert into public.company_members (company_id, user_id, role)
        values ($1,$2,'Sales'), ($1,$3,'Sales') on conflict do nothing`,
      [company, NEHA_INTERNAL, RAJIV_INTERNAL]);

      await c.query(`delete from public.customers where id like 'entra-%'`);
      await c.query(`insert into public.customers (id, owner_id, company_id, data)
        values ('entra-nehas',$1,$2,'{"company":"Northwind"}')`, [NEHA_INTERNAL, company]);
    });
  });

  afterAll(async () => {
    await asService(async (c) => {
      await c.query(`delete from public.customers where id like 'entra-%'`);
      await c.query(`update public.profiles set entra_oid = null where id in ($1,$2)`,
        [NEHA_INTERNAL, RAJIV_INTERNAL]);
    });
    await closePool();
  });

  /* -- THE ONE THAT MATTERS ------------------------------------------
     Linked by email on first sign-in, and from then on the Entra token
     resolves to the id the rows already hold. Not the Entra id. */
  it("links on first sign-in and resolves to the existing user id", async () => {
    const caller = await callerOf(`Bearer ${entraToken(NEHA_OID, "neha@techzoid.in")}`,
      { config: entraConfig });

    expect(caller.userId).toBe(NEHA_INTERNAL);
    expect(caller.userId).not.toBe(NEHA_OID);
  });

  it("sees the records that were already hers", async () => {
    /* The whole point. If the translation were skipped, this would be an
       empty array and the CRM would look like it had lost her customers. */
    const caller = await callerOf(`Bearer ${entraToken(NEHA_OID, "neha@techzoid.in")}`,
      { config: entraConfig });
    const { data } = await asUser(caller.userId, (c) =>
      runQuery(c, { op: "select", table: "customers", select: "id",
        filters: [{ col: "id", op: "eq", value: "entra-nehas" }] }));

    expect(data).toEqual([{ id: "entra-nehas" }]);
  });

  it("keeps resolving after the first time, without relinking", async () => {
    await callerOf(`Bearer ${entraToken(NEHA_OID, "neha@techzoid.in")}`, { config: entraConfig });
    /* Second sign-in, and the address no longer matters — the link is on
       the object id now. An address that changed in the directory must not
       silently detach somebody from their own work. */
    const again = await callerOf(`Bearer ${entraToken(NEHA_OID, "neha.sharma@techzoid.in")}`,
      { config: entraConfig });
    expect(again.userId).toBe(NEHA_INTERNAL);
  });

  /* -- AND THE OTHER ONE THAT MATTERS -------------------------------- */
  it("refuses an account that is not linked, rather than passing it through", async () => {
    /* Passing it through is the dangerous outcome: the Entra id would be
       stamped on the connection, match nothing, and present as data loss. */
    await expect(callerOf(`Bearer ${entraToken(STRANGER_OID, "nobody@example.com")}`,
      { config: entraConfig })).rejects.toThrow(AuthError);
  });

  it("refuses a tenant member who is not a CRM user", async () => {
    /* Being an employee is not the same as having an account here, and
       nothing auto-creates a profile. */
    await expect(callerOf(`Bearer ${entraToken(STRANGER_OID, "intern@techzoid.in")}`,
      { config: entraConfig })).rejects.toThrow(/not linked/);
  });

  it("will not let a second Entra account claim a linked profile", async () => {
    /* Rajiv links normally... */
    const first = await callerOf(`Bearer ${entraToken(RAJIV_OID, "rajiv@techzoid.in")}`,
      { config: entraConfig });
    expect(first.userId).toBe(RAJIV_INTERNAL);

    /* ...and a different Entra account naming his address is refused, not
       handed his records. */
    await expect(callerOf(`Bearer ${entraToken(STRANGER_OID, "rajiv@techzoid.in")}`,
      { config: entraConfig })).rejects.toThrow(AuthError);
  });

  it("refuses a token with no address to match on", async () => {
    await expect(callerOf(`Bearer ${entraToken(STRANGER_OID, "")}`,
      { config: entraConfig })).rejects.toThrow(AuthError);
  });

  it("matches an address regardless of how it was capitalised", async () => {
    await asService(async (c) => {
      await c.query(`update public.profiles set entra_oid = null where id = $1`, [NEHA_INTERNAL]);
    });
    const caller = await callerOf(`Bearer ${entraToken(NEHA_OID, "Neha@TechZoid.IN")}`,
      { config: entraConfig });
    expect(caller.userId).toBe(NEHA_INTERNAL);
  });

  it("is not callable from a browser", async () => {
    /* SECURITY DEFINER and service-role only. A caller who could run it
       could hand themselves somebody else's records by naming their email.
       TWO things refuse it and the outer one wins: the GRANT is revoked, so
       Postgres says "permission denied" before the function body runs at
       all. The `auth.role()` check inside is a second lock, for the day
       somebody restores the grant without reading why it was taken away —
       it is NOT demonstrated here, because reaching it means granting
       execute as the function's owner and this connection is not. Asserting
       either message is honest about which one actually fired. */
    await expect(asUser(NEHA_INTERNAL, (c) =>
      c.query("select public.link_entra_identity($1,$2)", [STRANGER_OID, "rajiv@techzoid.in"])
    )).rejects.toThrow(/permission denied|not callable from a browser/);
  });

  describe("a Supabase token, which must keep working throughout", () => {
    it("is used as-is, with no lookup", async () => {
      /* The cutover is gradual: both directories have to work while people
         are still linking. A Supabase subject IS the internal id. */
      const head = b64({ alg: "HS256", typ: "JWT" });
      const body = b64({ sub: NEHA_INTERNAL, exp: Math.floor(Date.now() / 1000) + 3600 });
      const token = `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;

      const verified = await verifyToken(token, {
        config: { ...entraConfig, directory: "supabase" },
      });
      const caller = await resolveCaller(verified, {
        linkIdentity: () => { throw new Error("must not look anything up"); },
      });
      expect(caller.userId).toBe(NEHA_INTERNAL);
    });
  });
});
