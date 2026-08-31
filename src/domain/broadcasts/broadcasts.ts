/**
 * A message an admin puts on everybody's screen.
 *
 * WHAT IT IS FOR: "the GST portal is down, stop raising invoices", "prices
 * change from Monday", "Rashmi is covering Delhi this week". Things that
 * cannot wait for a meeting and must not be missed, which is why they
 * interrupt rather than sit in a list.
 *
 * BECAUSE IT INTERRUPTS, IT IS RATIONED. Only an admin or a manager can
 * send one; it is shown once per person and then never again; and it stops
 * appearing after its expiry whether or not anybody read it. A popup that
 * comes back is a popup people learn to dismiss without reading, and then
 * the one that mattered is dismissed too.
 */

export type BroadcastTone = "info" | "warn" | "bad";

export interface Broadcast {
  id: string;
  fromId: string;
  fromName?: string;
  /** Null or empty means everybody. */
  toId?: string | null;
  toName?: string;
  title: string;
  body: string;
  tone: BroadcastTone | string;
  expiresAt: number;
  createdAt: number;
}

export const TONES: readonly { id: BroadcastTone; label: string; hint: string }[] = [
  { id: "info", label: "Notice", hint: "Something to know." },
  { id: "warn", label: "Take care", hint: "Something to be careful about." },
  { id: "bad", label: "Stop", hint: "Something is wrong and work should pause." },
];

/** How long it keeps appearing. Past this it is noise. */
export const EXPIRY_CHOICES: readonly { hours: number; label: string }[] = [
  { hours: 4, label: "The rest of today" },
  { hours: 24, label: "One day" },
  { hours: 48, label: "Two days" },
  { hours: 168, label: "A week" },
];

export const DEFAULT_EXPIRY_HOURS = 48;

/**
 * The ones this person should be interrupted by, newest first.
 *
 * @param seen ids already dismissed on this device. Kept client-side on
 * purpose: a read receipt would need a row per person per message, and the
 * question being answered is only "has this screen shown it yet".
 */
export function pending(all: readonly Broadcast[], seen: readonly string[], now: number = Date.now()): Broadcast[] {
  const dismissed = new Set(seen);
  return all
    .filter((b) => !dismissed.has(b.id))
    .filter((b) => b.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Who a message went to, for the sender's own list. */
export const describeAudience = (b: Pick<Broadcast, "toId" | "toName">): string =>
  b.toId ? (b.toName || "one person") : "everyone";

/** Enough to be worth interrupting somebody with. */
export const isSendable = (draft: Pick<Broadcast, "title" | "body">): boolean =>
  !!(draft.title.trim() || draft.body.trim());

/** Cannot be sent, and why — shown beside the button rather than on submit. */
export function whyNotSendable(draft: Pick<Broadcast, "title" | "body">): string {
  if (!isSendable(draft)) return "Write the message first.";
  if (draft.title.trim().length > 120) return "Keep the heading under 120 characters — it is a headline, not the message.";
  if (draft.body.length > 2000) return "That is too long for a popup. Send the short version and email the rest.";
  return "";
}
