import { round2 } from "../money";

/**
 * Price book arithmetic: what a salesperson may not go below, and what the
 * deal really earns once the distributor's discount is known.
 *
 * PURE. No clock, no I/O: `today` is passed in, as everywhere else in this
 * domain folder.
 *
 * THE DATABASE IS AUTHORITATIVE, NOT THIS FILE. Every number here also
 * exists in supabase/056_price_book.sql — `min_selling_price()`,
 * `min_margin_pct()` and the buying price inside
 * `price_book_search_costed()` — because a browser may not be trusted with
 * the floor it is being held to. This copy exists so the quotation editor
 * can show the minimum and warn before the save, and so the approvals
 * screen can recompute a margin live while an Admin types a discount.
 * pricing.test.ts asserts both copies agree, on the same numbers the SQL
 * proof asserts, and crossCheck.test.ts runs the two against each other
 * value by value when a Postgres is available.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT "MARGIN %" MEANS HERE, AND WHY IT IS NOT WHAT IT MEANS IN
 * src/domain/margin/margin.ts. THESE TWO ARE DIFFERENT NUMBERS AND BOTH
 * ARE CALLED "MARGIN".
 *
 *   This file, and the min_margin_pct column: a MARKUP ON THE RESELLER
 *   PRICE. The specification is explicit — minimum selling price =
 *   reseller price x (1 + minimum margin %) — so 15% on a ₹1,000 product
 *   gives a floor of ₹1,150.
 *
 *   margin.ts, and every margin figure the CRM already shows: GROSS MARGIN
 *   ON REVENUE, (revenue - cost) / revenue. The same deal reads 13.04%
 *   there: ₹150 earned on ₹1,150 sold.
 *
 * Neither is wrong, but an Admin who types 15 into a field labelled
 * "minimum margin %" expecting the figure the rest of the CRM shows them
 * will set a floor about two points lower than they meant. So nothing in
 * this module shows one reading alone: marginReadings() returns both, and
 * the screens print both.
 * ────────────────────────────────────────────────────────────────────────
 */

/** The OEM value that stands for "every OEM in this company". */
export const COMPANY_DEFAULT_OEM = "*";

/**
 * The distributor discount a deal ordinarily attracts: nothing to 3.5%.
 * Higher happens, so it is not a limit — it is the point past which the
 * approvals screen asks the Admin to confirm they meant it.
 */
export const ORDINARY_DISTRIBUTOR_DISCOUNT_MAX = 3.5;

/** Half a paisa. Below this, two prices are the same price. */
export const PRICE_EPSILON = 0.005;

export interface MarginRule {
  /** An OEM name, or COMPANY_DEFAULT_OEM for the company-wide default. */
  oem: string;
  /** null or absent means "the whole OEM". */
  category?: string | null;
  /** null or absent means "the whole category". */
  sku?: string | null;
  minMarginPct: number;
}

export interface PriceBookItem {
  oem: string;
  sku: string;
  category?: string | null;
}

const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * The minimum margin that applies to one product: the most specific rule
 * wins — SKU, then category, then the OEM, then the company default.
 *
 * NO RULE AT ALL MEANS ZERO, which puts the floor at the reseller price
 * rather than below it. That is the safe end of the mistake: a workspace
 * nobody has configured yet cannot let a BDE quote under cost, it just
 * lets them quote at cost. Mirrors min_margin_pct() in migration 056,
 * including the ordering.
 */
export function resolveMinMarginPct(rules: readonly MarginRule[], item: PriceBookItem): number {
  const matches = rules.filter(
    (r) =>
      (same(r.oem, item.oem) || r.oem === COMPANY_DEFAULT_OEM) &&
      (r.category == null || same(r.category, item.category)) &&
      (r.sku == null || same(r.sku, item.sku)),
  );
  if (!matches.length) return 0;

  const rank = (r: MarginRule): number =>
    (r.sku != null ? 4 : 0) + (r.category != null ? 2 : 0) + (r.oem !== COMPANY_DEFAULT_OEM ? 1 : 0);
  return matches.reduce((best, r) => (rank(r) > rank(best) ? r : best)).minMarginPct;
}

