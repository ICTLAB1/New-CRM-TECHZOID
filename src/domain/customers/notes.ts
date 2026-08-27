import type { Customer, CustomerNote } from "./customer";

/**
 * Notes: what somebody said, and what happens next.
 *
 * THE GAP THIS FILLS. `Customer.notes` has been in the type since the
 * beginning, the activity timeline reads it, and the webhook dispatcher
 * fires activity.logged when one appears. Nothing anywhere could create
 * one. So the timeline showed only what the app itself had recorded —
 * quotations raised, orders placed — and the entire half of it that is
 * meant to hold "rang Rajesh, wants the revised pricing by Friday" was
 * always empty. A CRM that cannot record a conversation is an invoicing
 * tool with a customer list.
 *
 * A note is APPEND-ONLY. There is no edit and no delete: a call log that
 * can be rewritten afterwards is not a record of anything, and the next
 * person reading it has no way to know it was changed. A correction is a
 * new note saying so.
 */

/** What a person can log. The same vocabulary the activity timeline
 *  filters by — a kind that is not in this list reads there as a plain
 *  Note, so the two lists staying together is not decoration. */
export const NOTE_TYPES = [
  "Note", "Call", "Email", "Meeting", "WhatsApp", "Site Visit", "Demo",
] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

/** How a conversation ended. Free text is allowed too — this is what the
 *  picker offers, not what the field accepts. */
export const NOTE_OUTCOMES = [
  "Interested", "Needs pricing", "Needs a demo", "Waiting on their approval",
  "Budget not ready", "No response", "Not interested",
] as const;

export interface NoteDraft {
  type: string;
  text: string;
  outcome?: string;
  nextAction?: string;
}

export const blankNote = (): NoteDraft => ({ type: "Call", text: "", outcome: "", nextAction: "" });

/** A note with nothing said in it is not worth keeping, whatever else was
 *  picked. The type defaults on its own and an outcome without a sentence
 *  behind it tells the next person nothing. */
export const noteIsEmpty = (draft: NoteDraft): boolean => !draft.text.trim();

let counter = 0;
const noteId = (now: number): string => `n${now.toString(36)}${(counter++).toString(36)}`;

export function newNote(
  draft: NoteDraft,
  user: { id: string; name: string },
  now: number = Date.now(),
): CustomerNote {
  return {
    id: noteId(now),
    ts: now,
    user: user.name || "Someone",
    userId: user.id,
    type: draft.type || "Note",
    text: draft.text.trim(),
    /* Stored only when they say something. An empty string in the record
       reads on the timeline as an outcome nobody filled in, which is a
       different thing from a call that had no outcome worth recording. */
    ...(draft.outcome?.trim() ? { outcome: draft.outcome.trim() } : {}),
    ...(draft.nextAction?.trim() ? { nextAction: draft.nextAction.trim() } : {}),
  };
}

/**
 * Add a note to a customer, newest first.
 *
 * @returns the customer unchanged when there is nothing to add, so a call
 * with an empty draft is safe and the caller does not have to check twice.
 */
export function addNote(
  customer: Customer,
  draft: NoteDraft,
  user: { id: string; name: string },
  now: number = Date.now(),
): Customer {
  if (noteIsEmpty(draft)) return customer;
  return { ...customer, notes: [newNote(draft, user, now), ...(customer.notes ?? [])] };
}

/** Newest first, for display. Notes are stored that way, but a record that
 *  arrived from an import or a webhook may not be. */
export const sortedNotes = (customer: Pick<Customer, "notes">): CustomerNote[] =>
  [...(customer.notes ?? [])].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

/** The last thing anybody recorded, for a one-line summary in a list. */
export const lastNote = (customer: Pick<Customer, "notes">): CustomerNote | null =>
  sortedNotes(customer)[0] ?? null;
