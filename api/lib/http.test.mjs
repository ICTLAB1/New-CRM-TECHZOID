import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { asService, closePool } from "./db.mjs";
import { forgetCatalog } from "./query.mjs";
import { CALLABLE } from "./rpc.mjs";
import { handleQuery, handleRpc } from "./http.mjs";

/**
 * The endpoints, whole: a signed token in, rows out, with the real
 * translator, the real database, the real schema and the real 89 policies
 * in between.
 *
 * The unit tests either side of this prove the verifier refuses forged
 * tokens and the translator refuses hostile queries. What they cannot prove
 * is that the two are WIRED UP — that the id the verifier extracted is the
 * one the transaction is stamped with. That wiring is the whole endpoint,
 * and getting it wrong does not throw: it serves somebody else's data,
 * quietly, to a caller with a perfectly valid token of their own.
 */
const HAVE_DB = !!(process.env.PGCONNECTION_STRING || process.env.DATABASE_URL);
const d = HAVE_DB ? describe : describe.skip;

const SECRET = "a-test-signing-secret-that-is-not-real";
const PRIYA = "66666666-6666-6666-6666-666666666666";
const ARJUN = "99999999-9999-9999-9999-999999999999";

const options = {
  config: { alg: "HS256", secret: SECRET, issuer: null, audience: null, clockSkewSeconds: 60 },
  log: () => {},
};

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");

function tokenFor(userId, over = {}) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, ...over });
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** A request shaped the way Azure's HttpRequest is: Fetch-like. */
function request(body, { token = null, method = "POST", contentType = "application/json" } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headers = new Map();
  if (contentType) headers.set("content-type", contentType);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return {
    method,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
    text: async () => text,
  };
}

let COMPANY;

