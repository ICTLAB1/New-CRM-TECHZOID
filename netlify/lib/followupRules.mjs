/**
 * Whether a document should still be chased.
 *
 * A DELIBERATE SECOND COPY of the rule in
 * src/domain/followups/followups.ts (`stopReason`), and the only one in this
 * codebase. It exists because the scheduler runs as a Netlify function in
 * plain JavaScript and cannot import the app's TypeScript, and because the
 * check has to happen HERE: the app decides what to queue, but weeks can
 * pass before a row is sent, and in that time the quotation may have been
 * accepted, turned down or left to expire. Trusting the queue would mean
 * chasing a customer for a decision they already gave.
 *
 * It is kept to four lines for that reason, and pinned by tests in
 * lib.test.mjs alongside the TypeScript ones. If the statuses ever change,
 * both move together — and the tests on both sides fail until they do.
 */

/** Statuses that mean the document is still out with the customer. */
const LIVE = new Set(["Sent", "Issued"]);

/**
 * @param {{status?: string, validUntil?: string}} doc
 * @param {string} today YYYY-MM-DD
 * @returns {string|null} why to stop, or null to carry on
 */
export function stopReason(doc, today) {
  const status = doc?.status ?? "";

  /* Validity first, and before the status is even considered: a quotation
     still marked "Sent" whose validity ran out yesterday has expired
     whatever the row says. The app shows the same thing — see
     effectiveStatus in src/domain/documents/create.ts. */
  if (LIVE.has(status) && doc?.validUntil && doc.validUntil < today) return "it has expired";

  if (LIVE.has(status)) return null;
  if (!status || status === "Draft") return "it is back to a draft";
  if (status === "Accepted") return "the customer accepted it";
  if (status === "Rejected") return "the customer turned it down";
  if (status === "Expired") return "it has expired";
  if (status === "Paid") return "it has been paid";
  return `its status is now ${status}`;
}

/** Which table a queued follow-up's document lives in. */
export const TABLE_FOR = { quotation: "quotes", proforma: "proformas" };
