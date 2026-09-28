import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, closePool } from "./db.mjs";
import { forgetCatalog } from "./query.mjs";
import { anonymous, forUser, service } from "./serviceClient.mjs";

/**
 * The server's client: that it composes the same queries as the browser's,
 * and that `service()` and `forUser()` really are different powers.
 *
 * THE DRIFT PROBLEM. There are now two implementations of the same builder —
 * `src/data/pgClient.ts` over HTTP for the browser, and `serviceClient.mjs`
 * in process for the scheduled jobs. Two implementations of one contract
 * drift, and the way this one would drift is silent: a method added to the
 * browser's and forgotten here means a scheduled job quietly stops filtering.
 * The first block below runs the same chains through both and compares the
 * descriptions they produce, so a divergence fails the build instead.
 */
const HAVE_DB = !!(process.env.PGCONNECTION_STRING || process.env.DATABASE_URL);
const d = HAVE_DB ? describe : describe.skip;

const OWNER = "13131313-1313-1313-1313-131313131313";
const STRANGER = "24242424-2424-2424-2424-242424242424";

/* -- the two builders must agree -------------------------------------- */

describe("the same query, described the same way", () => {
  /* Neither builder needs a database to be asked what it WOULD send: both
     expose the description they have composed. So this compares the two
     without running anything, and without either one being instrumented. */

  /** Every chain the CRM actually writes, run through both. */
  const CHAINS = [
    ["a plain select", (c) => c.from("customers").select("id, data")],
    ["a filtered select", (c) => c.from("quotes").select("id").eq("company_id", "c1")],
    ["several filters", (c) => c.from("quotes").select("id").eq("a", 1).neq("b", 2).in("c", [3, 4])],
    ["comparisons", (c) => c.from("quotes").select("id").gt("a", 1).gte("b", 2).lt("c", 3).lte("d", 4)],
    ["a pattern", (c) => c.from("customers").select("id").ilike("name", "%acme%")],
    ["a null check", (c) => c.from("customers").select("id").is("company_id", null)],
    ["ordering", (c) => c.from("quotes").select("id").order("created_at", { ascending: false })],
    ["two orderings", (c) => c.from("quotes").select("id").order("a").order("b", { ascending: false })],
    ["a page", (c) => c.from("quotes").select("id").limit(5)],
    ["a range", (c) => c.from("quotes").select("id").range(10, 19)],
    ["a count", (c) => c.from("quotes").select("id", { count: "exact" })],
    ["an insert", (c) => c.from("customers").insert({ id: "a" }).select("id")],
    ["an upsert", (c) => c.from("customers").upsert({ id: "a" }, { onConflict: "email", ignoreDuplicates: true })],
    ["an update", (c) => c.from("customers").update({ data: {} }).eq("id", "a")],
    ["a delete", (c) => c.from("customers").delete().eq("id", "a")],
    ["a branched base query", (c) => {
      /* The shape `netlify/lib/company.mjs` uses. A mutating builder would
         have this come out carrying the other branch's filter. */
      const base = c.from("customers").select("id");
      void base.eq("company_id", "other");
      return base.eq("company_id", "mine");
    }],
  ];

  it.each(CHAINS)("%s", async (_name, chain) => {
    const { createPgClient } = await import("../../src/data/pgClient.ts");
    const { createClient } = await import("./serviceClient.mjs");

    /* Neither transport is ever called: `toSpec` reads the description off
       the builder without running it. */
    const browser = createPgClient({ transport: async () => ({ data: [], error: null }) });
    const server = createClient(() => { throw new Error("nothing should run here"); });

    expect(chain(server).toSpec()).toEqual(chain(browser).toSpec());
  });

  it("covers every filter and shaping method the browser client has", async () => {
    /* The drift this guards against is silent and one-directional: a method
       added to the browser's builder and forgotten here means a scheduled
       job quietly stops filtering. So the list of methods is compared, not
       just the chains above — a new one fails this until it is added to
       both and exercised. */
    const { createPgClient } = await import("../../src/data/pgClient.ts");
    const { createClient } = await import("./serviceClient.mjs");

    const browser = createPgClient({ transport: async () => ({ data: [], error: null }) });
    const server = createClient(() => { throw new Error("nothing should run here"); });

    const methodsOf = (builder) => {
      const proto = Object.getPrototypeOf(builder);
      return Object.getOwnPropertyNames(proto)
        .filter((n) => n !== "constructor" && typeof builder[n] === "function")
        .sort();
    };

    const browserMethods = methodsOf(browser.from("customers").select("*"));
    const serverMethods = methodsOf(server.from("customers").select("*"));

    /* The server's builder may have MORE (`not`, which the browser has no
       call site for). It must never have fewer. */
    const missing = browserMethods.filter((m) => !serverMethods.includes(m));
    expect(missing).toEqual([]);
  });
});

