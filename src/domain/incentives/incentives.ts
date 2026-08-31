import { countsAsWon, wonAmount } from "../pipeline/stages";
import { computeDocument } from "../tax/compute";
import type { SalesDocument } from "../documents/create";
import { fyBounds, monthBounds } from "../numbering/docNumber";
import type { Workspace } from "../analytics/dashboard";

/**
 * Commission schemes.
 *
 * This is what people are paid on, so the arithmetic is v1's, unchanged —
 * including the two decisions that look like mistakes and are not:
 *
 *   · a Percentage payout is always a percentage of REVENUE, whatever the
 *     slab's metric. A slab on "Deals Won" at 2% pays 2% of revenue for
 *     hitting a deal count, not 2% of a deal count.
 *   · a slab's bonus is added on top of its payout, not instead of it.
 *
 * Both are how every payout already made was calculated. Changing either
 * would silently restate what somebody is owed.
 */

export type IncentivePeriod = "Monthly" | "Quarterly" | "Yearly";
export type IncentiveMetric = "Revenue" | "Deals Won" | "Quotations Sent" | "Renewals" | "New Customers";
export type PayoutType = "Percentage" | "Flat";

/**
 * What "revenue" means for a scheme.
 *
 * IT HAD ONLY ONE MEANING AND IT WAS THE WRONG ONE. Revenue was read from
 * the Deal value typed on the customer record — so a proforma paid and a
 * ₹22 lakh tax invoice raised and accepted counted for nothing, while the
 * screen said "worked out from deals actually closed, not from targets
 * typed in". Worse, a Percentage slab pays a percentage of REVENUE whatever
 * its metric, so a revenue of zero paid zero on every slab: three deals won
 * and no payout at all.
 *
 * The three are genuinely different money, and which one a company uses is
 * a decision about when people get paid, not a detail:
 *
 *   · "invoiced"   — tax invoices raised in the period. Recognised revenue,
 *                    and what most schemes here mean. Pays before the money
 *                    arrives.
 *   · "collected"  — payments actually received in the period, across
 *                    invoices and proformas. Safest for the company: nobody
 *                    is paid commission on an invoice that never clears.
 *   · "deal-value" — the Deal value typed on the customer, which is what
 *                    this did before. Kept so an existing scheme can be
 *                    left exactly as it was.
 */
export type RevenueBasis = "invoiced" | "collected" | "deal-value";

export const REVENUE_BASES: readonly { id: RevenueBasis; label: string; hint: string }[] = [
  { id: "invoiced", label: "Tax invoices raised", hint: "Counts an invoice the day it is raised, before the money arrives." },
  { id: "collected", label: "Payments received", hint: "Counts money as it actually clears, on invoices and proformas alike." },
  { id: "deal-value", label: "Deal value on the customer", hint: "The figure typed on the customer record. An estimate, not a document." },
];

/** Schemes saved before this existed measured the typed deal value, and
 *  changing that silently would restate what somebody is owed. */
export const DEFAULT_REVENUE_BASIS: RevenueBasis = "deal-value";

export interface IncentiveSlab {
  id: string;
  metric: IncentiveMetric | string;
  minTarget: number;
  /** 0 means "no upper bound". */
  maxTarget: number;
  payoutType: PayoutType | string;
  payoutValue: number;
  bonusFlat: number;
}

export interface IncentiveScheme {
  id: string;
  name: string;
  description?: string;
  period: IncentivePeriod | string;
  active: boolean;
  /** What its Revenue metric counts. Absent on a scheme saved before this
   *  existed, which is read as the old behaviour. */
  revenueBasis?: RevenueBasis | string;
  slabs: IncentiveSlab[];
}

export interface PeriodBounds {
  startMs: number;
  endMs: number;
  label: string;
}

/** The window a scheme measures. Quarters are Indian financial quarters:
 *  Q1 is April–June, so Q4 spans into the next calendar year. */
export function periodBounds(period: string, now: Date = new Date()): PeriodBounds {
  if (period === "Monthly") return monthBounds(now);
  if (period !== "Quarterly") return fyBounds(now);

  const month = now.getMonth();
  const quarter = month >= 3 && month <= 5 ? 1 : month >= 6 && month <= 8 ? 2 : month >= 9 && month <= 11 ? 3 : 4;
  const fyYear = month >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const startMonth = [3, 6, 9, 0][quarter - 1]!;
  const year = quarter === 4 ? fyYear + 1 : fyYear;
  return {
    startMs: new Date(year, startMonth, 1).getTime(),
    endMs: new Date(year, startMonth + 3, 0, 23, 59, 59, 999).getTime(),
    label: `Q${quarter} ${fyYear}-${String((fyYear + 1) % 100).padStart(2, "0")}`,
  };
}

export interface IncentiveMetrics extends PeriodBounds {
  revenue: number;
  dealsWon: number;
  newCustomers: number;
  quotationsSent: number;
  renewals: number;
}

/**
 * One person's performance over a scheme's period.
 *
 * Counted from the whole workspace, not a scoped one: an admin looking at a
 * salesperson's incentive needs that person's numbers, and a salesperson's
 * own browser only holds their own rows anyway.
 */
/** What a document is worth, tax included. */
const grandOf = (doc: SalesDocument, sellerState: string): number =>
  computeDocument(doc, sellerState).grand;

