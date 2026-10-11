/**
 * Working without a connection.
 *
 * Two things live on the device:
 *
 *   THE LAST WORKSPACE LOADED, so the app opens on a train, in a basement
 *   car park or at a customer site with no signal, showing what was there
 *   the last time it could ask.
 *
 *   WHAT CHANGED SINCE, as "these collections differ from what the server
 *   last confirmed". Saving is already a diff between the last confirmed
 *   copy and the current one (store.syncEntity), so the queue does not need
 *   to record each edit: when the connection returns, the same diff is
 *   taken and only the records actually touched are uploaded. Somebody
 *   else's changes to OTHER records are untouched; the same record edited
 *   in two places ends with the later upload, as it would online.
 *
 * IndexedDB rather than localStorage: a workspace runs to megabytes, and
 * localStorage is small, synchronous and blocks the page while it writes.
 */

const DB_NAME = "techzoid-crm";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no indexedDB")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* Private browsing or storage full: offline is a bonus, never a reason
       for the online app to fail. */
  }
}

/** Is the device offline right now, as far as the browser knows? */
export const isOffline = (): boolean =>
  typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Did this fail because the network is gone, rather than because the
 * server said no? Only the first may be queued and retried; a refusal
 * (no permission, a rule broken) must still be shown to the person.
 */
export function isNetworkError(err: unknown): boolean {
  if (isOffline()) return true;
  const msg = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  return err instanceof TypeError
    || /failed to fetch|networkerror|network request failed|load failed|couldn't reach|timed? ?out|offline/.test(msg);
}

/** True when running as an installed app (home-screen icon), not a tab. */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
}

/* ── small things kept in localStorage: who was signed in, which company ── */

export function remember(key: string, value: unknown): void {
  try { localStorage.setItem("tz." + key, JSON.stringify(value)); } catch { /* ignore */ }
}

export function recall<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem("tz." + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/* ── what the banner shows: changes waiting, when last synced ─────────── */

export interface SyncStatus { pending: number; syncedAt: number | null; uploading: boolean }
let status: SyncStatus = { pending: 0, syncedAt: null, uploading: false };
const listeners = new Set<() => void>();
export function publishSync(next: Partial<SyncStatus>): void {
  const merged = { ...status, ...next };
  if (merged.pending === status.pending && merged.syncedAt === status.syncedAt && merged.uploading === status.uploading) return;
  status = merged;
  listeners.forEach((l) => l());
}
export const subscribeSync = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getSync = (): SyncStatus => status;
