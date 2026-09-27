import { sortedNotes } from "./notes";
import type { Customer } from "./customer";

/**
 * Everything that has happened with one customer, in one list.
 *
 * WHY IT IS MERGED HERE AND NOT ON THE SCREEN. A record page's whole
 * argument is that you stop having to piece the story together yourself:
 * the call somebody logged on Tuesday and the quotation that went out on
 * Wednesday are the same story, and showing them in two panels beside each
 * other makes the reader do the merging. Done here, it is also testable —
 * ordering is the thing that quietly goes wrong, and it is invisible until
 * somebody reads the history backwards and draws the wrong conclusion.
 */

export type EntryKind = "note" | "document";

export interface RecordEntry {
  id: string;
  /** When it happened. Sorted on this and nothing else. */
  ts: number;
  kind: EntryKind;
  /** What happened: "Call", "Quotation sent". */
  label: string;
  /** The line under it, in the words whoever logged it used. */
  body?: string;
  /** Who, and anything worth knowing beside the time. */
  by?: string;
  /** For a document: what to show on the right of the row. */
  amount?: string;
  /** How the row reads — a lost call and a won quotation are not the same
   *  news. Left neutral unless there is a reason. */
  tone?: "neutral" | "accent" | "good" | "warn" | "bad";
}

/** What a document contributes to the story. Deliberately a narrow shape:
 *  the record page must not need the whole SalesDocument to show a line. */
export interface RecordDocument {
  id: string;
  number: string;
  /** "Quotation", "Tax invoice" — what it calls itself to a person. */
  kind: string;
  /** yyyy-mm-dd. */
  date: string;
  status?: string;
  amount?: string;
  by?: string;
}

const TONE_FOR_STATUS: Record<string, RecordEntry["tone"]> = {
  Accepted: "good", Paid: "good", Issued: "good", Received: "good",
  Sent: "accent", Draft: "neutral", Cancelled: "neutral",
  Expired: "bad", Rejected: "bad", Lost: "bad",
};

const TONE_FOR_OUTCOME: Record<string, RecordEntry["tone"]> = {
  "Interested": "good", "Quotation requested": "good", "Order confirmed": "good",
  "Call back later": "warn", "No answer": "warn",
  "Not interested": "bad", "Budget not approved": "bad",
};

/** Midday on the document's date: a document carries a day, not a moment,
 *  and putting it at midnight would sort it below every note logged that
 *  same day — reading as though the calls all came after it. */
const dayToTs = (date: string): number => new Date(date + "T12:00:00").getTime();

export function recordTimeline(
  customer: Pick<Customer, "notes">,
  documents: readonly RecordDocument[] = [],
): RecordEntry[] {
  const notes: RecordEntry[] = sortedNotes(customer).map((n) => ({
    id: "note_" + n.id,
    ts: n.ts,
    kind: "note",
    label: n.type || "Note",
    body: [n.text, n.nextAction ? "Next: " + n.nextAction : ""].filter(Boolean).join(" — "),
    by: n.user,
    tone: TONE_FOR_OUTCOME[n.outcome ?? ""] ?? "neutral",
  }));

  const docs: RecordEntry[] = documents.map((d) => ({
    id: "doc_" + d.id,
    ts: dayToTs(d.date),
    kind: "document",
    label: d.kind + " " + d.number,
    body: d.status ? d.status : undefined,
    by: d.by,
    amount: d.amount,
    tone: TONE_FOR_STATUS[d.status ?? ""] ?? "accent",
  }));

  return [...notes, ...docs].sort((a, b) => b.ts - a.ts);
}

export interface EntryDay {
  /** yyyy-mm-dd, so the screen decides how to word it. */
  date: string;
  entries: RecordEntry[];
}

/** Newest day first, and newest entry first within a day. */
export function groupEntriesByDay(entries: readonly RecordEntry[]): EntryDay[] {
  const days = new Map<string, RecordEntry[]>();
  for (const e of [...entries].sort((a, b) => b.ts - a.ts)) {
    const date = new Date(e.ts).toISOString().slice(0, 10);
    const bin = days.get(date) ?? [];
    bin.push(e);
    days.set(date, bin);
  }
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => ({ date, entries: list }));
}