/** A tax invoice that was never really raised is not revenue. */
const RAISED = new Set(["Sent", "Issued", "Accepted", "Paid", "Partially Paid"]);

function revenueFor(
  ownerId: string,
  basis: RevenueBasis | string,
  ws: Workspace,
  won: { value?: number | string; wonValue?: number }[],
  ctx: {
    inPeriod: (ts: number | undefined | null) => boolean;
    inPeriodDate: (iso: string | undefined | null) => boolean;
    sellerState: string;
  },
): number {
  if (basis === "invoiced") {
    return (ws.invoices ?? [])
      .filter((d) => d.ownerId === ownerId && RAISED.has(String(d.status)) && ctx.inPeriod(d.createdAt))
      .reduce((a, d) => a + grandOf(d, ctx.sellerState), 0);
  }

  if (basis === "collected") {
    /* Across invoices AND proformas: this company takes payment against a
       proforma routinely, and money is money whichever document it arrived
       against. Dated by the PAYMENT, not the document — a January invoice
       settled in March is March's revenue to whoever is being paid on
       collections. */
    return [...(ws.invoices ?? []), ...ws.proformas]
      .filter((d) => d.ownerId === ownerId)
      .flatMap((d) => d.paymentHistory ?? [])
      .filter((p) => ctx.inPeriodDate(p.date))
      .reduce((a, p) => a + (Number(p.amount) || 0), 0);
  }

  return won.reduce((a, c) => a + wonAmount(c), 0);
}

export function calcMetrics(
  ownerId: string,
  period: string,
  ws: Workspace,
  now: Date = new Date(),
  basis: RevenueBasis | string = DEFAULT_REVENUE_BASIS,
  sellerState = "Delhi",
): IncentiveMetrics {
  const bounds = periodBounds(period, now);
  const inPeriod = (ts: number | undefined | null): boolean =>
    !!ts && ts >= bounds.startMs && ts <= bounds.endMs;
  const inPeriodDate = (iso: string | undefined | null): boolean => {
    if (!iso) return false;
    const ms = Date.parse(String(iso).slice(0, 10) + "T00:00:00");
    return Number.isFinite(ms) && ms >= bounds.startMs && ms <= bounds.endMs;
  };

  const mine = ws.customers.filter((c) => c.ownerId === ownerId);
  const won = mine.filter((c) => countsAsWon(c) && inPeriod(c.wonAt));

  return {
    ...bounds,
    revenue: revenueFor(ownerId, basis, ws, won, { inPeriod, inPeriodDate, sellerState }),
    dealsWon: won.length,
    newCustomers: mine.filter((c) => inPeriod(c.createdAt)).length,
    quotationsSent: ws.quotations.filter((q) => q.ownerId === ownerId && inPeriod(q.createdAt)).length,
    renewals: ws.subscriptions.filter(
      (s) => s.ownerId === ownerId && s.status === "Renewed" && inPeriod(s.updatedAt),
    ).length,
  };
}

export interface SlabResult {
  slab: IncentiveSlab;
  /** The metric's actual value for this person and period. */
  actual: number;
  qualified: boolean;
  payout: number;
}

export interface PayoutResult {
  totalPayout: number;
  breakdown: SlabResult[];
}

const metricValue = (metric: string, m: IncentiveMetrics): number => {
  switch (metric) {
    case "Revenue": return m.revenue;
    case "Deals Won": return m.dealsWon;
    case "Quotations Sent": return m.quotationsSent;
    case "Renewals": return m.renewals;
    case "New Customers": return m.newCustomers;
    default: return 0;
  }
};

export function computePayout(scheme: IncentiveScheme, metrics: IncentiveMetrics): PayoutResult {
  let totalPayout = 0;
  const breakdown = (scheme.slabs ?? []).map((slab) => {
    const actual = metricValue(slab.metric, metrics);
    const min = Number(slab.minTarget) || 0;
    /* A maxTarget of 0 means no ceiling. */
    const max = Number(slab.maxTarget) || Infinity;
    const qualified = actual >= min && actual <= max;

    let payout = 0;
    if (qualified) {
      payout = slab.payoutType === "Percentage"
        ? (metrics.revenue * (Number(slab.payoutValue) || 0)) / 100
        : Number(slab.payoutValue) || 0;
      payout += Number(slab.bonusFlat) || 0;
    }
    totalPayout += payout;
    return { slab, actual, qualified, payout };
  });
  return { totalPayout, breakdown };
}

/** The nearest slab still out of reach, and by how much. Null when every
 *  slab has been met. */
export function nextTarget(result: PayoutResult, metrics: IncentiveMetrics): { slab: IncentiveSlab; gap: number } | null {
  const missed = result.breakdown.filter((b) => !b.qualified);
  if (!missed.length) return null;
  const nearest = missed
    .map((b) => ({ slab: b.slab, gap: Math.max(0, (Number(b.slab.minTarget) || 0) - metricValue(b.slab.metric, metrics)) }))
    .sort((a, b) => a.gap - b.gap)[0]!;
  return nearest;
}

export const activeSchemes = (schemes: readonly IncentiveScheme[] | undefined): IncentiveScheme[] =>
  (schemes ?? []).filter((s) => s.active);