/* ── the two prices ──────────────────────────────────────────────────────
   Both are computed in whole paise rather than with round2 on a float.
   round2 is right for summing a document, but here the number is compared
   against the database's own, and numeric(14,2) rounding and binary
   floating point part company whenever the exact answer lands on a half
   paisa. ₹100.10 at a 15% minimum margin is exactly ₹115.115: Postgres
   rounds it to 115.12, and round2(100.10 * 1.15) gives 115.11, because
   the product is held as 115.11499999999999. Searched over every price to
   the paisa from ₹100 to ₹5,000 against every quarter-point of margin up
   to 40%, the two disagree on tens of thousands of combinations.

   A disagreement of one paisa is not cosmetic: the editor would tell a
   salesperson their price is fine and the server would hold it below the
   floor and lock the quotation for an approval. Integer paise cannot
   drift. Every value in pricing.test.ts was computed by this CRM's own
   Postgres first and then asserted here, and 630 random pairs were run
   through both to confirm they do not diverge anywhere else. */

const paise = (rupees: number): number => Math.round((Number(rupees) || 0) * 100);
/** min_margin_pct is numeric(6,3): thousandths of a percent. */
const milli = (pct: number): number => Math.round((Number(pct) || 0) * 1000);

/**
 * The lowest price a salesperson may quote: the reseller price plus the
 * minimum margin, WITH NO DISTRIBUTOR DISCOUNT ASSUMED.
 *
 * Leaving the discount out is the point. The floor is set against the
 * price the list actually states, so a discount negotiated later is margin
 * earned rather than margin already spent.
 */
export function minSellingPrice(resellerPrice: number, minMarginPct: number): number {
  return Math.round((paise(resellerPrice) * (100_000 + milli(minMarginPct))) / 100_000) / 100;
}

/** What the stock costs once the distributor's discount is applied. */
export function buyingPrice(resellerPrice: number, distributorDiscountPct: number): number {
  return Math.round((paise(resellerPrice) * (100_000 - milli(distributorDiscountPct))) / 100_000) / 100;
}

/** Past the ordinary band. Not refused — confirmed. */
export function isUnusualDistributorDiscount(pct: number): boolean {
  return (Number(pct) || 0) > ORDINARY_DISTRIBUTOR_DISCOUNT_MAX;
}

export interface MarginReadings {
  /** Over the buying price, which is what min_margin_pct means. */
  markupPct: number | null;
  /** Of the selling price, which is what the rest of the CRM means. */
  grossMarginPct: number | null;
  /** Rupees earned. */
  amount: number;
}

/**
 * What a line earns, said both ways, because "margin" means one thing in
 * this module and another everywhere else in the CRM. A screen that prints
 * one number and calls it the margin is a screen somebody will misread.
 *
 * Returns nulls rather than zeroes where a percentage has no meaning: a
 * price of nothing has no margin, and free stock has no markup.
 */
export function marginReadings(sellingPrice: number, costPrice: number): MarginReadings {
  const sell = Number(sellingPrice) || 0;
  const cost = Number(costPrice) || 0;
  const amount = round2(sell - cost);
  return {
    markupPct: cost > 0 ? round2((amount / cost) * 100) : null,
    grossMarginPct: sell > 0 ? round2((amount / sell) * 100) : null,
    amount,
  };
}

/* ── the approval gate ───────────────────────────────────────────────── */

/** Below the floor, by more than half a paisa. */
export function isBelowMinimum(unitPrice: number, minPrice: number): boolean {
  return (Number(unitPrice) || 0) < (Number(minPrice) || 0) - PRICE_EPSILON;
}

export interface QuoteLineForApproval {
  lineId: string;
  sku?: string;
  qty?: number;
  /** The minimum selling price for this line's item, as the server gave it. */
  minPrice?: number | null;
  /** What the salesperson typed. */
  unitPrice: number;
  /** A price an Admin has already approved for this line, if any. */
  approvedPrice?: number | null;
}

