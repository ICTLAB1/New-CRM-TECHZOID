import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { createPgClient } from "./pgClient";
import { createStore } from "./store";
import type { Db } from "./db";
// @ts-expect-error -- plain JavaScript: the API tier is not TypeScript.
import { asService, closePool } from "../../api/lib/db.mjs";
// @ts-expect-error -- as above.
import { forgetCatalog } from "../../api/lib/query.mjs";
// @ts-expect-error -- as above.
import { handleQuery, handleRpc } from "../../api/lib/http.mjs";

/**
 * The last link: a real socket.
 *
 * Everything else in this migration is proved without HTTP — the handlers
 * are called directly, the end-to-end test calls the translator directly.
 * That leaves exactly one thing unproven, and it is not a small one: that
 * what `pgClient` puts on the wire is what the endpoint expects to read off
 * it. A field renamed on one side and not the other type-checks on both, and
 * fails only when a request is actually sent.
 *
 * So this starts a real server on a real port, points the real browser
 * client at it through the real `fetch`, and drives the real store through
 * the lot. The only thing standing in for Azure is the Functions host, whose
 * job — take an HTTP request, hand it to a handler, send the answer back —
 * is what the adapter here does in twenty lines.
 */
const HAVE_DB = !!(process.env.PGCONNECTION_STRING || process.env.DATABASE_URL);
const d = HAVE_DB ? describe : describe.skip;

const SECRET = "a-test-signing-secret-that-is-not-real";
const DEV = "12121212-1212-1212-1212-121212121212";
const OTHER = "34343434-3434-3434-3434-343434343434";

const verifier = {
  config: { alg: "HS256", secret: SECRET, issuer: null, audience: null, clockSkewSeconds: 60 },
  log: () => {},
};

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

function tokenFor(userId: string) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/**
 * The twenty lines the Functions host contributes.
 *
 * Azure's HttpRequest is already Fetch-shaped, which is why the handlers
 * were written against that shape — so this adapter exists only because
 * Node's own http module is older than the Fetch API.
 */
function serve(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const request = {
        method: req.method,
        headers: { get: (name: string) => req.headers[String(name).toLowerCase()] ?? null },
        text: async () => body,
      };
      const handler = req.url?.endsWith("/rpc") ? handleRpc : handleQuery;
      const answer = await handler(request, verifier);
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.jsonBody));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${port}/api` });
    });
  });
}

let server: Server;
let origin: string;
let COMPANY: string;

/** A real client, over real HTTP, with a real token. */
const clientFor = (userId: string | null): Db =>
  createPgClient({ endpoint: origin, getToken: () => (userId ? tokenFor(userId) : null) });

d("the CRM over HTTP", () => {
  beforeAll(async () => {
    forgetCatalog();
    ({ server, origin } = await serve());
    await asService(async (c: {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }>;
    }) => {
      await c.query(`
        insert into auth.users (id, email, raw_user_meta_data) values
          ($1,'dev@techzoid.in','{"name":"Dev"}'),
          ($2,'other@techzoid.in','{"name":"Other"}')
        on conflict (id) do nothing`, [DEV, OTHER]);
      COMPANY = String((await c.query(
        `select id from public.companies order by created_at limit 1`)).rows[0]?.id);
      await c.query(`insert into public.company_members (company_id, user_id, role)
        values ($1,$2,'Sales'), ($1,$3,'Sales') on conflict do nothing`, [COMPANY, DEV, OTHER]);
      await c.query(`delete from public.customers where id like 'wire-%'`);
    });
  });

  afterAll(async () => {
    await asService(async (c: { query: (sql: string) => Promise<unknown> }) => {
      await c.query(`delete from public.customers where id like 'wire-%'`);
    });
    await closePool();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("writes and reads a customer over the wire", async () => {
    const store = createStore(clientFor(DEV), () => COMPANY);
    await store.syncEntity("customers", [], [
      { id: "wire-1", ownerId: DEV, company: "Proseware", stage: "lead" },
    ] as never);

    const found = await store.fetchEntity<{ id: string; ownerId: string; company: string }>("customers");
    expect(found.find((c) => c.id === "wire-1")?.company).toBe("Proseware");
  });

  /* -- THE ONE THAT MATTERS ------------------------------------------
     The full stack, over a socket, with two different valid tokens. */
  it("still hides one salesperson's customers from another", async () => {
    const mine = createStore(clientFor(DEV), () => COMPANY);
    const theirs = createStore(clientFor(OTHER), () => COMPANY);

    await mine.syncEntity("customers", [], [
      { id: "wire-secret", ownerId: DEV, company: "Woodgrove", stage: "lead" },
    ] as never);

    const seen = async (s: ReturnType<typeof createStore>) =>
      (await s.fetchEntity<{ id: string; ownerId: string }>("customers")).map((c) => c.id);

    expect(await seen(mine)).toContain("wire-secret");
    expect(await seen(theirs)).not.toContain("wire-secret");
  });

  it("sends no token for a signed-out caller, and gets nothing back", async () => {
    const { data, error } = await clientFor(null).from("customers").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("reports a refused query as an error, not as a crash", async () => {
    const { data, error } = await clientFor(DEV).from("customers").select("no_such_column");
    expect(data).toBeNull();
    expect(error?.message).toContain("Unknown column");
  });

  it("reports a rejected token as an error the screen can show", async () => {
    const bad = createPgClient({ endpoint: origin, getToken: () => "not-a-token" });
    const { data, error } = await bad.from("customers").select("id");
    expect(data).toBeNull();
    expect(error?.message).toBeTruthy();
  });

  it("calls a stored function over the wire", async () => {
    const { data, error } = await clientFor(DEV).rpc("next_doc_seq", { p_kind: "quote" });
    expect(error).toBeNull();
    expect(typeof data).toBe("number");
  });

  it("carries an exact count alongside a page of rows", async () => {
    const store = createStore(clientFor(DEV), () => COMPANY);
    await store.syncEntity("customers", [], [
      { id: "wire-a", ownerId: DEV, company: "A", stage: "lead" },
      { id: "wire-b", ownerId: DEV, company: "B", stage: "lead" },
    ] as never);

    const { data, count } = await clientFor(DEV).from("customers")
      .select("id", { count: "exact" })
      .in("id", ["wire-a", "wire-b"])
      .limit(1);
    expect(data).toHaveLength(1);
    expect(count).toBe(2);
  });

  it("survives a query with no rows to find", async () => {
    const { data, error } = await clientFor(DEV).from("customers")
      .select("id").eq("id", "wire-nothing-here");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
