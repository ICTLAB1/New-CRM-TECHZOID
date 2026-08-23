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
 * it into the current month.
 */
export function applyStage<T extends { stage?: string; wonAt?: number }>(
  customer: T,
  stage: StageId,
  now: number = Date.now(),
): T {
  return {
    ...customer,
    stage,
    wonAt: stage === "won" ? (customer.wonAt || now) : customer.wonAt,
  };
}

/** Moving to Lost asks for a reason. It never requires one — see
 *  LostReasonModal: "Skip" is always available. */
export const stageNeedsReason = (stage: StageId): boolean => stage === "lost";
