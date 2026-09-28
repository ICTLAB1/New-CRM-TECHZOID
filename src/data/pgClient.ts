import type {
  Db, DbQuery, DbResult, DbTable, DbWrite, OrderOptions, SelectOptions, UpsertOptions,
} from "./db";

/**
 * The browser's half of the replacement for PostgREST.
 *
 * It offers the builder the CRM already writes against — `.from(t).select(…)
 * .eq(…).order(…)` — and instead of composing a PostgREST URL it composes a
 * small JSON description and posts it to the API tier, which turns it into
 * parameterised SQL and runs it with the caller's identity stamped on the
 * connection so row-level security can judge it. See `api/lib/query.mjs`.
 *
 * WHY A BUILDER RATHER THAN NINETEEN REWRITTEN FILES. Every call site in
 * `src/data/` already speaks this shape. Rewriting them all into bespoke
 * fetches would be a few thousand lines of hand-translation, each line a
 * chance to drop a filter — and a dropped `.eq("company_id", …)` does not
 * throw, it shows one company another company's customers. Keeping the
 * builder means the call sites do not change at all, so there is nothing
 * there to get wrong.
 *
 * NOTHING HERE IS A SECURITY BOUNDARY. This composes a request; a browser
 * can compose any request it likes with or without this file. The table and
 * column whitelist is on the server, and so is row-level security. This side
 * is a convenience, and is written as if hostile.
 */

/* ── the wire format ─────────────────────────────────────────────────── */

type Op = "select" | "insert" | "upsert" | "update" | "delete";

interface Filter {
  col: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "is" | "in";
  value: unknown;
}

export interface QuerySpec {
  table: string;
  op: Op;
  select?: string | null;
  values?: Record<string, unknown> | Record<string, unknown>[];
  onConflict?: string;
  ignoreDuplicates?: boolean;
  filters?: Filter[];
  order?: { col: string; asc: boolean; nullsFirst?: boolean }[];
  limit?: number;
  range?: [number, number];
  count?: "exact";
  single?: "one" | "maybe";
}

/** How a spec reaches the server. Injected so the builder can be tested
 *  without a network, and so a future transport can change under it. */
export type Transport = (spec: QuerySpec) => Promise<DbResult<unknown>>;

export interface PgClientOptions {
  /** Where the API tier lives. Same-origin by default. */
  endpoint?: string;
  /** Returns the caller's access token, or null when signed out. Called per
   *  request rather than captured, so a refreshed token is picked up. */
  getToken?: () => Promise<string | null> | string | null;
  /** For tests, and for a runtime that does not have a global fetch. */
  fetch?: typeof fetch;
  /** Replaces the HTTP transport entirely. For tests. */
  transport?: Transport;
}

/* ── the builder ─────────────────────────────────────────────────────────
   One class serves both DbQuery and DbWrite. They differ in what they
   return, not in how they are built, and two classes would be the same
   hundred lines twice. */

class Builder<T> implements DbQuery<T>, DbWrite<T> {
  private readonly spec: QuerySpec;
  private readonly send: Transport;

  constructor(send: Transport, spec: QuerySpec) {
    this.send = send;
    this.spec = spec;
  }

  /* Each step returns a NEW builder rather than mutating this one. A shared
     base — `const q = client.from(t).select("*")` used twice with different
     filters — is a pattern that already appears in `store.ts`, and mutation
     would have the second use inherit the first one's filter. */
  private with(patch: Partial<QuerySpec>): Builder<T> {
    return new Builder<T>(this.send, { ...this.spec, ...patch });
  }

  private filter(col: string, op: Filter["op"], value: unknown): Builder<T> {
    return this.with({ filters: [...(this.spec.filters ?? []), { col, op, value }] });
  }

  eq(column: string, value: unknown) { return this.filter(column, "eq", value); }
  neq(column: string, value: unknown) { return this.filter(column, "neq", value); }
  gt(column: string, value: unknown) { return this.filter(column, "gt", value); }
  gte(column: string, value: unknown) { return this.filter(column, "gte", value); }
  lt(column: string, value: unknown) { return this.filter(column, "lt", value); }
  lte(column: string, value: unknown) { return this.filter(column, "lte", value); }
  like(column: string, pattern: string) { return this.filter(column, "like", pattern); }
  ilike(column: string, pattern: string) { return this.filter(column, "ilike", pattern); }
  is(column: string, value: null | boolean) { return this.filter(column, "is", value); }
  in(column: string, values: readonly unknown[]) { return this.filter(column, "in", [...values]); }