export interface ApprovalNeed {
  lineId: string;
  sku?: string;
  qty?: number;
  minPrice: number;
  requestedPrice: number;
  /** Set when this line already had an approval and has been cut again. */
  previouslyApprovedAt?: number;
}

/**
 * The lines that put the quotation below its floor, which is what locks it
 * from being sent.
 *
 * A LINE WITH NO MINIMUM IS NOT A LINE BELOW ITS MINIMUM. Items typed in
 * by hand, services, and anything from before the price book existed have
 * no floor to be under, and treating a missing minimum as zero would lock
 * every such quotation for an approval nobody can grant.
 *
 * AN APPROVED PRICE IS A CEILING ON THE NEXT CUT. Once an Admin has
 * approved ₹1,080, that price stands; ₹1,070 is a fresh request, and it is
 * reported with previouslyApprovedAt so the Admin can see they are being
 * asked twice.
 */
export function linesNeedingApproval(lines: readonly QuoteLineForApproval[]): ApprovalNeed[] {
  const out: ApprovalNeed[] = [];
  for (const line of lines) {
    const min = line.minPrice;
    if (min == null || !(Number(min) > 0)) continue;

    const approved = line.approvedPrice;
    if (approved != null && Number(approved) > 0) {
      /* Already approved. Only a cut BELOW what was approved needs asking
         again — holding the approved price, or going back up, does not. */
      if (isBelowMinimum(line.unitPrice, Number(approved))) {
        out.push({
          lineId: line.lineId, sku: line.sku, qty: line.qty,
          minPrice: round2(Number(min)), requestedPrice: round2(line.unitPrice),
          previouslyApprovedAt: round2(Number(approved)),
        });
      }
      continue;
    }

    if (isBelowMinimum(line.unitPrice, Number(min))) {
      out.push({
        lineId: line.lineId, sku: line.sku, qty: line.qty,
        minPrice: round2(Number(min)), requestedPrice: round2(line.unitPrice),
      });
    }
  }
  return out;
}

/* ── which month's prices a quotation was built on ───────────────────── */

/** 'YYYY-MM', the shape price_lists periods are rendered in. */
export function periodOf(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/**
 * The last day of a price list's month, as 'YYYY-MM-DD'.
 *
 * Built from the string rather than from a Date, and compared as a string
 * everywhere below. A quotation on November's list expires on 30 November
 * in Delhi, and a Date would have it expire at half past five in the
 * morning of the 30th — midnight UTC — for anybody whose browser is
 * honest about the timezone.
 */
export function periodEnd(period: string): string {
  const [y, m] = String(period).split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return "";
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${periodOf(y, m)}-${String(last).padStart(2, "0")}`;
}

/**
 * When a quotation's prices stop being quotable: the end of the month of
 * the list it was built on, unless an Admin set a date of their own.
 *
 * A custom date WINS EVEN WHEN IT IS LATER. That is the Admin's call to
 * make — they are the one who can see what the next list did.
 */
export function quoteExpiry(pricePeriod: string | null | undefined, customValidUntil?: string | null): string {
  const custom = (customValidUntil ?? "").trim();
  if (custom) return custom;
  return pricePeriod ? periodEnd(pricePeriod) : "";
}

/** Expired on the day being asked about. No expiry date never expires. */
export function isQuoteExpired(expiry: string | null | undefined, today: string): boolean {
  const on = (expiry ?? "").trim();
  return !!on && on < today;
}

/* WHAT CHANGED SINCE LAST MONTH IS NOT IN THIS FILE, and that is on
   purpose. The comparison needs last month's reseller prices, and this file
   runs in the browser. It lives in price_list_changes() in migration 056,
   behind is_privileged_in, and the upload endpoint asks for it and sends
   the answer down already compared. A copy here would be an invitation to
   wire up a client-side comparison, which means shipping the cost to do
   it. */
