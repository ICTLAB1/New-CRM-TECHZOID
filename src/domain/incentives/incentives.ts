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
export function calcMetrics(
  ownerId: string,
  period: string,
  ws: Workspace,
  now: Date = new Date(),
): IncentiveMetrics {
  const bounds = periodBounds(period, now);
  const inPeriod = (ts: number | undefined | null): boolean =>
    !!ts && ts >= bounds.startMs && ts <= bounds.endMs;

  const mine = ws.customers.filter((c) => c.ownerId === ownerId);
  const won = mine.filter((c) => c.stage === "won" && inPeriod(c.wonAt));

  return {
    ...bounds,
    revenue: won.reduce((a, c) => a + (Number(c.value) || 0), 0),
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
