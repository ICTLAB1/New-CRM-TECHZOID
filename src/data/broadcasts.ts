import { getSupabase, isSupabaseConfigured } from "./supabase";
import type { Broadcast, BroadcastTone } from "../domain/broadcasts/broadcasts";

/**
 * Reading and sending the messages an admin puts on everybody's screen.
 *
 * Row-level security does the deciding, not this file: a person can only
 * read what is addressed to them or to everybody and has not expired, and
 * only an admin or a manager can insert — with `from_id` forced to be
 * themselves, so a message cannot go out under somebody else's name. See
 * supabase/020_broadcasts.sql.
 */

const TABLE = "broadcasts";

/** Dismissals live in the browser. A read receipt would need a row per
 *  person per message, and the question being answered is only "has this
 *  screen shown it yet" — which is a property of the screen. */
const SEEN_KEY = "crm.broadcasts.seen";

export function seenIds(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    /* A private window, or storage switched off. Showing a message again is
       a far better failure than never showing it. */
    return [];
  }
}

export function markSeen(id: string): void {
  try {
    /* Capped: an id list that grows for ever fills the quota and then every
       write fails silently, which would show every message on every load. */
    const next = [...new Set([...seenIds(), id])].slice(-200);
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch { /* see above — worst case it is shown twice */ }
}

interface Row {
  id: string;
  from_id: string;
  to_id: string | null;
  title: string;
  body: string;
  tone: string;
  expires_at: string;
  created_at: string;
}

const toBroadcast = (r: Row, names: Map<string, string>): Broadcast => ({
  id: r.id,
  fromId: r.from_id,
  fromName: names.get(r.from_id) ?? "",
  toId: r.to_id,
  toName: r.to_id ? (names.get(r.to_id) ?? "") : "",
  title: r.title ?? "",
  body: r.body ?? "",
  tone: r.tone ?? "info",
  expiresAt: Date.parse(r.expires_at),
  createdAt: Date.parse(r.created_at),
});

/** Everything this person is allowed to see and has not expired. Empty
 *  rather than throwing: a broken message board must not break the CRM. */
export async function fetchBroadcasts(names: Map<string, string> = new Map()): Promise<Broadcast[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await getSupabase()
      .from(TABLE)
      .select("id, from_id, to_id, title, body, tone, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return (data ?? []).map((r) => toBroadcast(r as Row, names));
  } catch (err) {
    console.error("broadcasts unreadable:", err);
    return [];
  }
}

export async function sendBroadcast(input: {
  fromId: string;
  toId?: string | null;
  title: string;
  body: string;
  tone: BroadcastTone | string;
  expiresInHours: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isSupabaseConfigured()) return { ok: false, message: "This preview has no server to send through." };
  try {
    const { error } = await getSupabase().from(TABLE).insert({
      from_id: input.fromId,
      to_id: input.toId || null,
      title: input.title.trim(),
      body: input.body.trim(),
      tone: input.tone,
      expires_at: new Date(Date.now() + input.expiresInHours * 3_600_000).toISOString(),
    });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.error("broadcast send failed:", err);
    return { ok: false, message: "That message couldn't be sent — only an admin or a manager can send one." };
  }
}

/** Withdraw one you sent, for the message that went out with the wrong date. */
export async function withdrawBroadcast(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const { error } = await getSupabase().from(TABLE).delete().eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/** Fires when a message arrives, so it lands in a second rather than at the
 *  next poll. Returns a function that stops listening. */
export function onBroadcast(fn: () => void): () => void {
  if (!isSupabaseConfigured()) return () => {};
  try {
    const channel = getSupabase()
      .channel("crm-broadcasts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: TABLE } as never, () => fn())
      .subscribe();
    return () => { void channel.unsubscribe(); };
  } catch {
    return () => {};
  }
}
