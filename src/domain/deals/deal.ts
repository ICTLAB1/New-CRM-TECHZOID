import { totalsByCurrency, type CurrencyTotal } from "../currency/format";
import { isConcluded } from "../pipeline/advance";
import type { StageId } from "../pipeline/stages";

/**
 * A deal: one thing being sold to one customer.
 *
 * WHY THIS EXISTS, AND WHAT IT REPLACES. Until now the CUSTOMER carried the
 * pipeline stage, which made the customer the deal. One position on the
 * board per company, forever. For a reseller that is wrong in the ordinary
 * case, not the exotic one: quoting Modi Mundipharma for a Microsoft
 * renewal and an Autodesk purchase in the same week is two deals, at two
 * stages, worth two amounts, closing on two dates — and the old model could
 * hold exactly one of them.
 *
 * The strain is already visible in the code this supersedes.
 * `pipeline/advance.ts` carries concludedAt, isConcluded and countsAsWon
 * for one reason: a repeat quotation to a customer marked Won had to be
 * stopped from either dragging a finished deal backwards or vanishing from
 * the board. With deals as records that question disappears — a repeat
 * quotation is simply a NEW deal, and the old one stays won. None of that
 * machinery is deleted yet, because the customer board still runs on it
 * until the screens move over.
 *
 * NO MONEY IS SUMMED ACROSS CURRENCIES HERE. A dollar deal added to a rupee
 * one produces a number that is wrong by the whole of the dollar one and
 * looks authoritative doing it — the same rule the document lists already
 * follow. Every total this module returns is per currency.
 */
