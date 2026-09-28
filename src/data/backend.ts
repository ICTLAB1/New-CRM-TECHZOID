import type { Db, DbRealtime } from "./db";
import { createApiClient } from "./apiClient";
import { supabaseDb, supabaseRealtime } from "./supabaseAsDb";
import { isSupabaseConfigured } from "./supabase";

/**
 * Which database the CRM is talking to.
 *
 * ONE SWITCH, and it is an environment variable rather than a code change:
 * set `VITE_API_BASE` and every query in this application goes to the Azure
 * API tier instead of to Supabase. Leave it unset and nothing changes.
 *
 * That shape is deliberate. A cutover that needs a code change needs a
 * build, a deploy and a rollback plan; a cutover that needs a setting can be
 * undone from the hosting console in under a minute by somebody who is not
 * the person who wrote it. The day this is used will not be a calm day.
 *
 * WHAT MOVES AND WHAT DOES NOT.
 *
 * Moves: every query and every stored-function call — which is to say all
 * the customer data, every document, the whole pipeline. They go to
 * `/api/q` and `/api/rpc`, run against Azure Database for PostgreSQL, and
 * are judged by the same 89 row-level-security policies as before.
 *
 * Stays on Supabase, for now, and on purpose:
 *
 *   · SIGN-IN. Supabase Auth issues the token; the Azure API verifies it
 *     with the project's JWT secret (HS256). This is why `identity.mjs`
 *     implements HS256 as well as RS256 — so the data can move on one day
 *     and identity on another, rather than both on the same day. Moving
 *     identity is the step that makes every user re-link their account, and
 *     it does not have to happen at the same time as anything else.
 *
 *   · ATTACHMENTS. Still Supabase Storage. The browser talks to it
 *     directly, as it always has. Blob Storage is written but the swap is
 *     its own change with its own risk, and a quotation with a missing PDF
 *     is not a failure anybody wants folded into a larger one.
 *
 * So after the switch this is a CRM whose data is on Azure and whose
 * sign-in and file storage are not. That is a legitimate place to stand —
 * it is smaller than the alternative, each remaining piece can move on its
 * own afterwards, and every one of them can be reverted without touching
 * the others.
 */

/**
 * Is there a server behind this at all?
 *
 * The guard every data call already used was `isSupabaseConfigured()`, which
 * answers a narrower question and would say no on a deployment that has
 * finished leaving Supabase. This asks what the callers actually meant.
 */
export function hasBackend(): boolean {
  return isOnAzure() || isSupabaseConfigured();
}

/** True when the CRM is pointed at the Azure API tier. */
export function isOnAzure(): boolean {
  return !!apiBase();
}

/** Where the API tier lives, or null when there is none configured. */
export function apiBase(): string | null {
  const configured = import.meta.env.VITE_API_BASE;
  return typeof configured === "string" && configured.trim() ? configured.trim() : null;
}

let cached: Db | null = null;

/**
 * The client every query goes through.
 *
 * Built once and kept, because the API client holds nothing per-request —
 * it asks for the access token on each call rather than capturing one, so a
 * refreshed token is picked up without rebuilding anything.
 */
export function getDb(): Db {
  if (cached) return cached;
  const base = apiBase();
  cached = base ? createApiClient(base) : supabaseDb();
  return cached;
}

/**
 * The change feed, or null when there is not one.
 *
 * Azure has no equivalent of Postgres change subscriptions, so pointing at
 * the API tier means giving this up until Web PubSub is wired in. That is a
 * slower refresh rather than a stale screen: `useWorkspace` polls on a timer
 * and refetches whenever the tab regains focus, and both were always there
 * underneath the live feed.
 */
export function getRealtime(): DbRealtime | undefined {
  return isOnAzure() ? undefined : supabaseRealtime();
}

/** Drop the cached client. For tests, and after a configuration change. */
export function forgetBackend(): void {
  cached = null;
}
