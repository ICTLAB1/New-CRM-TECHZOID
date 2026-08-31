import { useCallback, useEffect, useRef, useState } from "react";

/** How often the workspace refetches when nothing else has told it to.
 *  A backstop, not the mechanism — realtime is normally seconds. */
const POLL_MS = 45_000;
import { store, TABLE_OF, type Profile, type Store, type WorkspaceData } from "./store";
import { detectEvents, summarize, type CrmEvent } from "../domain/notifications/events";

/**
 * The workspace, loaded once and kept in step.
 *
 * Three things happen here and nowhere else:
 *
 *   1. **Normalisation on load.** Records written before `currency`,
 *      `taxType` or `billCountry` existed are filled in as they arrive, so no
 *      screen ever has to ask whether a field is there.
 *   2. **Writes are diffed, not replayed.** `syncEntity` sends only the rows
 *      that actually changed, so saving a customer does not rewrite the
 *      table — and RLS rejects anything this user may not touch.
 *   3. **Realtime refetches, but never over an in-flight save.** A change
 *      broadcast while we are mid-write would otherwise pull the pre-write
 *      rows back over what was just typed.
 */

export type { Profile, WorkspaceData } from "./store";

export type LoadState = "loading" | "ready" | "failed";

const EMPTY: WorkspaceData = {
  customers: [], quotations: [], proformas: [], purchaseOrders: [], invoices: [],
  orders: [], challans: [], subscriptions: [],
};

export interface Workspace {
  state: LoadState;
  error: string | null;
  data: WorkspaceData;
  settings: Record<string, unknown>;
  profiles: Profile[];
  /** Saving right now. Screens use it to disable a second submit. */
  saving: boolean;
  /** The last write that failed, kept until it succeeds or is dismissed. */
  saveError: string | null;
  reload: () => Promise<void>;
  /** What changed in the workspace since this screen last looked, derived
   *  from the refetch a realtime event triggered. Empty on a first load. */
  events: CrmEvent[];
  clearEvents: () => void;
  update: <K extends keyof WorkspaceData>(key: K, next: WorkspaceData[K]) => void;
  updateSettings: (next: Record<string, unknown>) => void;
  /** Adopt a settings change the database made on its own — see the
   *  implementation for why this must not write back. */
  noteSettings: (next: Record<string, unknown>) => void;
  setProfiles: (next: Profile[]) => void;
  dismissSaveError: () => void;
}