export interface Deal {
  id: string;
  /** The account this deal is with. */
  customerId: string;
  /** What is being sold, in words a salesperson would use:
   *  "Microsoft 365 E3 renewal, FY 2026-27". */
  name: string;
  stage: StageId;
  /** What it is expected to be worth, in its own currency. Not derived from
   *  the quotation: a deal exists before there is one, and is forecast from
   *  the day it is created. */
  value: number;
  currency: string;
  /** Expected close, yyyy-mm-dd. What the forecast is bucketed by. */
  expectedClose: string;
  /** Set only when somebody knows better than the stage. Null means "use
   *  the stage", which is the honest default — a number typed once and
   *  never revisited is worse than no number. */
  probability?: number | null;
  ownerId: string;
  source?: string;
  lostReason?: string;
  /** When it was won or lost. */
  concludedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * How likely each stage is to close, as a percentage.
 *
 * These are the defaults every CRM ships and every company then argues
 * about, which is why `probability` on the deal overrides them. Won and
 * Lost are certainties, not estimates.
 */
export const STAGE_PROBABILITY: Record<StageId, number> = {
  lead: 10,
  contacted: 20,
  qualified: 40,
  quoted: 60,
  negotiation: 80,
  won: 100,
  lost: 0,
};

/** A deal that has not been concluded. */
export const isOpenDeal = (deal: Pick<Deal, "stage">): boolean => !isConcluded(deal.stage);

/**
 * How likely this deal is, 0–100.
 *
 * A CONCLUSION IGNORES THE OVERRIDE. Somebody who typed 75% into a deal
 * that was later lost did not mean "still 75% likely"; they meant it while
 * it was open. Reading the override after the fact would put a lost deal
 * back into the forecast.
 */
export function likelihood(deal: Pick<Deal, "stage" | "probability">): number {
  if (isConcluded(deal.stage)) return STAGE_PROBABILITY[deal.stage] ?? 0;
  const set = deal.probability;
  if (set === null || set === undefined) return STAGE_PROBABILITY[deal.stage] ?? 0;
  const n = Number(set);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : STAGE_PROBABILITY[deal.stage] ?? 0;
}

/** The deal's value discounted by how likely it is. */
export const weightedValue = (deal: Pick<Deal, "stage" | "probability" | "value">): number =>
  (Number(deal.value) || 0) * (likelihood(deal) / 100);

export interface Forecast {
  /** Won in the window: money that is actually committed. */
  won: CurrencyTotal[];
  /** Open deals at full value — the best case, not a prediction. */
  open: CurrencyTotal[];
  /** Open deals discounted by likelihood. The number to plan against. */
  weighted: CurrencyTotal[];
  /** Lost in the window, kept because a forecast with no denominator
   *  cannot be judged. */
  lost: CurrencyTotal[];
}

/** Deals whose expected close falls in [from, to], both yyyy-mm-dd and
 *  both inclusive. String comparison is correct for ISO dates and avoids a
 *  timezone turning a 31 March close into 1 April. */
export const closesWithin = (deal: Pick<Deal, "expectedClose">, from: string, to: string): boolean =>
  !!deal.expectedClose && deal.expectedClose >= from && deal.expectedClose <= to;

/**
 * What the pipeline is worth over a window, per currency.
 *
 * Bucketed by EXPECTED CLOSE, not by when the deal was created — a
 * forecast answers "what lands this quarter", and a deal created in
 * January closing in June belongs to June.
 */
export function forecast(deals: readonly Deal[], from: string, to: string, fallback = "INR"): Forecast {
  const inWindow = deals.filter((d) => closesWithin(d, from, to));
  const cur = (d: Deal) => d.currency;
  const open = inWindow.filter(isOpenDeal);
  return {
    won: totalsByCurrency(inWindow.filter((d) => d.stage === "won"), (d) => Number(d.value) || 0, cur, fallback),
    open: totalsByCurrency(open, (d) => Number(d.value) || 0, cur, fallback),
    weighted: totalsByCurrency(open, weightedValue, cur, fallback),
    lost: totalsByCurrency(inWindow.filter((d) => d.stage === "lost"), (d) => Number(d.value) || 0, cur, fallback),
  };
}

/**
 * The stage to show against a CUSTOMER who now has several deals.
 *
 * The customer board still exists and still wants one badge per company.
 * The furthest-along OPEN deal is what that badge should say: a company
 * with a deal in Negotiation and another in Lead is a company in
 * negotiation. With nothing open, the most recent conclusion stands — and
 * a win outranks a loss on the same day, because "we sell to them" is the
 * more useful fact about an account than "we once didn't".
 */
export function rollUpStage(deals: readonly Pick<Deal, "stage" | "concludedAt">[]): StageId | null {
  if (!deals.length) return null;
  const open = deals.filter(isOpenDeal);
  if (open.length) {
    const rank: Record<string, number> = { lead: 0, contacted: 1, qualified: 2, quoted: 3, negotiation: 4 };
    return open.reduce((best, d) => ((rank[d.stage] ?? 0) > (rank[best.stage] ?? 0) ? d : best)).stage;
  }
  const latest = deals.reduce((best, d) => {
    const a = d.concludedAt ?? 0;
    const b = best.concludedAt ?? 0;
    if (a !== b) return a > b ? d : best;
    return best.stage === "won" ? best : d;
  });
  return latest.stage;
}

const uid = (): string => "deal_" + Math.random().toString(36).slice(2, 10);

/** Days from today, as yyyy-mm-dd. */
function addDays(days: number, today: Date = new Date()): string {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function blankDeal(
  ownerId: string,
  customerId: string,
  defaults: { currency?: string; closeInDays?: number } = {},
  today: Date = new Date(),
): Deal {
  const now = Date.now();
  return {
    id: uid(),
    customerId,
    name: "",
    stage: "lead",
    value: 0,
    currency: defaults.currency || "INR",
    expectedClose: addDays(defaults.closeInDays ?? 30, today),
    probability: null,
    ownerId,
    source: "",
    lostReason: "",
    concludedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Move a deal to a stage, stamping a conclusion when it becomes one.
 *
 * UNLIKE THE CUSTOMER BOARD, THIS GOES BOTH WAYS. `pipeline/advance.ts`
 * refuses to move a customer backwards, and it had to: with one stage per
 * company, a backwards move would have been an automatic rule overwriting
 * somebody's decision about a different deal. A deal is its own record, so
 * a salesperson dragging one back from Negotiation to Qualified is simply
 * telling the truth about that deal.
 */
export function setStage(deal: Deal, stage: StageId, now: number = Date.now()): Deal {
  if (deal.stage === stage) return deal;
  const concluding = isConcluded(stage);
  return {
    ...deal,
    stage,
    /* Reopening clears the stamp: a deal back in Negotiation has not been
       concluded, and leaving the date behind would keep it out of the open
       pipeline while it sat on the board. */
    concludedAt: concluding ? now : null,
    lostReason: stage === "lost" ? deal.lostReason : "",
    updatedAt: now,
  };
}
