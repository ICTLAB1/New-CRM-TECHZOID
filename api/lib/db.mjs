import pg from "pg";

/**
 * The only way this application talks to Azure Database for PostgreSQL.
 *
 * WHAT THIS FILE IS. Supabase gave the browser PostgREST: it stamped the
 * signed-in user onto every request so 89 row-level-security policies could
 * decide what that user may see. Azure has no such thing. This is the
 * replacement, and it is deliberately the ONLY door — every query goes
 * through `asUser` or `asService`, because a query that reaches the database
 * without an identity stamped on it is a query RLS cannot judge.
 *
 * THE ONE MISTAKE THAT WOULD BE CATASTROPHIC AND SILENT. Connections are
 * pooled. If identity were set with `SET` it would persist on the connection
 * after the request ended, and the next request to borrow that connection
 * would run as the previous user. Nothing would error. Everyone would see
 * everyone's data, and the first sign of it would be a customer asking why
 * they can see another company's quotations.
 *
 * `SET LOCAL` is scoped to the transaction and reverts at COMMIT or
 * ROLLBACK, so it cannot outlive the request. Every path here opens a
 * transaction first. There is no code path that sets a claim outside one,
 * and the test suite asserts the connection comes back clean.
 */

const { Pool } = pg;

let pool = null;

/** Lazily built so importing this file does not require a database. */
export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.PGCONNECTION_STRING || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("No database connection string configured.");
  pool = new Pool({
    connectionString,
    /* Azure Flexible Server requires TLS. `rejectUnauthorized` stays true —
       the DigiCert root that signs it is in Node's bundled CA store, so no
       certificate needs disabling. If this ever fails, the fix is to supply
       the CA, never to turn verification off. */
    ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: true },
    max: Number(process.env.PGPOOL_MAX || 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    /* A statement that runs longer than this is a bug or an attack, and on a
       serverless function it is also billed time nobody gets back. */
    statement_timeout: Number(process.env.PGSTATEMENT_TIMEOUT_MS || 15_000),
  });
  pool.on("error", (err) => console.error("pg pool error:", err?.message ?? err));
  return pool;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run work as a signed-in person.
 *
 * `userId` must be a uuid. It is validated rather than escaped because it is
 * interpolated into a `SET LOCAL` — that statement takes a literal, not a
 * bind parameter, which is exactly the shape SQL injection likes. A value
 * that is not a uuid never reaches the database.
 */
export async function asUser(userId, fn) {
  if (!UUID.test(String(userId ?? ""))) {
    throw new Error("asUser needs a uuid — refusing to stamp an unrecognised identity.");
  }
  return inTransaction("authenticated", String(userId), fn);
}

/**
 * Run work with no user — the `anon` role.
 *
 * For the deliberately public paths: the registration form, the customer
 * portal's own lookups. `auth.uid()` is NULL, so every policy keyed on it
 * matches nothing. That is the correct failure: an unauthenticated caller
 * sees zero rows rather than all of them.
 */
export async function asAnon(fn) {
  return inTransaction("anon", null, fn);
}

/**
 * Run work as `service_role`, which BYPASSES RLS ENTIRELY.
 *
 * For the trusted server jobs only — the scheduled follow-up sender, the
 * portal endpoints that must read one customer's documents, webhook
 * receivers. NEVER reachable from a browser request, and never used to
 * "make a query work" that RLS refused: RLS refusing is the system doing its
 * job, and reaching for this instead is how a leak gets built on purpose.
 */
export async function asService(fn) {
  return inTransaction("service_role", null, fn);
}

async function inTransaction(role, userId, fn) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    /* Order matters: the claims are set BEFORE the role switches, because
       `authenticated` may not have permission to set them afterwards. */
    await client.query(`set local request.jwt.claim.role = '${role}'`);
    if (userId) await client.query(`set local request.jwt.claim.sub = '${userId}'`);
    await client.query(`set local role ${role}`);

    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    try { await client.query("rollback"); } catch { /* the connection is going back either way */ }
    throw err;
  } finally {
    /* Back to the pool. SET LOCAL has already reverted with the transaction;
       RESET ALL is belt and braces against a future edit that adds a
       non-local SET above. */
    try { await client.query("reset all"); } catch { /* ignore */ }
    client.release();
  }
}

/** Close the pool. For tests and for a graceful function shutdown. */
export async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}