export function useWorkspace(enabled: boolean, meId = "", db: Store = store()): Workspace {
  const [state, setState] = useState<LoadState>(enabled ? "loading" : "ready");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WorkspaceData>(EMPTY);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [events, setEvents] = useState<CrmEvent[]>([]);
  /* In a ref so `reload` does not have to be rebuilt — and therefore the
     realtime subscription torn down and remade — every time the signed-in
     user's object identity changes. */
  const meRef = useRef(meId);
  meRef.current = meId;
  const clearEvents = useCallback(() => setEvents([]), []);

  /* The last state the server is known to hold, so a write can be diffed
     against it rather than against whatever the screen happens to show. */
  const committed = useRef<WorkspaceData>(EMPTY);
  const committedSettings = useRef<Record<string, unknown>>({});
  const inFlight = useRef(0);

  const reload = useCallback(async (announce = false) => {
    try {
      const loaded = await db.load();
      /* Diffed BEFORE the new data is committed, against what this screen
         already held. A change this user made themselves is already in
         there — their optimistic update put it there — so it diffs to
         nothing and nobody is told about their own click. */
      if (announce) {
        const found = detectEvents(committed.current, loaded.data, meRef.current);
        if (found.length) setEvents((cur) => [...summarize(found), ...cur].slice(0, 50));
      }
      committed.current = loaded.data;
      committedSettings.current = loaded.settings;
      setData(loaded.data);
      setSettings(loaded.settings);
      setProfiles(loaded.profiles);
      setState("ready");
      setError(null);
    } catch (err) {
      console.error("workspace load failed:", err);
      setState("failed");
      setError("Couldn't load your workspace. Check your connection and try again.");
    }
  }, [db]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload]);

  /**
   * Live sync, by three routes that back each other up.
   *
   * WHY THREE. The realtime subscription is the good one — a change arrives
   * as a table name within a second, and refetching everything is cheap at
   * this size and cannot get out of step the way applying individual row
   * events can. But it depends on the Realtime service being switched on
   * for the project and on every table being in the publication, which is
   * server-side configuration this code cannot see, cannot fix, and cannot
   * even tell has gone wrong: a socket that never delivers looks exactly
   * like a workspace where nothing is happening.
   *
   * So it is not relied on alone. Coming back to the tab refetches, because
   * that is the moment somebody is about to read the screen; and a slow
   * poll runs underneath, so a screen left open on a wall display stays
   * true even if the socket never connects at all.
   *
   * Every route goes through the same guard: never pull the server's rows
   * over a save that is still in flight.
   */
  useEffect(() => {
    if (!enabled || state !== "ready") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (inFlight.current > 0) return;
        /* Nothing to refresh into while the tab is hidden, and a background
           tab polling all day is somebody's battery. */
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        void reload(true);
      }, delay);
    };

    const channel = db.subscribeAll(() => refresh(700));

    /* Back at the tab: refetch at once rather than waiting for the poll. */
    const onVisible = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") refresh(150);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onVisible);
      document.addEventListener("visibilitychange", onVisible);
    }

    /* The floor. Slow enough to be invisible on the bill, quick enough that
       nobody is looking at yesterday's pipeline. */
    const poll = setInterval(() => refresh(0), POLL_MS);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onVisible);
        document.removeEventListener("visibilitychange", onVisible);
      }
      void channel.unsubscribe();
    };
  }, [enabled, state, reload, db]);

  const update = useCallback(<K extends keyof WorkspaceData>(key: K, next: WorkspaceData[K]) => {
    /* Optimistic: the screen updates now, the write follows. If it fails the
       error says so and `reload` puts the truth back — silently keeping a
       change the database rejected is the worst of both. */
    setData((cur) => ({ ...cur, [key]: next }));
    if (!enabled) return;

    inFlight.current += 1;
    setSaving(true);
    const previous = committed.current[key];
    void db.syncEntity(TABLE_OF[key], previous as never, next as never)
      .then(() => {
        committed.current = { ...committed.current, [key]: next };
        setSaveError(null);
      })
      .catch((err: unknown) => {
        console.error("save failed:", err);
        setSaveError("That change couldn't be saved. Your workspace has been reloaded — please try again.");
        void reload();
      })
      .finally(() => {
        inFlight.current -= 1;
        if (inFlight.current === 0) setSaving(false);
      });
  }, [enabled, reload, db]);

  const updateSettings = useCallback((next: Record<string, unknown>) => {
    setSettings(next);
    if (!enabled) return;

    inFlight.current += 1;
    setSaving(true);
    void db.syncSettings(committedSettings.current, next)
      .then(() => {
        committedSettings.current = next;
        setSaveError(null);
      })
      .catch((err: unknown) => {
        console.error("settings save failed:", err);
        setSaveError("Those settings couldn't be saved — only an admin or manager may change them.");
        void reload();
      })
      .finally(() => {
        inFlight.current -= 1;
        if (inFlight.current === 0) setSaving(false);
      });
  }, [enabled, reload, db]);

  /**
   * Take on a settings change the DATABASE has already made.
   *
   * Allocating a document number advances a counter inside `settings` in a
   * single statement in Postgres (next_doc_seq). The row is already written
   * by the time we hear about it, so writing it back would be a second,
   * pointless update — and one that row-level security would reject for a
   * salesperson, who may allocate numbers but not edit settings. Moving the
   * committed baseline along with the state is what says "this is not a
   * pending edit; the database and this browser now agree".
   */
  const noteSettings = useCallback((next: Record<string, unknown>) => {
    committedSettings.current = next;
    setSettings(next);
  }, []);

  return {
    state, error, data, settings, profiles, saving, saveError,
    reload: () => reload(),
    events, clearEvents,
    update, updateSettings, noteSettings, setProfiles,
    dismissSaveError: () => setSaveError(null),
  };
}
