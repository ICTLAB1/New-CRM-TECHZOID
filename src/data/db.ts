/**
 * The database surface this CRM actually uses.
 *
 * WHY THIS FILE EXISTS. Nineteen files in `src/data/` were typed against
 * `SupabaseClient`, which is an enormous interface — and being typed against
 * it meant nobody could tell how much of Supabase the CRM depended on
 * without reading all of them. Leaving Supabase starts by answering that,
 * and the answer turns out to be small: five operations, twelve builder
 * methods, seven stored functions.
 *
 * Written as an interface rather than a class so BOTH clients satisfy it —
 * the Supabase one that is live today, and the one that talks to the API
 * tier in front of Azure Database for PostgreSQL. The compiler then refuses
 * any call site that reaches for something the replacement does not have,
 * which is the whole point: a migration where the gaps are found by `tsc`
 * rather than by a salesperson at half past four.
 *
 * Deliberately NOT included: `auth`, `storage` and `channel`. They are not
 * query problems, they are three separate service decisions — sign-in,
 * file storage, live updates — and pretending they fit here would hide
 * them. They keep their own migration.
 */

export interface DbError {
  message: string;
  code?: string;
}

/**
 * What comes back from every call, exactly as PostgREST shaped it.
 *
 * A UNION, NOT A RECORD WITH A NULLABLE ERROR. On failure `data` really is
 * null, and saying so is what makes the compiler refuse
 * `const { data } = await …; data.map(…)` without a check first. Modelling
 * it as `{ data: T; error: E | null }` compiles and then throws on the first
 * network blip — which is exactly when nobody is watching the console.
 */
export type DbResult<T> =
  | { data: T; error: null; count?: number | null }
  | { data: null; error: DbError; count?: number | null };

export interface OrderOptions {
  ascending?: boolean;
  nullsFirst?: boolean;
}

export interface SelectOptions {
  count?: "exact";
}

export interface UpsertOptions {
  onConflict?: string;
  ignoreDuplicates?: boolean;
}

/**
 * A query being built.
 *
 * Awaiting it runs it — the same trick PostgREST's own client plays, and the
 * reason existing call sites can `await client.from(t).select("*")` with no
 * terminal method.
 */
export interface DbQuery<T = unknown> extends PromiseLike<DbResult<T[]>> {
  eq(column: string, value: unknown): DbQuery<T>;
  neq(column: string, value: unknown): DbQuery<T>;
  gt(column: string, value: unknown): DbQuery<T>;
  gte(column: string, value: unknown): DbQuery<T>;
  lt(column: string, value: unknown): DbQuery<T>;
  lte(column: string, value: unknown): DbQuery<T>;
  like(column: string, pattern: string): DbQuery<T>;
  ilike(column: string, pattern: string): DbQuery<T>;
  is(column: string, value: null | boolean): DbQuery<T>;
  in(column: string, values: readonly unknown[]): DbQuery<T>;
  order(column: string, options?: OrderOptions): DbQuery<T>;
  limit(count: number): DbQuery<T>;
  range(from: number, to: number): DbQuery<T>;
  /** Exactly one row, or an error. Never the first of several. */
  single(): PromiseLike<DbResult<T | null>>;
  /** One row or none. A missing row is not an error. */
  maybeSingle(): PromiseLike<DbResult<T | null>>;
}

/** A write, which only returns rows if `select()` asks it to. */
export interface DbWrite<T = unknown> extends PromiseLike<DbResult<null>> {
  select(columns?: string): DbQuery<T>;
  eq(column: string, value: unknown): DbWrite<T>;
  neq(column: string, value: unknown): DbWrite<T>;
  gt(column: string, value: unknown): DbWrite<T>;
  gte(column: string, value: unknown): DbWrite<T>;
  lt(column: string, value: unknown): DbWrite<T>;
  lte(column: string, value: unknown): DbWrite<T>;
  is(column: string, value: null | boolean): DbWrite<T>;
  in(column: string, values: readonly unknown[]): DbWrite<T>;
}

export interface DbTable<T = unknown> {
  select(columns?: string, options?: SelectOptions): DbQuery<T>;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): DbWrite<T>;
  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: UpsertOptions,
  ): DbWrite<T>;
  update(values: Record<string, unknown>): DbWrite<T>;
  delete(): DbWrite<T>;
}

export interface Db {
  /**
   * NOT generic in the row type, on purpose.
   *
   * A `from<T>(table: string)` here forces the compiler to match Supabase's
   * own `from`, whose signature is parameterised over every table in a
   * generated schema type, against a fresh type variable — and it gives up
   * with "type instantiation is excessively deep". Every call site in this
   * codebase already asserts the row shape on the way out
   * (`data as EntityRow[] | null`), because PostgREST could never know it
   * either, so the generic bought nothing and cost the build.
   */
  from(table: string): DbTable<unknown>;
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult<T>>;
}

/* ── live updates ────────────────────────────────────────────────────────
   Kept apart from `Db` because it is not a query problem. Supabase's
   realtime does not exist on Azure; the replacement is either Web PubSub or
   nothing at all, and `useWorkspace` already polls on a timer underneath it,
   so "nothing at all" degrades to a slower refresh rather than a stale
   screen. Optional here so a client without it still satisfies the store. */

export interface DbChannel {
  /* `on` returns `unknown`, not `DbChannel`. Returning the channel would be
     truer to how Supabase's chains, and it is also what made checking a
     RealtimeChannel against this type recursive — the compiler walked that
     loop through every one of `on`'s overloads and gave up. The two call
     sites in this codebase do not chain, so nothing is lost. */
  on(event: string, filter: never, callback: () => void): unknown;
  subscribe(): unknown;
  unsubscribe(): unknown;
}

export interface DbRealtime {
  channel(name: string): DbChannel;
}

/**
 * Live updates are a SECOND ARGUMENT to the store, not an optional method on
 * the client.
 *
 * Partly because that is what they are — queries and a change feed are two
 * services, and on Azure they will not even be the same product. Partly
 * because combining them into one type, whether as `Db & Partial<DbRealtime>`
 * or as an interface with an optional `channel`, sent the compiler into
 * Supabase's channel overloads until it gave up with "type instantiation is
 * excessively deep". Two parameters, each checked on its own, both answer.
 */
