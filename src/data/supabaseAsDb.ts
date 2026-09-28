import type { Db, DbRealtime } from "./db";
import { getSupabase } from "./supabase";

/**
 * The one place the live Supabase client is viewed through the narrow `Db`
 * and `DbRealtime` interfaces — and the proof that it may be.
 *
 * WHY A CAST AT ALL. Supabase's client does satisfy both interfaces, and
 * `supabaseAsDb.test.ts` checks, on every run, that the client really has
 * every method these interfaces promise. What the compiler will not do is answer the same question about the
 * RESULT OF A CALL: written as `const client: Db = getSupabase()` it walks
 * into `createClient`'s generic parameters and stops with "type
 * instantiation is excessively deep". Given a value already typed as
 * `SupabaseClient` it answers immediately. Same question, same answer,
 * different amount of inference on the way in.
 *
 * So the cast is not "trust me". It is "asked and answered below, in the
 * form the checker can finish". If Supabase ever changes so that it no
 * longer satisfies these interfaces, the proof stops compiling and the build
 * fails, which is the entire reason it is written down.
 */

/* ── the accessors ───────────────────────────────────────────────────── */

/** The live Supabase client, as a query interface. */
export function supabaseDb(): Db {
  return getSupabase() as unknown as Db;
}

/**
 * The live Supabase client, as a change feed.
 *
 * The first thing to go when this leaves Supabase: Azure has no equivalent
 * of Postgres change subscriptions, so this becomes Web PubSub or nothing.
 * `store.ts` takes it as a separate argument for that reason, and works
 * without it — see the note on `subscribeAll`. `backend.ts` decides which
 * of these, if any, the application actually uses.
 */
export function supabaseRealtime(): DbRealtime {
  return getSupabase() as unknown as DbRealtime;
}
