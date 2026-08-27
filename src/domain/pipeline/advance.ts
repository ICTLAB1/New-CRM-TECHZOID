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
 *  are conclusions, not steps, and the rules below treat them separately. */
const RANK: Record<string, number> = {
  lead: 0,
  contacted: 1,
  qualified: 2,
  quoted: 3,
  negotiation: 4,
};

const CONCLUDED = new Set(["won", "lost"]);

/** Whether a stage is a conclusion rather than a step. */
export const isConcluded = (stage: string | null | undefined): boolean => CONCLUDED.has(stage ?? "");

export interface QuotationTiming {
  /** When the deal was concluded — `wonAt` for a win, `lostAt` for a loss.
   *  Missing on records that predate the stamps, which is read as "long
   *  ago": an old closed deal being quoted today is new business. */
  concludedAt?: number | null;
  /** When the quotation was raised. */
  quotedAt?: number | null;
}

/**
 * The stage a customer should be in once a quotation has gone to them, or
 * null when they should be left exactly where they are.
 *
 * REPEAT BUSINESS IS THE HARD CASE, and getting it wrong is what put this
 * comment here. The first version of this function refused to touch a
 * customer marked Won or Lost, on the reasoning that a conclusion is a
 * decision and an automatic rule has no business overwriting one. That is
 * right about the deal that was concluded — and wrong about the customer,
 * because a quotation raised for them TODAY is not that deal. An existing
 * client is the likeliest person in the database to be quoted again, and
 * under the old rule their quotation was the one that never appeared on the
 * board at all.
 *
 * So the question is not "is this customer concluded" but "was this
 * quotation raised after that conclusion". A quotation that predates the
 * win is the paperwork of the won deal — re-sending it must not drag the
 * customer backwards. A quotation raised afterwards is a fresh opportunity
 * and belongs in the pipeline. What is NOT lost by moving them: `wonAt` and
 * `wonValue` stay on the record, and the revenue reports read those rather
 * than the current stage — see countsAsWon() in stages.ts.
 *
 * Within the open stages this stays strictly one-directional: a second
 * quotation for a customer already in Negotiation leaves them there.
 *
 * @param current the customer's stage now — anything unrecognised is
 * treated as Lead, which is how the board already reads a legacy record.
 */
export function stageAfterQuotation(
  current: string | null | undefined,
  timing: QuotationTiming = {},
): StageId | null {
  const stage = current ?? "";
  if (CONCLUDED.has(stage)) {
    return (timing.quotedAt ?? 0) > (timing.concludedAt ?? 0) ? "quoted" : null;
  }
  const rank = RANK[stage] ?? RANK.lead;
  return (rank as number) < (RANK.quoted as number) ? "quoted" : null;
}

/** When a customer's deal was concluded, for the rule above. */
export const concludedAt = (
  customer: { stage?: string; wonAt?: number; lostAt?: number } | null | undefined,
): number | null => {
  if (!customer) return null;
  if (customer.stage === "won") return customer.wonAt ?? null;
  if (customer.stage === "lost") return customer.lostAt ?? null;
  return null;
};

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