d("the query endpoint", () => {
  beforeAll(async () => {
    forgetCatalog();
    await asService(async (c) => {
      await c.query(`
        insert into auth.users (id, email, raw_user_meta_data) values
          ($1,'priya@techzoid.in','{"name":"Priya"}'),
          ($2,'arjun@techzoid.in','{"name":"Arjun"}')
        on conflict (id) do nothing`, [PRIYA, ARJUN]);
      COMPANY = (await c.query(
        `select id from public.companies order by created_at limit 1`)).rows[0].id;
      await c.query(`insert into public.company_members (company_id, user_id, role)
        values ($1,$2,'Sales'), ($1,$3,'Sales') on conflict do nothing`, [COMPANY, PRIYA, ARJUN]);
      await c.query(`delete from public.customers where id like 'http-%'`);
      await c.query(`insert into public.customers (id, owner_id, company_id, data)
        values ('http-priya',$1,$2,'{"company":"Litware"}')`, [PRIYA, COMPANY]);
    });
  });

  afterAll(async () => {
    await asService(async (c) => {
      await c.query(`delete from public.customers where id like 'http-%'`);
    });
    await closePool();
  });

  it("answers a signed caller with their own rows", async () => {
    const res = await handleQuery(request({
      table: "customers", op: "select", select: "id, data",
      filters: [{ col: "id", op: "eq", value: "http-priya" }],
    }, { token: tokenFor(PRIYA) }), options);

    expect(res.status).toBe(200);
    expect(res.jsonBody.data).toHaveLength(1);
    expect(res.jsonBody.data[0].data.company).toBe("Litware");
  });

  /* -- THE ONE THAT MATTERS ------------------------------------------
     Two valid tokens, two different people, one query. If the endpoint
     stamped the wrong id — or none — this passes silently and the CRM
     serves every salesperson everybody else's customers. */
  it("answers each caller as themselves, not as whoever asked first", async () => {
    const ask = (token) => handleQuery(request({
      table: "customers", op: "select", select: "id",
      filters: [{ col: "id", op: "eq", value: "http-priya" }],
    }, { token }), options);

    expect((await ask(tokenFor(PRIYA))).jsonBody.data).toHaveLength(1);
    expect((await ask(tokenFor(ARJUN))).jsonBody.data).toHaveLength(0);
    expect((await ask(tokenFor(PRIYA))).jsonBody.data).toHaveLength(1);
  });

  it("shows an unauthenticated caller nothing, rather than refusing them", async () => {
    /* The registration form and the customer portal come through here with
       no token at all. `anon` is a valid caller who can see nothing. */
    const res = await handleQuery(request({
      table: "customers", op: "select", select: "id",
    }), options);
    expect(res.status).toBe(200);
    expect(res.jsonBody.data).toEqual([]);
  });

  it("refuses a token that is present and forged", async () => {
    const [head, body] = tokenFor(PRIYA).split(".");
    const forged = `${head}.${body}.${"x".repeat(43)}`;
    const res = await handleQuery(request({ table: "customers", op: "select", select: "id" },
      { token: forged }), options);
    expect(res.status).toBe(401);
    expect(res.jsonBody.data).toBeUndefined();
  });

  it("refuses a token that has expired", async () => {
    const stale = tokenFor(PRIYA, { exp: Math.floor(Date.now() / 1000) - 7200 });
    const res = await handleQuery(request({ table: "customers", op: "select", select: "id" },
      { token: stale }), options);
    expect(res.status).toBe(401);
  });

  it("writes, and reports what came back", async () => {
    const res = await handleQuery(request({
      table: "customers", op: "insert", select: "id",
      values: { id: "http-new", owner_id: PRIYA, company_id: COMPANY, data: { company: "Adventure Works" } },
    }, { token: tokenFor(PRIYA) }), options);
    expect(res.status).toBe(200);
    expect(res.jsonBody.data).toEqual([{ id: "http-new" }]);
  });

  it("passes a database refusal through with its SQLSTATE", async () => {
    /* The CRM turns these into readable messages on screen, so the message
       and the code have to survive the trip. `where`, which carries the body
       of the function that failed, must not. */
    const res = await handleQuery(request({
      table: "customers", op: "insert", select: "id",
      values: { id: "http-new", owner_id: PRIYA, company_id: COMPANY, data: {} },
    }, { token: tokenFor(PRIYA) }), options);
    expect(res.status).toBe(400);
    expect(res.jsonBody.error.code).toBe("23505");
    expect(JSON.stringify(res.jsonBody)).not.toContain("PL/pgSQL");
  });

  it("refuses a hostile query without running anything", async () => {
    const res = await handleQuery(request({
      table: "customers", op: "select", select: "id", order: [{ col: "id; drop table customers" }],
    }, { token: tokenFor(PRIYA) }), options);
    expect(res.status).toBe(400);

    const still = await asService(async (c) =>
      (await c.query("select count(*)::int as n from public.customers")).rows[0].n);
    expect(still).toBeGreaterThan(0);
  });

  it("refuses anything that is not a JSON POST", async () => {
    const spec = { table: "customers", op: "select", select: "id" };
    expect((await handleQuery(request(spec, { method: "GET" }), options)).status).toBe(405);
    expect((await handleQuery(request(spec, { contentType: "text/plain" }), options)).status).toBe(415);
    expect((await handleQuery(request("not json"), options)).status).toBe(400);
    expect((await handleQuery(request([1, 2, 3]), options)).status).toBe(400);
  });

  it("refuses a body too large to be a real request", async () => {
    const huge = JSON.stringify({ table: "customers", op: "select", select: "id", pad: "x".repeat(1_100_000) });
    expect((await handleQuery(request(huge), options)).status).toBe(413);
  });

  it("refuses a declared oversize body before reading it", async () => {
    /* The cheap check, on `content-length`. Tested separately from the one
       above because they are different code paths and a typo in the header
       name would leave only the expensive one — which means reading the
       whole thing first, which is what the header is there to avoid. */
    let read = false;
    const claimsToBeHuge = {
      method: "POST",
      headers: {
        get: (n) => ({ "content-type": "application/json", "content-length": "99999999" })[n] ?? null,
      },
      text: async () => { read = true; return "{}"; },
    };
    expect((await handleQuery(claimsToBeHuge, options)).status).toBe(413);
    expect(read).toBe(false);
  });
});

