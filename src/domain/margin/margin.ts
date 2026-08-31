import type { LineItem } from "../tax/types";

/**
 * What a deal actually earns.
 *
 * WHY COST LIVES ON THE LINE, NOT LOOKED UP FROM THE CATALOG. A price list
 * changes; a quotation does not. Reading the catalog when a six-week-old
 * quotation is reopened would restate its margin every time a distributor
 * moved a price, and last month's reported margin would drift under
 * everyone's feet. The cost is captured when the product is picked and
 * stays with the line — the same reason `wonValue` is snapshotted when a
 * deal is won.
 *
 * NONE OF THIS REACHES THE CUSTOMER. Cost and margin are on the document
 * record and on the editor's own screen; they are not in the PDF model and
 * must never be. There is a test asserting exactly that, because the day
 * somebody adds a "cost" column to the item table for debugging is the day
 * a customer opens a quotation and reads what you paid for it.
 */

export interface LineMargin {
  /** After discount, before tax — margin is not earned on tax. */
  revenue: number;
  cost: number;
  /** revenue − cost. Negative means the line is quoted below cost. */
  amount: number;
  /** As a percentage of revenue. Null when there is no revenue to divide
   *  by, which is not the same as zero margin. */
  percent: number | null;
  /** False when the line carries no cost at all — an unpriced line is
   *  unknown, not free, and averaging it in as zero cost would report a
   *  100% margin on a line nobody has costed. */
  known: boolean;
}

export interface DocumentMargin extends LineMargin {
  /** Lines that carry a cost, and lines in total. The gap is what the
   *  figure does not cover. */
  costedLines: number;
  totalLines: number;
  /** True when at least one line is quoted below what it cost. */
  anyBelowCost: boolean;
}

const num = (v: unknown): number => Number(v) || 0;

/** Revenue on a line: quantity × rate, less the discount. */
export function lineRevenue(item: Pick<LineItem, "qty" | "rate" | "disc">): number {
  const gross = num(item.qty) * num(item.rate);
  return gross - (gross * num(item.disc)) / 100;
}

export function lineMargin(item: Pick<LineItem, "qty" | "rate" | "disc" | "cost">): LineMargin {
  const revenue = lineRevenue(item);
  const known = item.cost !== undefined && item.cost !== null && item.cost !== "";
  const cost = known ? num(item.cost) * num(item.qty) : 0;
  const amount = revenue - cost;
  return {
    revenue,
    cost,
    amount: known ? amount : 0,
    percent: known && revenue !== 0 ? (amount / revenue) * 100 : null,
    known,
  };
}

/**
 * The whole document.
 *
 * Only costed lines contribute. A quotation where half the lines have no
 * cost reports the margin on the half it knows, and says so through
 * `costedLines` — a single percentage that quietly treats unpriced lines as
 * pure profit is worse than no percentage at all.
 */
export function documentMargin(items: readonly Pick<LineItem, "qty" | "rate" | "disc" | "cost">[]): DocumentMargin {
  let revenue = 0;
  let cost = 0;
  let costedLines = 0;
  let anyBelowCost = false;

  for (const item of items) {
    const m = lineMargin(item);
    if (!m.known) continue;
    revenue += m.revenue;
    cost += m.cost;
    costedLines += 1;
    if (m.amount < 0) anyBelowCost = true;
  }

  const amount = revenue - cost;
  return {
    revenue, cost, amount,
    percent: revenue !== 0 ? (amount / revenue) * 100 : null,
    known: costedLines > 0,
    costedLines,
    totalLines: items.length,
    anyBelowCost,
  };
}

/** Below this, somebody should look at the deal before it goes out. */
export const THIN_MARGIN_PERCENT = 5;

export type MarginTone = "good" | "warn" | "bad" | "neutral";

/**
 * How a margin should read to the person about to send the quotation.
 *
 * Silence on an uncosted document is deliberate: showing "0%" where the
 * answer is "nobody has entered a cost" is a false statement, and one that
 * would have people chasing a margin problem that does not exist.
 */
export function marginTone(m: DocumentMargin): MarginTone {
  if (!m.known) return "neutral";
  if (m.anyBelowCost || (m.percent ?? 0) < 0) return "bad";
  if ((m.percent ?? 0) < THIN_MARGIN_PERCENT) return "warn";
  return "good";
}

export function marginNote(m: DocumentMargin): string {
  if (!m.known) {
    return m.totalLines
      ? "No cost on any line yet, so there is no margin to show."
      : "Nothing quoted yet.";
  }
  const uncosted = m.totalLines - m.costedLines;
  const parts: string[] = [];
  if (m.anyBelowCost) parts.push("At least one line is priced below what it cost.");
  else if ((m.percent ?? 0) < THIN_MARGIN_PERCENT) parts.push("That is a thin margin — worth a second look before it goes out.");
  if (uncosted > 0) {
    parts.push(`${uncosted} line${uncosted === 1 ? "" : "s"} carr${uncosted === 1 ? "ies" : "y"} no cost and ${uncosted === 1 ? "is" : "are"} not counted.`);
  }
  return parts.join(" ");
}
