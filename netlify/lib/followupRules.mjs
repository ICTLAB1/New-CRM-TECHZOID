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

/** Statuses that record a DECISION about the document. */
const DECIDED = {
  Accepted: "the customer accepted it",
  Rejected: "the customer turned it down",
  Expired: "it has expired",
  Cancelled: "it has been cancelled",
  Paid: "it has been paid",
};

/* "Draft" counts as undecided. Emailing a quotation from this CRM does not
   set its status to Sent — that field is set by hand — so treating Draft as
   a stop reason cancelled sequences the morning after they were armed, on
   the strength of a field nobody had updated. */
const UNDECIDED = new Set(["", "Draft", "Sent", "Issued"]);

/**
 * @param {{status?: string, validUntil?: string}} doc
 * @param {string} today YYYY-MM-DD
 * @returns {string|null} why to stop, or null to carry on
 */
export function stopReason(doc, today) {
  /* Validity first, and before the status is even considered: a quotation
     still marked "Sent" whose last valid day is behind it has expired
     whatever the row says. */
  if (doc?.validUntil && doc.validUntil < today) return "it has expired";

  const status = doc?.status ?? "";
  if (DECIDED[status]) return DECIDED[status];
  if (UNDECIDED.has(status)) return null;
  return `its status is now ${status}`;
}

/** Which table a queued follow-up's document lives in. */
export const TABLE_FOR = { quotation: "quotes", proforma: "proformas" };
