/** The pipeline. Stage ids are stored on every customer record in the live
 *  database — they must not be renamed. */
export type StageId = "lead" | "contacted" | "qualified" | "quoted" | "negotiation" | "won" | "lost";

export interface Stage {
  id: StageId;
  label: string;
  /** How this stage reads in the design system's semantic palette. */
  tone: "neutral" | "accent" | "warn" | "good" | "bad";
}

export const STAGES: readonly Stage[] = [
  { id: "lead", label: "Lead", tone: "neutral" },
  { id: "contacted", label: "Contacted", tone: "accent" },
  { id: "qualified", label: "Qualified", tone: "accent" },
  { id: "quoted", label: "Quotation Sent", tone: "warn" },
  { id: "negotiation", label: "Negotiation", tone: "warn" },
  { id: "won", label: "Won", tone: "good" },
  { id: "lost", label: "Lost", tone: "bad" },
];

/** An unknown or missing stage reads as Lead — legacy records predate some
 *  of these ids, and a record with no stage must still appear on the board. */
export const stageOf = (id: string | null | undefined): Stage => STAGES.find((s) => s.id === id) ?? (STAGES[0] as Stage);

export const isOpenStage = (id: string | null | undefined): boolean => id !== "won" && id !== "lost";

export const SEGMENTS = ["SMB", "Mid-Market", "Enterprise", "Government / PSU", "Education"] as const;

export const SOURCES = [
  "Inbound Call", "Website", "Referral", "GeM Portal", "LinkedIn", "Meta Ads",
  "Cold Outreach", "Existing Client", "Partner / OEM", "Customer Registration Form",
] as const;

export const LOST_REASONS = [
  "Price too high",
  "Lost to competitor",
  "Budget cut / postponed",
  "No response / went cold",
  "Requirement changed",
  "Went with existing vendor",
  "GeM tender — L1 not us",
  "Other",
] as const;

export interface LostDetail {
  lostReason?: string;
  lostCompetitor?: string;
  lostNotes?: string;
}

/**
 * Apply a stage change to a customer.
 *
 * Moving to Won stamps `wonAt` once and never re-stamps it — the trailing
 * revenue reports read that timestamp, so re-winning a deal must not move
 * it into the current month. `wonValue` is stamped the same way, and is the
 * reason a win survives what comes after it: quoting a won customer again
 * changes `value` to the new opportunity's size, and without a snapshot
 * last quarter's revenue would quietly change with it.
 *
 * THE WAY BACK OUT. The first version of this said the stamps were never
 * cleared, and that was wrong in a way that put money on a dashboard that
 * nobody had earned. Marking a deal Won is one click, and getting it wrong is
 * ordinary — a salesperson marks a quotation Won when it goes out, realises
 * the order has not actually landed, and drags it back to Quoted. The stamps
 * stayed, countsAsWon() reads them, and the deal counted as revenue for ever
 * with no way to take it back. Two deals like that were 92% of one month's
 * reported won revenue on a live workspace, neither with so much as a
 * quotation behind it.
 *
 * So a move from Won BACK INTO AN OPEN STAGE clears them: that is somebody
 * correcting themselves, and a correction has to be possible.
 *
 * The exception is `requote`, set only by the quotation screen when a NEW
 * quotation goes to a customer who had genuinely been won before. That is the
 * case the snapshot exists for — last quarter's revenue must not change
 * because this quarter's opportunity opened — and it is distinguishable
 * because a document was actually raised.
 *
 * On the way to LOST the stamps still stay. countsAsWon() already refuses a
 * lost deal, so nothing is over-counted, and a deal that was won and later
 * cancelled is a thing that happened.
 */
export interface StageChange {
  /** A new quotation to a previously-won customer — the one move off Won
   *  that is not a correction. Set by the quotation screen, never by hand. */
  requote?: boolean;
}

export function applyStage<T extends { stage?: string; value?: number | string; wonAt?: number; wonValue?: number; lostAt?: number }>(
  customer: T,
  stage: StageId,
  now: number = Date.now(),
  change: StageChange = {},
): T {
  /* Undoing a win: off Won, back onto the open board, and not because a
     quotation put them there. */
  const undoingWin = !!customer.wonAt && stage !== "won" && isOpenStage(stage) && !change.requote;

  return {
    ...customer,
    stage,
    wonAt: stage === "won" ? (customer.wonAt || now) : (undoingWin ? undefined : customer.wonAt),
    /* NEVER SNAPSHOT A ZERO. `??` falls through on null and undefined but
       not on 0, so a deal marked Won before anybody typed a value got
       wonValue: 0 and wonAmount() then returned 0 for ever — the value
       typed in afterwards could not get past the snapshot. Three won deals
       and no revenue at all was what that looked like on the incentives
       screen. Leaving it unset lets the live value through until there is
       something real to freeze. */
    wonValue: stage === "won"
      ? (customer.wonValue || (Number(customer.value) || undefined))
      : (undoingWin ? undefined : customer.wonValue),
    /* Re-stamped on every loss, unlike the win: this one dates the CURRENT
       conclusion, and a quotation raised after it is what tells the pipeline
       a lost customer has come back. */
    lostAt: stage === "lost" ? now : customer.lostAt,
  };
}

/**
 * Whether a customer's win still counts as revenue.
 *
 * NOT the same question as "is this customer in the Won column". Quoting an
 * existing client again moves them back into the pipeline, which is what
 * makes the new opportunity visible — and if revenue were read off the
 * current stage, that move would erase the sale they already made. A win is
 * a thing that happened on a date, not a state a record is in.
 *
 * LOST IS THE EXCEPTION, and leaving it out cost a day. `wonAt` is
 * deliberately never cleared, so a deal marked Won and later marked Lost
 * still carries the stamp — and a rule of "won, or has a wonAt" quietly
 * counted every one of them. On a live board that put a lost ₹39.76 L deal
 * into "Won this month": the tile read ₹42.21 L while the funnel three
 * inches below it read ₹3.03 L for the same deals.
 *
 * Lost is a conclusion somebody reached about this customer, and it is the
 * later one. A deal in an open stage with a wonAt is a customer coming
 * back; a deal in Lost is not, whatever happened before it.
 *
 * A record that has never been won has no `wonAt` and so counts for
 * nothing, which is every lead in the database.
 */
export function countsAsWon(customer: { stage?: string; wonAt?: number }): boolean {
  if (customer.stage === "lost") return false;
  return customer.stage === "won" || !!customer.wonAt;
}

/** What a win was worth: the value at the moment it was won, falling back
 *  to the current value for records stamped before `wonValue` existed. */
export function wonAmount(customer: { value?: number | string; wonValue?: number }): number {
  return Number(customer.wonValue ?? customer.value) || 0;
}

/** Moving to Lost asks for a reason. It never requires one — see
 *  LostReasonModal: "Skip" is always available. */
export const stageNeedsReason = (stage: StageId): boolean => stage === "lost";