d("the rpc endpoint", () => {
  afterAll(async () => { await closePool(); });

  it("calls a function on the list", async () => {
    const res = await handleRpc(request({ fn: "my_lead_code" }, { token: tokenFor(PRIYA) }), options);
    expect(res.status).toBe(200);
    expect(typeof res.jsonBody.data === "string" || res.jsonBody.data === null).toBe(true);
  });

  it("returns a set-returning function as an array", async () => {
    const res = await handleRpc(request({ fn: "my_sending_accounts" }, { token: tokenFor(PRIYA) }), options);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.jsonBody.data)).toBe(true);
  });

  it("returns a scalar bare, as PostgREST did", async () => {
    const res = await handleRpc(request(
      { fn: "next_doc_seq", args: { p_kind: "invoice" } }, { token: tokenFor(PRIYA) }), options);
    expect(res.status).toBe(200);
    expect(typeof res.jsonBody.data).toBe("number");
  });

  it("passes named arguments through in the right places", async () => {
    const res = await handleRpc(request({
      fn: "find_duplicate_customer",
      args: { p_company: "Litware", p_phone: "", p_gstin: "" },
    }, { token: tokenFor(PRIYA) }), options);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.jsonBody.data)).toBe(true);
  });

  /* -- THE ONES THAT MATTER ------------------------------------------
     A name taken from the request and called would be remote code
     execution with a public door on it. */
  it("refuses a function that is not on the list", async () => {
    for (const fn of ["pg_sleep", "pg_read_file", "consume_rate_limit",
      "may_manage_email_account", "version", "current_setting"]) {
      const res = await handleRpc(request({ fn, args: {} }, { token: tokenFor(PRIYA) }), options);
      expect(res.status, fn).toBe(400);
      expect(res.jsonBody.error.message).toBe("Unknown function.");
    }
  });

  it("refuses a name that is not a name", async () => {
    for (const fn of ["pg_sleep(10); drop table customers --", "public.my_lead_code",
      "my_lead_code()", "", null, 42, ["my_lead_code"]]) {
      const res = await handleRpc(request({ fn }, { token: tokenFor(PRIYA) }), options);
      expect(res.status).toBe(400);
    }
  });

  it("refuses arguments the function does not take", async () => {
    const res = await handleRpc(request(
      { fn: "next_doc_seq", args: { p_kind: "invoice", p_extra: 1 } },
      { token: tokenFor(PRIYA) }), options);
    expect(res.status).toBe(400);
    expect(res.jsonBody.error.message).toContain("Wrong arguments");
  });

  it("refuses a call that is missing an argument", async () => {
    const res = await handleRpc(request({ fn: "next_doc_seq", args: {} },
      { token: tokenFor(PRIYA) }), options);
    expect(res.status).toBe(400);
  });

  it("picks the right one of two signatures by the arguments given", async () => {
    /* 13 is OINV, the tax invoice — a real object type, because the
       function checks and a made-up one would fail for the wrong reason. */
    const three = await handleRpc(request({
      fn: "next_doc_number", args: { p_company: COMPANY, p_obj_type: 13, p_fy: "2026-27" },
    }, { token: tokenFor(PRIYA) }), options);
    const two = await handleRpc(request({
      fn: "next_doc_number", args: { p_obj_type: 13, p_fy: "2026-27" },
    }, { token: tokenFor(PRIYA) }), options);
    expect(three.status).toBe(200);
    expect(two.status).toBe(200);
    expect(typeof three.jsonBody.data).toBe("number");
    expect(typeof two.jsonBody.data).toBe("number");
  });

  it("binds a hostile argument value rather than running it", async () => {
    const res = await handleRpc(request({
      fn: "next_doc_seq", args: { p_kind: "'; drop table public.customers; --" },
    }, { token: tokenFor(PRIYA) }), options);

    /* The function refuses it — as DATA, by name, the same way it refuses
       "banana". That refusal IS the proof: it means the string arrived as a
       value the function could inspect, not as SQL it executed. */
    expect(res.status).toBe(400);
    expect(res.jsonBody.error.message).toContain("unknown document kind");

    const still = await asService(async (c) =>
      (await c.query("select count(*)::int as n from public.customers")).rows[0].n);
    expect(still).toBeGreaterThan(0);
  });

  it("refuses a forged token before it looks at the function", async () => {
    const res = await handleRpc(request({ fn: "my_lead_code" }, { token: "nonsense" }), options);
    expect(res.status).toBe(401);
  });
});

describe("the whitelist itself", () => {
  it("names only functions the CRM actually calls", () => {
    /* Kept honest by hand: anything added here is a new public entry point
       into the database, and it should take a deliberate edit to this list
       and a reader noticing it in review. */
    expect(Object.keys(CALLABLE).sort()).toEqual([
      "create_company",
      "find_duplicate_customer",
      "my_lead_code",
      "my_sending_accounts",
      "next_customer_code",
      "next_doc_number",
      "next_doc_seq",
      "regenerate_webhook_secret",
    ]);
  });

  it("does not expose the functions the server jobs use", () => {
    /* Those run as service_role, which bypasses RLS entirely. A browser
       must not be able to reach them however valid its token. */
    expect(CALLABLE.consume_rate_limit).toBeUndefined();
    expect(CALLABLE.may_manage_email_account).toBeUndefined();
  });

  it("keeps the two whitelists disjoint", async () => {
    /* A function on both lists would be reachable from a browser by
       accident the next time somebody edited either one. */
    const { SERVER_CALLABLE } = await import("./rpc.mjs");
    const overlap = Object.keys(SERVER_CALLABLE).filter((fn) => fn in CALLABLE);
    expect(overlap).toEqual([]);
  });

  it("defaults to the SMALLER whitelist when none is named", async () => {
    /* compileRpc takes which list to check against. If that defaulted to
       the server's, every forgotten argument would widen access silently.
       It defaults to the browser's, so forgetting narrows instead. */
    const { compileRpc, RpcError } = await import("./rpc.mjs");
    expect(() => compileRpc("consume_rate_limit",
      { p_key: "k", p_limit: 1, p_window_seconds: 60 })).toThrow(RpcError);
  });
});
