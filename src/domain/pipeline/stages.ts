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
 * NEITHER IS EVER CLEARED, including on the way to Lost. A customer who
 * bought in March and did not renew in September has still bought in March,
 * and a report that forgets it is wrong about March.
 */
export function applyStage<T extends { stage?: string; value?: number | string; wonAt?: number; wonValue?: number; lostAt?: number }>(
  customer: T,
  stage: StageId,
  now: number = Date.now(),
): T {
  return {
    ...customer,
    stage,
    wonAt: stage === "won" ? (customer.wonAt || now) : customer.wonAt,
    wonValue: stage === "won" ? (customer.wonValue ?? (Number(customer.value) || 0)) : customer.wonValue,
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
 * A record that has never been won has no `wonAt` and so counts for
 * nothing, which is every lead in the database.
 */
export function countsAsWon(customer: { stage?: string; wonAt?: number }): boolean {
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
