import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgClient } from "./pgClient";
import { createStore } from "./store";
import type { Db } from "./db";
// @ts-expect-error -- plain JavaScript, deliberately: the API tier is not TypeScript.
import { asUser, asService, closePool } from "../../api/lib/db.mjs";
// @ts-expect-error -- as above.
import { forgetCatalog, runQuery } from "../../api/lib/query.mjs";

/**
 * The whole data layer, with no Supabase anywhere in it.
 *
 * The CRM's real `createStore` — not a copy of it, not a fake — driving the
 * real browser-side builder, whose requests are compiled by the real
 * translator and run on a real PostgreSQL carrying the real schema and the
 * real 89 policies. Every other test in this migration checks one link of
 * that chain. This one checks that the chain holds, because a migration that
 * proves each piece and never assembles them has proved nothing about the
 * thing being shipped.
 *
 * The one link deliberately left out is HTTP: the transport calls the
 * translator directly rather than going over a socket. That is not the part
 * that can be wrong — what can be wrong is a filter that does not survive
 * the trip, or a policy that stops applying once PostgREST is not the one
 * asking. Both are exercised here.
 */
const HAVE_DB = !!(process.env.PGCONNECTION_STRING || process.env.DATABASE_URL);
const d = HAVE_DB ? describe : describe.skip;

const SARA = "44444444-4444-4444-4444-444444444444";
const OMAR = "55555555-5555-5555-5555-555555555555";

let COMPANY: string;

/** A client that speaks to the translator as the given person. */
const clientFor = (userId: string): Db =>
  createPgClient({
    transport: (spec) => asUser(userId, (c: unknown) => runQuery(c, spec)),
  });