/* -- and behave, against a real database ------------------------------ */

d("what each client is allowed to see", () => {
  beforeAll(async () => {
    forgetCatalog();
    await asService(async (c) => {
      await c.query(`
        insert into auth.users (id, email, raw_user_meta_data) values
          ($1,'owner@techzoid.in','{"name":"Owner"}'),
          ($2,'stranger@techzoid.in','{"name":"Stranger"}')
        on conflict (id) do nothing`, [OWNER, STRANGER]);
      const company = (await c.query(
        `select id from public.companies order by created_at limit 1`)).rows[0].id;
      await c.query(`insert into public.company_members (company_id, user_id, role)
        values ($1,$2,'Sales'), ($1,$3,'Sales') on conflict do nothing`,
      [company, OWNER, STRANGER]);
      await c.query(`delete from public.customers where id like 'svc-%'`);
      await c.query(`insert into public.customers (id, owner_id, company_id, data)
        values ('svc-1',$1,$2,'{"company":"Fourth Coffee"}')`, [OWNER, company]);
    });
  });

  afterAll(async () => {
    await asService(async (c) => { await c.query(`delete from public.customers where id like 'svc-%'`); });
    await closePool();
  });

  it("forUser sees their own rows", async () => {
    const { data } = await forUser(OWNER).from("customers").select("id").eq("id", "svc-1");
    expect(data).toEqual([{ id: "svc-1" }]);
  });

  /* -- THE ONE THAT MATTERS ------------------------------------------
     `service()` bypasses RLS and `forUser()` does not. If these were the
     same, every scheduled job would be one careless line away from showing
     one customer another customer's documents. */
  it("forUser does NOT see somebody else's, but service does", async () => {
    const stranger = await forUser(STRANGER).from("customers").select("id").eq("id", "svc-1");
    const job = await service().from("customers").select("id").eq("id", "svc-1");
    expect(stranger.data).toEqual([]);
    expect(job.data).toEqual([{ id: "svc-1" }]);
  });

  it("anonymous sees nothing", async () => {
    const { data } = await anonymous().from("customers").select("id").eq("id", "svc-1");
    expect(data).toEqual([]);
  });

  it("supports the negated filter the company helper needs", async () => {
    const { data, error } = await service().from("customers")
      .select("id").not("company_id", "is", null).limit(5);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("reports an error rather than throwing, so a scheduled run carries on", async () => {
    const { data, error } = await service().from("customers").select("no_such_column");
    expect(data).toBeNull();
    expect(error?.message).toContain("Unknown column");
  });

  it("calls a whitelisted function", async () => {
    const { data, error } = await service().rpc("next_customer_code");
    expect(error).toBeNull();
    expect(typeof data === "string" || data === null).toBe(true);
  });

  it("refuses a function that is not whitelisted, without taking a connection", async () => {
    const { data, error } = await service().rpc("pg_sleep", { seconds: 10 });
    expect(data).toBeNull();
    expect(error?.message).toBe("Unknown function.");
  });

  /* -- THE ONE THAT WAS ALREADY WRONG ONCE ---------------------------
     The rate limiter's function is deliberately off the browser's
     whitelist. When that was the ONLY whitelist, `consume()` could not
     call it, threw, was caught, logged, and FAILED OPEN — so the public
     registration form, which is unauthenticated by design and therefore
     the endpoint that most needs a limit, had none. It answered 200 and
     saved the row. Nothing looked broken. */
  it("can call the rate limiter, which the browser cannot", async () => {
    const { data, error } = await service().rpc("consume_rate_limit", {
      p_key: `test:${Date.now()}`, p_limit: 3, p_window_seconds: 60,
    });
    expect(error).toBeNull();
    expect(data[0].allowed).toBe(true);
    expect(data[0].remaining).toBe(2);
  });

  it("actually refuses once the allowance is spent", async () => {
    /* Proving it counts, not merely that it answers. */
    const key = `test:spend:${Date.now()}`;
    const ask = () => service().rpc("consume_rate_limit",
      { p_key: key, p_limit: 2, p_window_seconds: 60 });
    expect((await ask()).data[0].allowed).toBe(true);
    expect((await ask()).data[0].allowed).toBe(true);
    expect((await ask()).data[0].allowed).toBe(false);
  });

  it("can ask whether somebody may manage a sending account", async () => {
    const { error } = await service().rpc("may_manage_email_account",
      { p_account_id: "00000000-0000-0000-0000-000000000000" });
    expect(error).toBeNull();
  });
});
