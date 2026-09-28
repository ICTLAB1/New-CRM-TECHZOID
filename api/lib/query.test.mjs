import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, closePool } from "./db.mjs";
import { QueryError, compile, forgetCatalog, getCatalog, runQuery } from "./query.mjs";

/**
 * Run against a REAL PostgreSQL carrying the real schema and the real
 * policies. Two things are being proved and only a real database can prove
 * either: that a hostile query description cannot become SQL, and that the
 * row-level-security policies still decide what comes back now that
 * PostgREST is gone.
 *
 * A mock would assert that this file calls the functions it says it calls.
 * That is not the question.
 */
const HAVE_DB = !!(process.env.PGCONNECTION_STRING || process.env.DATABASE_URL);
const d = HAVE_DB ? describe : describe.skip;

const RAVI  = "11111111-1111-1111-1111-111111111111";
const MEENA = "22222222-2222-2222-2222-222222222222";
const BOSS  = "33333333-3333-3333-3333-333333333333";

let catalog;
let COMPANY;

d("the query translator", () => {
  beforeAll(async () => {
    forgetCatalog();
    await asService(async (c) => {
      await c.query(`
        insert into auth.users (id, email, raw_user_meta_data) values
          ($1,'ravi@techzoid.in','{"name":"Ravi"}'),
          ($2,'meena@techzoid.in','{"name":"Meena"}'),
          ($3,'boss@techzoid.in','{"name":"Boss"}')
        on conflict (id) do nothing`, [RAVI, MEENA, BOSS]);
      await c.query(`update public.profiles set role='Admin' where id=$1`, [BOSS]);
      await c.query(`insert into public.company_members (company_id, user_id, role)
        select (select id from public.companies order by created_at limit 1), v.id::uuid, v.role
        from (values ($1,'Sales'), ($2,'Sales'), ($3,'Admin')) as v(id, role)
        on conflict do nothing`, [RAVI, MEENA, BOSS]);
      await c.query(`insert into public.customers (id, owner_id, data)
        values ('c-ravi',$1,'{"company":"Acme"}'),
               ('c-ravi-2',$1,'{"company":"Borax"}')
        on conflict (id) do nothing`, [RAVI]);

      COMPANY = (await c.query(
        `select id from public.companies order by created_at limit 1`)).rows[0].id;
      catalog = await getCatalog(c);
    });
  });
  afterAll(async () => { await closePool(); });

  /* ── THE ONES THAT MATTER ──────────────────────────────────────────
     This endpoint takes a query description from a browser. If any of
     these compiled, the CRM would have an SQL injection hole with a
     public door on it. */

  describe("refuses to let caller text become SQL", () => {
    const refused = (spec) => expect(() => compile(spec, catalog)).toThrow(QueryError);

    it("an unknown table", () => {
      refused({ op: "select", table: "customers; drop table customers --", select: "*" });
      refused({ op: "select", table: "pg_shadow", select: "*" });
      refused({ op: "select", table: "auth.users", select: "*" });
    });

    it("an unknown column in the select list", () => {
      refused({ op: "select", table: "customers", select: "id, (select 1)" });
      refused({ op: "select", table: "customers", select: "nonexistent" });
    });

    it("an unknown column in a filter", () => {
      refused({ op: "select", table: "customers", select: "*",
        filters: [{ col: "id) or true --", op: "eq", value: 1 }] });
    });

    it("an unknown column in an order", () => {
      refused({ op: "select", table: "customers", select: "*",
        order: [{ col: "id; drop table customers" }] });
    });

    it("an operator that is not on the list", () => {
      refused({ op: "select", table: "customers", select: "*",
        filters: [{ col: "id", op: "= 1 or 1=1 --", value: 1 }] });
    });

    it("an `is` with anything but null or a boolean", () => {
      refused({ op: "select", table: "customers", select: "*",
        filters: [{ col: "id", op: "is", value: "null; drop table customers" }] });
    });

    it("an unknown column in an upsert conflict target", () => {
      refused({ op: "upsert", table: "customers", values: { id: "x", owner_id: RAVI },
        onConflict: "id) do update set owner_id = 'x' --" });
    });

    it("an unknown embedded table", () => {
      refused({ op: "select", table: "company_members", select: "role, pg_shadow(usename)" });
    });

    it("an operation that is not one of the five", () => {
      refused({ op: "truncate", table: "customers" });
      refused({ op: "select; drop table customers", table: "customers" });
    });

    /* A hostile VALUE is not refused — it is bound. Proving it stays data
       is the other half of the argument. */
    it("binds a hostile value rather than rejecting it", async () => {
      const nasty = "'; drop table public.customers; --";
      const rows = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        filters: [{ col: "id", op: "eq", value: nasty }],
      }));
      expect(rows.data).toEqual([]);
      const still = await asService(async (c) =>
        (await c.query("select count(*)::int as n from public.customers")).rows[0].n);
      expect(still).toBeGreaterThan(0);
    });

    it("never puts a caller's string into the SQL text", () => {
      const { text, params } = compile({
        op: "select", table: "customers", select: "id",
        filters: [{ col: "id", op: "eq", value: "c-ravi" }],
      }, catalog);
      expect(text).not.toContain("c-ravi");
      expect(params).toContain("c-ravi");
    });
  });

  /* ── RLS, WHICH IS THE WHOLE POINT ────────────────────────────────
     PostgREST is gone. The policies are not. */

  describe("leaves row-level security in charge", () => {
    it("shows a salesperson their own records", async () => {
      const { data } = await asUser(RAVI, (c) =>
        runQuery(c, { op: "select", table: "customers", select: "id" }));
      expect(data.map((r) => r.id).sort()).toEqual(["c-ravi", "c-ravi-2"]);
    });

    it("hides them from another salesperson", async () => {
      const { data } = await asUser(MEENA, (c) =>
        runQuery(c, { op: "select", table: "customers", select: "id" }));
      expect(data).toEqual([]);
    });

    it("shows an unauthenticated caller nothing", async () => {
      const { data } = await asAnon((c) =>
        runQuery(c, { op: "select", table: "customers", select: "id" }));
      expect(data).toEqual([]);
    });

    it("refuses a write the policies do not allow", async () => {
      /* Meena writing over Ravi's customer. The update is well formed and
         runs; RLS matches no row, so nothing changes. */
      const { data } = await asUser(MEENA, (c) => runQuery(c, {
        op: "update", table: "customers", values: { data: { company: "Taken" } },
        filters: [{ col: "id", op: "eq", value: "c-ravi" }], select: "id",
      }));
      expect(data).toEqual([]);
      const after = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "data",
        filters: [{ col: "id", op: "eq", value: "c-ravi" }], single: "one",
      }));
      expect(after.data.data.company).toBe("Acme");
    });
  });

  /* ── the twelve builder methods, against PostgREST's behaviour ──── */

  describe("reproduces the builder the CRM uses", () => {
    it("eq, and a select list", async () => {
      const { data } = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id, owner_id",
        filters: [{ col: "id", op: "eq", value: "c-ravi" }],
      }));
      expect(data).toEqual([{ id: "c-ravi", owner_id: RAVI }]);
    });

    it("in, including the empty list PostgREST answers with nothing", async () => {
      const some = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        filters: [{ col: "id", op: "in", value: ["c-ravi", "nope"] }],
      }));
      expect(some.data).toEqual([{ id: "c-ravi" }]);

      const none = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        filters: [{ col: "id", op: "in", value: [] }],
      }));
      expect(none.data).toEqual([]);
    });

    it("a negated filter, which is `.not(col, op, value)`", async () => {
      /* One call site needs this: netlify/lib/company.mjs asks for the rows
         whose company_id is NOT null. */
      const withCompany = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        filters: [{ col: "company_id", op: "is", value: null, negate: true }],
      }));
      const withoutCompany = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        filters: [{ col: "company_id", op: "is", value: null }],
      }));
      const all = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
      }));
      /* The two halves partition the whole. Asserting that rather than a
         fixed number keeps the test honest whatever else is in the table. */
      expect(withCompany.data.length + withoutCompany.data.length).toBe(all.data.length);
      expect(withCompany.data.length).toBeGreaterThan(0);
    });

    it("negates an equality as well, parenthesised", () => {
      const { text } = compile({
        op: "select", table: "customers", select: "id",
        filters: [{ col: "id", op: "eq", value: "x", negate: true }],
      }, catalog);
      /* Parenthesised because `not a = b` and `not (a = b)` part company as
         soon as a clause has more than one term in it. */
      expect(text).toContain("not (");
    });

    it("or, which is how the prospect search works", async () => {
      /* One call site needs this: searching prospects by email OR company OR
         name in a single query, so the count comes back right. */
      const { data } = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        filters: [{ op: "or", terms: [
          { col: "id", op: "eq", value: "c-ravi" },
          { col: "id", op: "eq", value: "c-ravi-2" },
        ] }],
      }));
      expect(data.map((r) => r.id).sort()).toEqual(["c-ravi", "c-ravi-2"]);
    });

    it("keeps an or bracketed, so a later filter still narrows it", async () => {
      /* `a and (b or c)` and `a and b or c` are different queries and the
         second one is the bug: it would show rows the `and` was meant to
         exclude. The parentheses are the whole point. */
      const { data } = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        filters: [
          { col: "id", op: "eq", value: "c-ravi" },
          { op: "or", terms: [
            { col: "id", op: "eq", value: "c-ravi" },
            { col: "id", op: "eq", value: "c-ravi-2" },
          ] },
        ],
      }));
      expect(data.map((r) => r.id)).toEqual(["c-ravi"]);
    });

    it("checks every column inside an or against the catalog", () => {
      expect(() => compile({
        op: "select", table: "customers", select: "id",
        filters: [{ op: "or", terms: [{ col: "id; drop table customers", op: "eq", value: 1 }] }],
      }, catalog)).toThrow(QueryError);
      expect(() => compile({
        op: "select", table: "customers", select: "id",
        filters: [{ op: "or", terms: [{ col: "id", op: "= 1 or 1=1 --", value: 1 }] }],
      }, catalog)).toThrow(QueryError);
    });

    it("refuses a nested or, and an empty one", () => {
      /* Bounded so a request cannot nest its way into a stack overflow. */
      expect(() => compile({
        op: "select", table: "customers", select: "id",
        filters: [{ op: "or", terms: [{ op: "or", terms: [{ col: "id", op: "eq", value: 1 }] }] }],
      }, catalog)).toThrow(/nested/);
      expect(() => compile({
        op: "select", table: "customers", select: "id",
        filters: [{ op: "or", terms: [] }],
      }, catalog)).toThrow(QueryError);
    });

    it("order, limit and range", async () => {
      const desc = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        order: [{ col: "id", asc: false }],
      }));
      expect(desc.data.map((r) => r.id)).toEqual(["c-ravi-2", "c-ravi"]);

      const one = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        order: [{ col: "id", asc: true }], limit: 1,
      }));
      expect(one.data).toEqual([{ id: "c-ravi" }]);

      const second = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        order: [{ col: "id", asc: true }], range: [1, 1],
      }));
      expect(second.data).toEqual([{ id: "c-ravi-2" }]);
    });

    it("single and maybeSingle", async () => {
      const one = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        filters: [{ col: "id", op: "eq", value: "c-ravi" }], single: "one",
      }));
      expect(one.data).toEqual({ id: "c-ravi" });

      const maybe = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        filters: [{ col: "id", op: "eq", value: "absent" }], single: "maybe",
      }));
      expect(maybe.data).toBeNull();

      /* `single` on two rows is an error, not the first row — returning one
         quietly is how a screen shows the wrong customer. */
      await expect(asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id", single: "one",
      }))).rejects.toThrow(QueryError);
    });

    it("counts every matching row, not just the page", async () => {
      const { data, count } = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id", limit: 1, count: "exact",
        order: [{ col: "id", asc: true }],
      }));
      expect(data).toHaveLength(1);
      expect(count).toBe(2);
    });

    it("an inner embed, shaped as PostgREST shaped it", async () => {
      const { data } = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "company_members",
        select: "role, companies!inner(id, name)",
        filters: [{ col: "user_id", op: "eq", value: RAVI }],
      }));
      expect(data).toHaveLength(1);
      expect(data[0].role).toBe("Sales");
      expect(data[0].companies.id).toBe(COMPANY);
      expect(typeof data[0].companies.name).toBe("string");
    });

    it("insert returning the inserted row", async () => {
      const { data } = await asUser(RAVI, (c) => runQuery(c, {
        op: "insert", table: "customers",
        values: { id: "c-new", owner_id: RAVI, data: { company: "Fresh" }, company_id: COMPANY },
        select: "id",
      }));
      expect(data).toEqual([{ id: "c-new" }]);
    });

    it("upsert on the primary key", async () => {
      await asUser(RAVI, (c) => runQuery(c, {
        op: "upsert", table: "customers",
        values: { id: "c-new", owner_id: RAVI, data: { company: "Changed" }, company_id: COMPANY },
      }));
      const { data } = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "data",
        filters: [{ col: "id", op: "eq", value: "c-new" }], single: "one",
      }));
      expect(data.data.company).toBe("Changed");
    });

    it("upsert with ignoreDuplicates leaves the existing row alone", async () => {
      await asUser(RAVI, (c) => runQuery(c, {
        op: "upsert", table: "customers", onConflict: "id", ignoreDuplicates: true,
        values: { id: "c-new", owner_id: RAVI, data: { company: "Ignored" }, company_id: COMPANY },
      }));
      const { data } = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "data",
        filters: [{ col: "id", op: "eq", value: "c-new" }], single: "one",
      }));
      expect(data.data.company).toBe("Changed");
    });

    it("update, then delete", async () => {
      await asUser(RAVI, (c) => runQuery(c, {
        op: "update", table: "customers", values: { data: { company: "Updated" } },
        filters: [{ col: "id", op: "eq", value: "c-new" }],
      }));
      const mid = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "data",
        filters: [{ col: "id", op: "eq", value: "c-new" }], single: "one",
      }));
      expect(mid.data.data.company).toBe("Updated");

      await asUser(RAVI, (c) => runQuery(c, {
        op: "delete", table: "customers",
        filters: [{ col: "id", op: "eq", value: "c-new" }],
      }));
      const gone = await asUser(RAVI, (c) => runQuery(c, {
        op: "select", table: "customers", select: "id",
        filters: [{ col: "id", op: "eq", value: "c-new" }], single: "maybe",
      }));
      expect(gone.data).toBeNull();
    });

    it("returns no rows when nothing asked for them", async () => {
      const { data } = await asUser(RAVI, (c) => runQuery(c, {
        op: "update", table: "customers", values: { data: { company: "Acme" } },
        filters: [{ col: "id", op: "eq", value: "c-ravi" }],
      }));
      expect(data).toBeNull();
    });
  });

  /* ── the guards that are not about injection ──────────────────────── */

  describe("refuses writes that would take the whole table with them", () => {
    it("an update with no filter", () => {
      expect(() => compile({ op: "update", table: "customers", values: { data: {} } }, catalog))
        .toThrow(/which rows/);
    });

    it("a delete with no filter", () => {
      expect(() => compile({ op: "delete", table: "customers" }, catalog))
        .toThrow(/which rows/);
    });

    it("rows in one insert that disagree about their columns", () => {
      expect(() => compile({
        op: "insert", table: "customers",
        values: [{ id: "a", owner_id: RAVI }, { id: "b" }],
      }, catalog)).toThrow(/same columns/);
    });
  });
});