d("the data layer on plain PostgreSQL", () => {
  beforeAll(async () => {
    forgetCatalog();
    await asService(async (c: {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }>;
    }) => {
      await c.query(`
        insert into auth.users (id, email, raw_user_meta_data) values
          ($1,'sara@techzoid.in','{"name":"Sara"}'),
          ($2,'omar@techzoid.in','{"name":"Omar"}')
        on conflict (id) do nothing`, [SARA, OMAR]);
      const row = (await c.query(
        `select id from public.companies order by created_at limit 1`)).rows[0];
      COMPANY = String(row?.id);
      await c.query(`insert into public.company_members (company_id, user_id, role)
        values ($1,$2,'Sales'), ($1,$3,'Sales') on conflict do nothing`, [COMPANY, SARA, OMAR]);
      /* Cleared rather than assumed absent: this file is rerun. */
      await c.query(`delete from public.customers where id like 'e2e-%'`);
      await c.query(`delete from public.quotes where id like 'e2e-%'`);
    });
  });

  afterAll(async () => {
    await asService(async (c: { query: (sql: string) => Promise<unknown> }) => {
      await c.query(`delete from public.quotes where id like 'e2e-%'`);
      await c.query(`delete from public.customers where id like 'e2e-%'`);
    });
    await closePool();
  });

  it("writes a customer and reads it back through the whole stack", async () => {
    const store = createStore(clientFor(SARA), () => COMPANY);
    await store.syncEntity("customers", [], [
      { id: "e2e-1", ownerId: SARA, company: "Northwind Traders", stage: "lead" },
    ] as never);

    const found = await store.fetchEntity<{ id: string; ownerId: string; company: string }>("customers");
    const mine = found.filter((c) => c.id.startsWith("e2e-"));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.company).toBe("Northwind Traders");
  });

  /* ── THE ONE THAT MATTERS ──────────────────────────────────────────
     Every policy that decided who sees what under Supabase has to go on
     deciding it now that PostgREST is gone. If this passes and the rest
     fails, the migration is recoverable. If this fails, the CRM leaks. */
  it("still hides one salesperson's customers from another", async () => {
    const sara = createStore(clientFor(SARA), () => COMPANY);
    const omar = createStore(clientFor(OMAR), () => COMPANY);

    await sara.syncEntity("customers", [], [
      { id: "e2e-secret", ownerId: SARA, company: "Contoso", stage: "lead" },
    ] as never);

    const hers = (await sara.fetchEntity<{ id: string; ownerId: string }>("customers")).map((c) => c.id);
    const his = (await omar.fetchEntity<{ id: string; ownerId: string }>("customers")).map((c) => c.id);
    expect(hers).toContain("e2e-secret");
    expect(his).not.toContain("e2e-secret");
  });

  it("rewrites only the row that changed", async () => {
    const store = createStore(clientFor(SARA), () => COMPANY);
    const before = [
      { id: "e2e-a", ownerId: SARA, company: "Alpha", stage: "lead" },
      { id: "e2e-b", ownerId: SARA, company: "Beta", stage: "lead" },
    ];
    await store.syncEntity("customers", [], before as never);

    /* As strings. node-pg hands back `Date` objects for a timestamptz, and
       two of those are never `toBe` each other however equal the instants
       are — an identity comparison here would pass whatever the database
       did, which is worse than no test. */
    const stamps = async () => {
      const { data } = await clientFor(SARA).from("customers")
        .select("id, updated_at").in("id", ["e2e-a", "e2e-b"]).order("id");
      return (data as { id: string; updated_at: string | Date }[])
        .map((r) => new Date(r.updated_at).toISOString());
    };
    const first = await stamps();

    const after = [{ ...before[0], company: "Alpha Industries" }, before[1]];
    await store.syncEntity("customers", before as never, after as never,
      () => "2030-01-01T00:00:00.000Z");
    const second = await stamps();

    /* Alpha moved to the stamp the test supplied; Beta kept the one it had.
       Asserting the exact new value rather than merely "it changed" is what
       makes this fail if the store rewrote both rows — and rewriting both
       is the bug, because every touched row wakes every other signed-in
       browser for nothing. */
    expect(second[0]).toBe("2030-01-01T00:00:00.000Z");
    expect(second[1]).toBe(first[1]);
    expect(first[1]).not.toBe("2030-01-01T00:00:00.000Z");
  });

  it("deletes a row that has gone from the list", async () => {
    const store = createStore(clientFor(SARA), () => COMPANY);
    const rows = [{ id: "e2e-gone", ownerId: SARA, company: "Fabrikam", stage: "lead" }];
    await store.syncEntity("customers", [], rows as never);
    await store.syncEntity("customers", rows as never, [] as never);

    const left = (await store.fetchEntity<{ id: string; ownerId: string }>("customers")).map((c) => c.id);
    expect(left).not.toContain("e2e-gone");
  });

  it("loads a whole workspace in one go", async () => {
    const store = createStore(clientFor(SARA), () => COMPANY);
    await store.syncEntity("customers", [], [
      { id: "e2e-load", ownerId: SARA, company: "Tailspin", stage: "lead" },
    ] as never);
    await store.syncEntity("quotes", [], [
      { id: "e2e-q", ownerId: SARA, customerId: "e2e-load", number: "TZ/Q/1001", items: [] },
    ] as never);

    const loaded = await store.load();
    expect(loaded.data.customers.map((c) => c.id)).toContain("e2e-load");
    expect(loaded.data.quotations.map((q) => q.id)).toContain("e2e-q");
    /* Settings is one row per company and may legitimately be absent; what
       matters is that asking for it does not throw. */
    expect(typeof loaded.settings).toBe("object");
    expect(Array.isArray(loaded.profiles)).toBe(true);
  });

  it("reports a refused write rather than throwing", async () => {
    const client = clientFor(SARA);
    const { error } = await client.from("customers").select("no_such_column");
    expect(error?.message).toContain("Unknown column");
  });

  it("carries a live subscription that does nothing, and says so", () => {
    /* No change feed on Azure yet. `useWorkspace` polls underneath, so this
       degrades to a slower refresh — the test is that it does not crash. */
    const store = createStore(clientFor(SARA), () => COMPANY);
    const sub = store.subscribeAll(() => { throw new Error("should never fire"); });
    expect(typeof sub.unsubscribe).toBe("function");
    sub.unsubscribe();
  });
});
