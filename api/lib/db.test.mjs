import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, closePool, getPool } from "./db.mjs";

/**
 * Run against a REAL PostgreSQL carrying the real schema — every migration,
 * all 89 policies. A mocked pool would prove the code calls the functions it
 * says it calls; it would not prove that `set local` reverts, which is the
 * only thing here worth proving.
 *
 * Skipped automatically when no database is configured, so CI without one
 * stays green rather than red-for-the-wrong-reason.
 */
const HAVE_DB = !!(process.env.PGCONNECTION_STRING || process.env.DATABASE_URL);
const d = HAVE_DB ? describe : describe.skip;

const RAVI  = "11111111-1111-1111-1111-111111111111";
const MEENA = "22222222-2222-2222-2222-222222222222";
const BOSS  = "33333333-3333-3333-3333-333333333333";

d("the identity gate", () => {
  beforeAll(async () => {
    await asService(async (c) => {
      await c.query(`
        insert into auth.users (id, email, raw_user_meta_data) values
          ($1,'ravi@techzoid.in','{"name":"Ravi"}'),
          ($2,'meena@techzoid.in','{"name":"Meena"}'),
          ($3,'boss@techzoid.in','{"name":"Boss"}')
        on conflict (id) do nothing`, [RAVI, MEENA, BOSS]);
      await c.query(`update public.profiles set role='Admin' where id=$1`, [BOSS]);
      await c.query(`insert into public.customers (id, owner_id, data)
        values ('c-ravi',$1,'{"company":"Acme"}') on conflict (id) do nothing`, [RAVI]);
    });
  });
  afterAll(async () => { await closePool(); });

  it("stamps the caller so auth.uid() resolves", async () => {
    const uid = await asUser(RAVI, async (c) =>
      (await c.query("select auth.uid()::text as uid")).rows[0].uid);
    expect(uid).toBe(RAVI);
  });

  it("shows a salesperson their own records", async () => {
    const n = await asUser(RAVI, async (c) =>
      (await c.query("select count(*)::int as n from public.customers")).rows[0].n);
    expect(n).toBe(1);
  });

  it("hides them from another salesperson", async () => {
    const n = await asUser(MEENA, async (c) =>
      (await c.query("select count(*)::int as n from public.customers")).rows[0].n);
    expect(n).toBe(0);
  });

  it("lets an Admin see everything", async () => {
    const [n, priv] = await asUser(BOSS, async (c) => [
      (await c.query("select count(*)::int as n from public.customers")).rows[0].n,
      (await c.query("select public.is_privileged() as p")).rows[0].p,
    ]);
    expect(n).toBe(1);
    expect(priv).toBe(true);
  });

  /* ── THE ONE THAT MATTERS ──────────────────────────────────────────
     Pooled connections. If identity survived the transaction, the next
     request to borrow the connection would run as the previous user, with
     nothing erroring anywhere. This runs enough requests to guarantee reuse
     and checks the identity is gone every time. */
  it("never leaks one caller's identity into the next request", async () => {
    for (let i = 0; i < 25; i++) {
      await asUser(i % 2 ? RAVI : MEENA, async (c) => {
        await c.query("select 1");
      });
      const leaked = await asAnon(async (c) =>
        (await c.query("select coalesce(auth.uid()::text,'(none)') as uid")).rows[0].uid);
      expect(leaked, `leaked after request ${i}`).toBe("(none)");
    }
  });

  it("hands back a clean connection even when the work throws", async () => {
    await expect(asUser(RAVI, async (c) => {
      await c.query("select 1");
      throw new Error("boom");
    })).rejects.toThrow("boom");

    const uid = await asAnon(async (c) =>
      (await c.query("select coalesce(auth.uid()::text,'(none)') as uid")).rows[0].uid);
    expect(uid).toBe("(none)");
  });

  it("rolls the work back when it throws, rather than half-writing it", async () => {
    await expect(asUser(RAVI, async (c) => {
      await c.query(`insert into public.customers (id, owner_id, data) values ('c-rollback',$1,'{}')`, [RAVI]);
      throw new Error("changed my mind");
    })).rejects.toThrow();

    const found = await asService(async (c) =>
      (await c.query("select count(*)::int as n from public.customers where id='c-rollback'")).rows[0].n);
    expect(found).toBe(0);
  });

  it("gives an unauthenticated caller nothing, not everything", async () => {
    const n = await asAnon(async (c) =>
      (await c.query("select count(*)::int as n from public.customers")).rows[0].n);
    expect(n).toBe(0);
  });

  it("still refuses anon the things migration 019 and 021 locked", async () => {
    await expect(asAnon(async (c) => c.query("select count(*) from public.portal_tokens")))
      .rejects.toThrow(/permission denied/i);
    await expect(asAnon(async (c) => c.query("select public.next_doc_seq('quote')")))
      .rejects.toThrow(/permission denied/i);
  });

  /* An identity that is not a uuid is interpolated into a SET LOCAL, which
     takes a literal rather than a bind parameter — precisely the shape SQL
     injection likes. It must never reach the database. */
  it("refuses an identity that is not a uuid, before touching the database", async () => {
    for (const bad of ["'; drop table public.customers; --", "not-a-uuid", "", null, undefined]) {
      await expect(asUser(bad, async () => "reached"), String(bad)).rejects.toThrow(/uuid/i);
    }
    const alive = await asService(async (c) =>
      (await c.query("select count(*)::int as n from public.customers")).rows[0].n);
    expect(alive).toBeGreaterThan(0);
  });

  it("lets service_role through RLS, which is what it is for", async () => {
    const n = await asService(async (c) =>
      (await c.query("select count(*)::int as n from public.customers")).rows[0].n);
    expect(n).toBeGreaterThan(0);
  });
});
