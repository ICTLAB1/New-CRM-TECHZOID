import type { SalesDocument } from "./create";

/**
 * The order documents are listed in: newest first.
 *
 * WHY THIS NEEDED WRITING AT ALL. The Quotations screen filtered its
 * documents and never sorted them, so the list came out in whatever order
 * the store happened to return — which is neither the order they were
 * raised in nor the order their numbers run in. A list of forty quotations
 * with no order is a list you have to read all of to find one.
 *
 * BY THE DOCUMENT'S OWN DATE, NOT BY WHEN THE ROW WAS WRITTEN. `date` is
 * what the document says and what the list column shows; `createdAt` is
 * when somebody pressed New. They differ whenever a document is
 * back-dated, and sorting by the hidden one would print a column of dates
 * that jump about for no visible reason.
 *
 * THEN BY NUMBER, NUMERICALLY. "TZ/QT/2627/0117" against
 * "TZ/QT/2627/0099": compared as text, 0117 sorts before 0099 only by the
 * luck of zero padding, and a series that ever reaches five digits loses
 * even that. The trailing run of digits is what moves, so that is what is
 * compared.
 */

/** The sequence at the end of a document number, or -1 when there is none. */
export function numberOf(doc: Pick<SalesDocument, "number">): number {
  const tail = String(doc.number ?? "").match(/(\d+)\s*$/);
  if (!tail?.[1]) return -1;
  const n = Number(tail[1]);
  return Number.isFinite(n) ? n : -1;
}

/**
 * Newest first. Date, then number, then when it was created.
 *
 * The last of the three is what keeps the order stable for two documents
 * raised on one day before either has a number — two drafts, which is the
 * ordinary case on a busy morning.
 */
export function compareDocuments(
  a: Pick<SalesDocument, "date" | "number" | "createdAt">,
  b: Pick<SalesDocument, "date" | "number" | "createdAt">,
): number {
  const byDate = String(b.date ?? "").localeCompare(String(a.date ?? ""));
  if (byDate !== 0) return byDate;

  const byNumber = numberOf(b) - numberOf(a);
  if (byNumber !== 0) return byNumber;

  return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
}

/** A sorted copy. The caller's array is left alone — it is usually the
 *  workspace's own list, which nothing on a screen may reorder in place. */
export function sortDocuments<T extends Pick<SalesDocument, "date" | "number" | "createdAt">>(
  documents: readonly T[],
): T[] {
  return [...documents].sort(compareDocuments);
}
