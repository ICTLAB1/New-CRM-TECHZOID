import type { Db, DbRealtime } from "./db";
import { createApiClient } from "./apiClient";
import { supabaseDb, supabaseRealtime } from "./supabaseAsDb";
import type { FileStore } from "./storage";
import { createBlobStore } from "./blobStore";
import { createSupabaseStore } from "./supabaseStore";
import { supabaseToken } from "./apiClient";
import type { TokenSource } from "./apiClient";
import { entraSettings, entraToken } from "./entraAuth";
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
 *   · SIGN-IN, unless `VITE_AUTH=entra` says otherwise. Its own switch
 *     again, because moving identity is the step that makes every user link
 *     their account once and it should not ride along with anything else.
 *
 *   · ATTACHMENTS, unless `VITE_BLOB_STORAGE` says otherwise. Its own
 *     switch, separate from the data one, so the two can move on different
 *     days and either can be rolled back without the other. A quotation
 *     with a missing PDF is not a failure worth folding into a larger one.
 *
 * So after the switch this is a CRM whose data is on Azure and whose
 * sign-in is not. That is a legitimate place to stand — it is smaller than
 * the alternative, each remaining piece can move on its own afterwards, and
 * every one of them can be reverted without touching the others.
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
let storeCache: FileStore | null = null;

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
  cached = base ? createApiClient(base, getToken()) : supabaseDb();
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

/**
 * Where attached files live.
 *
 * ITS OWN SWITCH, not the data one. `VITE_BLOB_STORAGE=on` moves
 * attachments to Azure; `VITE_API_BASE` moves the queries. Two variables
 * rather than one because they are two migrations with two failure modes —
 * a bad data cutover shows up immediately on every screen, while a bad
 * attachment cutover shows up the first time somebody opens a contract,
 * which might be Thursday. Being able to roll one back without the other is
 * worth the second setting.
 *
 * Blob storage needs the API tier to sign its URLs, so asking for it
 * without `VITE_API_BASE` is a misconfiguration rather than a choice, and
 * this falls back rather than failing at the moment somebody opens a file.
 */
export function getFileStore(): FileStore {
  if (storeCache) return storeCache;
  const base = apiBase();
  const wantsBlob = String(import.meta.env.VITE_BLOB_STORAGE ?? "").trim().toLowerCase() === "on";
  storeCache = wantsBlob && base
    ? createBlobStore(base, getToken())
    : createSupabaseStore();
  return storeCache;
}

/** True when attachments are on Azure Blob Storage. */
export function attachmentsOnAzure(): boolean {
  return String(import.meta.env.VITE_BLOB_STORAGE ?? "").trim().toLowerCase() === "on" && !!apiBase();
}

/**
 * Where the caller's token comes from.
 *
 * ITS OWN SWITCH. `VITE_AUTH=entra` signs in with Microsoft; anything else
 * keeps Supabase Auth. Moving identity is the one step that makes every
 * user link their account, so it gets to happen on a day of its own.
 *
 * Both sides have to work at once during that changeover — somebody who has
 * not linked yet still needs to get in — which is why the API verifies
 * HS256 and RS256 and why `042_entra_identity.sql` leaves every existing
 * user id exactly as it was.
 *
 * Asking for Entra without configuring it falls back rather than locking
 * everybody out, which is the failure mode worth avoiding here: a sign-in
 * screen that cannot sign anybody in is not something the person who
 * mistyped the setting can fix from inside the app.
 */
export function signInWithEntra(): boolean {
  const wants = String(import.meta.env.VITE_AUTH ?? "").trim().toLowerCase() === "entra";
  return wants && entraSettings() !== null;
}

/** The token every request carries. */
export function getToken(): TokenSource {
  return signInWithEntra() ? entraToken : supabaseToken;
}

/** Drop the cached clients. For tests, and after a configuration change. */
export function forgetBackend(): void {
  cached = null;
  storeCache = null;
}