  select(columns = "*", options?: SelectOptions): Builder<T> {
    return this.with({
      select: columns,
      ...(options?.count ? { count: options.count } : {}),
    });
  }

  order(column: string, options?: OrderOptions): Builder<T> {
    const entry = {
      col: column,
      asc: options?.ascending !== false,
      ...(options?.nullsFirst === undefined ? {} : { nullsFirst: options.nullsFirst }),
    };
    return this.with({ order: [...(this.spec.order ?? []), entry] });
  }

  limit(count: number): Builder<T> { return this.with({ limit: count }); }

  /** PostgREST's range is inclusive at both ends. */
  range(from: number, to: number): Builder<T> { return this.with({ range: [from, to] }); }

  single(): PromiseLike<DbResult<T | null>> {
    return this.with({ single: "one" }).run() as Promise<DbResult<T | null>>;
  }

  maybeSingle(): PromiseLike<DbResult<T | null>> {
    return this.with({ single: "maybe" }).run() as Promise<DbResult<T | null>>;
  }

  /* Awaiting the builder runs it. `then` is what makes it thenable, and the
     reason `await client.from(t).select("*")` works with no terminal call. */
  then<A = DbResult<T[]>, B = never>(
    onfulfilled?: ((value: never) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled as never, onrejected);
  }

  /** The spec as it would go over the wire. For tests, and for debugging a
   *  query that came back with something unexpected in it. */
  toSpec(): QuerySpec { return { ...this.spec }; }

  private async run(): Promise<DbResult<unknown>> {
    try {
      return await this.send(this.spec);
    } catch (err) {
      /* Never throw. Every call site in `src/data/` reads `{ data, error }`
         and decides for itself — one that threw instead would take a screen
         down where today it shows a message. */
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message }, count: null };
    }
  }
}

/* ── the table ───────────────────────────────────────────────────────── */

class Table<T> implements DbTable<T> {
  constructor(private readonly send: Transport, private readonly table: string) {}

  select(columns = "*", options?: SelectOptions): DbQuery<T> {
    return new Builder<T>(this.send, {
      table: this.table, op: "select", select: columns,
      ...(options?.count ? { count: options.count } : {}),
    });
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): DbWrite<T> {
    return new Builder<T>(this.send, { table: this.table, op: "insert", values });
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: UpsertOptions,
  ): DbWrite<T> {
    return new Builder<T>(this.send, {
      table: this.table, op: "upsert", values,
      ...(options?.onConflict ? { onConflict: options.onConflict } : {}),
      ...(options?.ignoreDuplicates ? { ignoreDuplicates: true } : {}),
    });
  }

  update(values: Record<string, unknown>): DbWrite<T> {
    return new Builder<T>(this.send, { table: this.table, op: "update", values });
  }

  delete(): DbWrite<T> {
    return new Builder<T>(this.send, { table: this.table, op: "delete" });
  }
}

/* ── the client ──────────────────────────────────────────────────────── */

export function createPgClient(options: PgClientOptions = {}): Db & { toSpec?: never } {
  const endpoint = options.endpoint ?? "/api";
  const doFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);

  const post = async (path: string, body: unknown): Promise<DbResult<unknown>> => {
    if (!doFetch) throw new Error("No fetch available to reach the API.");
    const token = options.getToken ? await options.getToken() : null;
    const res = await doFetch(`${endpoint}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    /* A non-JSON body means something in front of the API answered — a
       proxy, a sign-in page, an outage page. Reporting the status is more
       use than a parse error pointing at character 0. */
    let payload: { data?: unknown; count?: number | null; error?: { message: string; code?: string } };
    try {
      payload = await res.json();
    } catch {
      return { data: null, error: { message: `The API answered ${res.status}.` }, count: null };
    }

    if (!res.ok || payload.error) {
      return {
        data: null,
        error: payload.error ?? { message: `The API answered ${res.status}.` },
        count: null,
      };
    }
    return { data: payload.data as never, error: null, count: payload.count ?? null };
  };

  const transport: Transport = options.transport ?? ((spec) => post("/q", spec));

  return {
    from<T>(table: string) { return new Table<T>(transport, table); },
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      try {
        return (await post("/rpc", { fn, args })) as DbResult<T>;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { data: null, error: { message }, count: null };
      }
    },
  };
}
