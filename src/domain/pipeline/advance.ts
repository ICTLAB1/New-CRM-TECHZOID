import type { StageId } from "./stages";

/**
 * Moving a customer along the board because something actually happened.
 *
 * The pipeline column is called "Quotation Sent", and until now nothing
 * ever put a customer in it: the stage was a field somebody remembered to
 * change by hand, so a quotation could go out on Monday and the deal would
 * still be sitting in Lead on Friday. The board is meant to be the picture
 * of where every deal is; a picture that only updates when someone
 * maintains it separately is a to-do list pretending to be a report.
 *
 * ONE DIRECTION ONLY. These functions never move a customer backwards, and
 * that is the whole safety property. A second quotation raised for a
 * customer who is already in Negotiation must not drag them back to
 * Quotation Sent, and nothing here may touch a deal somebody has marked Won
 * or Lost — those are decisions, and a decision is not something an
 * automatic rule gets to overwrite.
 */

/** How far along each stage is. Won and Lost sit outside the ladder: they
 *  are conclusions, not steps, and nothing automatic may move them. */
const RANK: Record<string, number> = {
  lead: 0,
  contacted: 1,
  qualified: 2,
  quoted: 3,
  negotiation: 4,
};

const CONCLUDED = new Set(["won", "lost"]);

/**
 * The stage a customer should be in once a quotation has gone to them, or
 * null when they should be left exactly where they are.
 *
 * @param current the customer's stage now — anything unrecognised is
 * treated as Lead, which is how the board already reads a legacy record.
 */
export function stageAfterQuotation(current: string | null | undefined): StageId | null {
  const stage = current ?? "";
  if (CONCLUDED.has(stage)) return null;
  const rank = RANK[stage] ?? RANK.lead;
  return (rank as number) < (RANK.quoted as number) ? "quoted" : null;
}

/**
 * Whether a document going out should count as "the quotation was sent".
 *
 * A proforma is an offer the customer is being asked to act on, so it
 * counts. A tax invoice does not: by the time one exists the deal is won,
 * and moving a won customer back to Quotation Sent would be a lie. A
 * purchase order faces a supplier, not a customer, and has no place on this
 * board at all.
 */
export function advancesPipeline(docType: string): boolean {
  return docType === "quotation" || docType === "proforma";
}
