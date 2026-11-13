import type { DocStatus } from "./create";
import type { StageId } from "../pipeline/stages";

/**
 * What happened to a quotation, said in one click.
 *
 * WHY THIS IS NOT JUST THE STATUS DROPDOWN. Setting a quotation to
 * "Accepted" told the quotation and nothing else: the deal stayed in
 * Quotation Sent on the pipeline board, the automatic chasers kept going
 * out to a customer who had already said yes, and the win never reached the
 * revenue reports. The outcome is one fact about a deal, and four parts of
 * the CRM need it — so it is recorded once, here, and applied everywhere.
 *
 * THREE OUTCOMES, because that is how the work actually goes: the customer
 * agrees (accepted), the purchase order lands (won), or it goes elsewhere
 * (lost). Accepted is deliberately NOT a win — a quotation agreed to over
 * the phone is not revenue, and a CRM that counts it as revenue is a CRM
 * whose numbers nobody trusts by March.
 */
export type Outcome = "accepted" | "won" | "lost";

export const OUTCOMES: readonly Outcome[] = ["accepted", "won", "lost"];

/** What the button says. */
export const OUTCOME_LABEL: Record<Outcome, string> = {
  accepted: "Accepted",
  won: "Order won",
  lost: "Lost",
};

/** What it means, in the confirmation. */
export const OUTCOME_MEANS: Record<Outcome, string> = {
  accepted: "The customer has agreed to this quotation. The deal moves to Negotiation and the automatic chasers stop.",
  won: "The order is yours. The deal moves to Won, its value counts in the revenue reports, and the chasers stop.",
  lost: "It went elsewhere, or the customer said no. The deal moves to Lost and the chasers stop.",
};

/**
 * The status an outcome leaves on the document.
 *
 * A WIN WRITES "Accepted" rather than a status of its own. The quotation
 * only ever had five, the customer did accept it, and inventing a sixth
 * would mean every status filter, chip colour and report in the CRM had to
 * learn a word that means the same thing. Where the deal stands is the
 * customer's stage; this is what became of the piece of paper.
 */
export function statusAfterOutcome(outcome: Outcome): DocStatus {
  return outcome === "lost" ? "Rejected" : "Accepted";
}

/** How far along each open stage is — the same ladder as the board. */
const RANK: Record<string, number> = {
  lead: 0,
  contacted: 1,
  qualified: 2,
  quoted: 3,
  negotiation: 4,
};

/**
 * Where the customer should be once this outcome is recorded, or null to
 * leave them exactly where they are.
 *
 * A WIN OR A LOSS IS A DECISION and always lands: somebody has pressed a
 * button that says so, including on a deal already concluded the other way,
 * which is how a mistake gets corrected.
 *
 * ACCEPTED NEVER DRAGS ANYBODY BACKWARDS, and never touches a concluded
 * deal. It is one step along an open ladder — a customer already in
 * Negotiation stays there, and one already Won does not come back onto the
 * board because somebody tidied up an old quotation.
 */
export function stageAfterOutcome(outcome: Outcome, current?: string | null): StageId | null {
  if (outcome === "won") return current === "won" ? null : "won";
  if (outcome === "lost") return current === "lost" ? null : "lost";
  const stage = current ?? "";
  if (stage === "won" || stage === "lost") return null;
  const rank = RANK[stage] ?? RANK.lead;
  return (rank as number) < (RANK.negotiation as number) ? "negotiation" : null;
}

/**
 * Which outcomes are worth offering on a document.
 *
 * An outcome already recorded is left off rather than disabled: a row of
 * greyed-out buttons reads as a broken screen, and the one thing somebody
 * cannot do here is the thing they have already done.
 */
export function outcomesFor(
  doc: { status?: string },
  customerStage?: string | null,
): readonly Outcome[] {
  const status = doc.status ?? "";
  const stage = customerStage ?? "";
  return OUTCOMES.filter((o) => {
    if (o === "accepted") return status !== "Accepted";
    if (o === "won") return stage !== "won";
    return !(status === "Rejected" && stage === "lost");
  });
}

/**
 * What a deal is worth, for the snapshot a win freezes.
 *
 * The customer's own figure wins where there is one: it is what somebody
 * typed about this deal, and a quotation is one document against it. Where
 * there is none — which is every customer created from a quotation, and so
 * most of them — the quotation's own total is the only number anybody has,
 * and without it the win reaches the revenue report worth zero.
 */
export function wonValueFor(
  customer: { value?: number | string } | null | undefined,
  documentTotal: number,
): number | undefined {
  const typed = Number(customer?.value) || 0;
  if (typed > 0) return typed;
  return documentTotal > 0 ? documentTotal : undefined;
}
