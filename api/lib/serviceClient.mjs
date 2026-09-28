import { asAnon, asService, asUser } from "./db.mjs";
import { runQuery } from "./query.mjs";
import { compileRpc, runRpc } from "./rpc.mjs";

/**
 * The server's own database client.
 *
 * WHY THIS EXISTS AND WHY IT LOOKS LIKE SUPABASE. Twenty-six scheduled jobs
 * and webhook handlers call `adminClient().from(…).select(…).eq(…)`, and
 * between them they hold most of what the CRM does that is not a screen:
 * the follow-up sender, the campaign pacer, the IndiaMART poller, the portal,
 * the WhatsApp and email senders. Rewriting all of them into hand-written SQL
 * would be the largest and least interesting piece of this migration and
 * every line of it a chance to drop a filter. So they keep the builder they
 * already speak, and this supplies it.
 *
 * HOW IT DIFFERS FROM THE BROWSER'S ONE. `src/data/pgClient.ts` composes the
 * same query description and posts it over HTTP. This one runs in the same
 * process as the database gate, so it hands the description straight to the
 * translator — no HTTP, no token, no round trip. Same contract, two
 * transports, and `serviceClient.test.mjs` pins the two together so they
 * cannot drift.
 *
 * `asService` BYPASSES ROW-LEVEL SECURITY ENTIRELY. That is the point of it
 * — a scheduled sender has no signed-in user to be — and it is also why
 * `forUser` exists next to it. A handler acting on behalf of somebody who
 * has just presented a token should use `forUser`, so the policies still
 * decide what that person may touch. Reaching for `service()` because a
 * query came back empty is how a leak gets built on purpose.
 */

/* -- the builder -------------------------------------------------------
   The same query description `src/data/pgClient.ts` composes. Kept as a
   separate implementation rather than shared, because the two genuinely
   differ at the transport — and kept honest by a test that runs the same
   chain through both and compares what comes out. */

class Builder {
  constructor(send, spec) {
    this.send = send;
    this.spec = spec;
  }

  /* A new builder per step, never a mutation. `netlify/lib/company.mjs`
     branches a shared base query, and a mutating builder would have the
     second branch inherit the first one's filter. */
  with(patch) {
    return new Builder(this.send, { ...this.spec, ...patch });
  }

  filter(col, op, value, negate = false) {
    const entry = negate ? { col, op, value, negate: true } : { col, op, value };
    return this.with({ filters: [...(this.spec.filters ?? []), entry] });
  }

  eq(c, v) { return this.filter(c, "eq", v); }
  neq(c, v) { return this.filter(c, "neq", v); }
  gt(c, v) { return this.filter(c, "gt", v); }
  gte(c, v) { return this.filter(c, "gte", v); }
  lt(c, v) { return this.filter(c, "lt", v); }
  lte(c, v) { return this.filter(c, "lte", v); }
  like(c, v) { return this.filter(c, "like", v); }
  ilike(c, v) { return this.filter(c, "ilike", v); }
  is(c, v) { return this.filter(c, "is", v); }
  in(c, v) { return this.filter(c, "in", [...v]); }

  /** PostgREST's `.not(column, operator, value)`. */
  not(c, op, v) { return this.filter(c, op, v, true); }

  select(columns = "*", options) {
    return this.with({
      select: columns,
      ...(options?.count ? { count: options.count } : {}),
    });
  }

  order(column, options) {
    const entry = {
      col: column,
      asc: options?.ascending !== false,
      ...(options?.nullsFirst === undefined ? {} : { nullsFirst: options.nullsFirst }),
    };
    return this.with({ order: [...(this.spec.order ?? []), entry] });
  }

  limit(count) { return this.with({ limit: count }); }
  range(from, to) { return this.with({ range: [from, to] }); }

  single() { return this.with({ single: "one" }).run(); }
  maybeSingle() { return this.with({ single: "maybe" }).run(); }

  /* Awaiting the builder runs it, which is what lets a caller write
     `await admin.from(t).select("*")` with no terminal method. */
  then(onfulfilled, onrejected) {
    return this.run().then(onfulfilled, onrejected);
  }

  /** The description as it would be sent. For tests and for debugging. */
  toSpec() { return { ...this.spec }; }

  async run() {
    try {
      const { data, count } = await this.send(this.spec);
      /* `error: null` explicitly. The translator returns only what it
         found, and every one of the twenty-six callers destructures
         `{ data, error }` — leaving the key off makes `error` undefined,
         which is falsy and so works, right up until somebody writes
         `error === null`. Matching what PostgREST returned costs a word. */
      return { data, error: null, count: count ?? null };
    } catch (err) {
      /* Never throw. Every one of the twenty-six callers reads
         `{ data, error }` and decides for itself — one that threw instead
         would take down a scheduled run that today logs and carries on. */
      return { data: null, error: { message: err?.message ?? String(err), code: err?.code } };
    }
  }
}

class Table {
  constructor(send, table) {
    this.send = send;
    this.table = table;
  }

  select(columns = "*", options) {
    return new Builder(this.send, {
      table: this.table, op: "select", select: columns,
      ...(options?.count ? { count: options.count } : {}),
    });
  }

  insert(values) {
    return new Builder(this.send, { table: this.table, op: "insert", values });
  }

  upsert(values, options) {
    return new Builder(this.send, {
      table: this.table, op: "upsert", values,
      ...(options?.onConflict ? { onConflict: options.onConflict } : {}),
      ...(options?.ignoreDuplicates ? { ignoreDuplicates: true } : {}),
    });
  }

  update(values) {
    return new Builder(this.send, { table: this.table, op: "update", values });
  }

  delete() {
    return new Builder(this.send, { table: this.table, op: "delete" });
  }
}

/**
 * Build a client that runs everything inside `runAs`.
 *
 * @param runAs A function taking the work and running it with an identity
 *   stamped on the connection — `asService`, `asAnon`, or `asUser` bound to
 *   somebody. There is no default: whose authority a query runs under is
 *   always a deliberate choice.
 */
export function createClient(runAs) {
  const send = (spec) => runAs((client) => runQuery(client, spec));

  return {
    from(table) { return new Table(send, table); },

    async rpc(fn, args = {}) {
      try {
        /* Compiled first, outside the transaction: the whitelist check is
           pure, so a bad name costs no connection. */
        const call = compileRpc(fn, args);
        const data = await runAs((client) => runRpc(client, call));
        return { data, error: null };
      } catch (err) {
        return { data: null, error: { message: err?.message ?? String(err), code: err?.code } };
      }
    },
  };
}

/**
 * A client that BYPASSES ROW-LEVEL SECURITY.
 *
 * For the trusted server jobs: the scheduled follow-up sender, the campaign
 * pacer, the portal's own lookups, webhook receivers. Never for work done on
 * behalf of a caller who presented a token — that is `forUser`.
 */
export const service = () => createClient(asService);

/** A client acting as one signed-in person, with the policies in force. */
export const forUser = (userId) => createClient((fn) => asUser(userId, fn));

/** A client with no identity at all. Sees only what the public may see. */
export const anonymous = () => createClient(asAnon);
