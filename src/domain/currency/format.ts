import { getCurrency } from "./currencies";

/**
 * Grouping locale for a currency.
 *
 * DEVIATION FROM v1 (deliberate): v1 grouped every currency western-style, so
 * an INR document read "2,173,877.50". Indian invoices group in lakhs and
 * crores — "21,73,877.50" — and the approved quotation design renders it that
 * way on every figure. INR gets en-IN; everything else keeps en-US, which is
 * correct for USD, AED, EUR and the rest.
 *
 * Recorded in docs/DEVIATIONS.md and pinned by test: this changes the face of
 * every INR document the company sends.
 */
export const groupingLocale = (code: string): string => (code === "INR" ? "en-IN" : "en-US");

/** On-screen money. Browsers have full Unicode font support, so the real
 *  symbol is used. Locale is en-US (v1 behaviour) — grouping is western
 *  even for INR here; the Indian-grouped helper below is separate. */
export function fmtCurrency(amount: unknown, currencyCode: string | null | undefined): string {
  const cur = getCurrency(currencyCode);
  const n = Number(amount) || 0;
  return (
    cur.symbol +
    n.toLocaleString(groupingLocale(cur.code), { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals })
  );
}

/* jsPDF's built-in fonts (Helvetica/Times/Courier) only support the
   WinAnsi/Latin-1 character set. Many currency symbols — and even a few
   Latin-alphabet symbols with diacritics (Kč, zł) or Cyrillic ones (лв,
   ден) — fall outside that range and render as corrupted glyph codes or
   get silently dropped by the text sanitizer.

   Every symbol whose Unicode code point exceeds U+00FF is listed here with
   a plain-ASCII fallback. Keyed by currency CODE, not symbol, since several
   currencies share an identical symbol (PKR and MUR both use ₨) and a
   code-keyed map avoids any ambiguity.

   Used only inside the native PDF generator; the on-screen preview keeps
   the real symbols. Guarded by a test that walks the whole CURRENCIES table
   and asserts every >U+00FF symbol is listed here. */
export const PDF_UNSAFE_CURRENCY_CODES: ReadonlySet<string> = new Set([
  "INR", "EUR", "THB", "PHP", "VND", "NGN", "GHS", "MUR", "PKR", "BDT", "AFN", "KHR",
  "LAK", "MNT", "KZT", "AZN", "GEL", "AMD", "RUB", "UAH", "TRY", "ILS", "CRC", "PYG",
  "PLN", "CZK", "BGN", "MKD", "KRW", "KPW",
]);

export const PDF_SYMBOL_OVERRIDE: Readonly<Record<string, string>> = { INR: "Rs. " };

/** Money for the PDF, outside the items table (totals, headers).
 *  Unsafe symbols degrade to "Rs. " for INR or "CODE " otherwise. */
export function fmtCurrencyPdf(amount: unknown, currencyCode: string | null | undefined): string {
  const cur = getCurrency(currencyCode);
  const n = Number(amount) || 0;
  const symbol = PDF_UNSAFE_CURRENCY_CODES.has(cur.code)
    ? PDF_SYMBOL_OVERRIDE[cur.code] || cur.code + " "
    : cur.symbol;
  return (
    symbol +
    n.toLocaleString(groupingLocale(cur.code), { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals })
  );
}

/** Money inside the items table, where every column header already names the
 *  currency ("Unit Price (INR)"). Repeating "Rs." in every cell is redundant
 *  and — at the widths a 13-column table allows — pushed large figures onto a
 *  second line mid-number ("Rs. 376,6 / 56.00"). Bare digits only; the header
 *  carries the unit. Do not add a prefix back. */
export function fmtMoneyCellPdf(amount: unknown, currencyCode: string | null | undefined): string {
  const cur = getCurrency(currencyCode);
  const n = Number(amount) || 0;
  return n.toLocaleString(groupingLocale(cur.code), {
    minimumFractionDigits: cur.decimals,
    maximumFractionDigits: cur.decimals,
  });
}

/* ── on-screen money, in the currency the record is actually in ────────
   THE BUG THESE EXIST FOR. Every screen formatted every figure as rupees,
   with a hard-coded ₹ and Indian grouping, whatever currency the record was
   in. A proforma raised in dollars rendered correctly on the PDF and read
   as "₹11,948" in the list beside it — the same number, the wrong currency,
   and no way to tell from the screen which one the customer will be billed.

   The document renderer has always done this properly, through
   fmtCurrency(). These are the same idea for the CRM's own tables and
   tiles, and the inr* helpers below are now thin wrappers so that rupee
   figures look exactly as they did. */

/** Full precision, for a detail view. */
export const money = (n: unknown, code: string | null | undefined): string => fmtCurrency(n, code);

/**
 * For a list or table column: no decimals.
 *
 * A column of forty figures all ending ".00" is forty repetitions of
 * nothing. Documents and detail views keep full precision; this is for
 * scanning.
 */
export function moneyList(n: unknown, code: string | null | undefined): string {
  const cur = getCurrency(code);
  return cur.symbol + Math.round(Number(n) || 0).toLocaleString(groupingLocale(cur.code));
}

/**
 * Compact, for a dashboard tile.
 *
 * THE SCALE WORDS ARE NOT UNIVERSAL, and that is the whole reason this
 * takes a currency. Crore and lakh are how Indian money is read and how the
 * rest of this CRM writes it; "$2.57 L" is not a smaller way of writing a
 * dollar figure, it is a phrase a reader in New York would have to decode.
 * Rupees keep Cr/L/K; everything else gets M/K.
 */
export function moneyShort(n: unknown, code: string | null | undefined): string {
  const cur = getCurrency(code);
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const at = (divisor: number, suffix: string, dp: number) =>
    sign + cur.symbol + (abs / divisor).toFixed(dp) + suffix;

  if (cur.code === "INR") {
    if (abs >= 1e7) return at(1e7, " Cr", 2);
    if (abs >= 1e5) return at(1e5, " L", 2);
    if (abs >= 1e3) return at(1e3, " K", 1);
    return sign + cur.symbol + abs.toFixed(0);
  }
  if (abs >= 1e6) return at(1e6, "M", 2);
  if (abs >= 1e3) return at(1e3, "K", 1);
  return sign + cur.symbol + abs.toFixed(0);
}

/** Indian-grouped rupees, for on-screen CRM figures (not documents). */
export function inr(n: unknown): string {
  return "₹" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Rupees for a list or table column: Indian grouping, no decimals.
 *
 * A column of forty figures all ending ".00" is forty repetitions of nothing.
 * Documents and detail views keep full precision — this is for scanning.
 */
export function inrList(n: unknown): string {
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}

/** Compact Indian rupees for dashboard tiles: Cr / L / K. */
export function inrShort(n: unknown): string {
  const v = Number(n) || 0;
  if (v >= 1e7) return "₹" + (v / 1e7).toFixed(2) + " Cr";
  if (v >= 1e5) return "₹" + (v / 1e5).toFixed(2) + " L";
  if (v >= 1e3) return "₹" + (v / 1e3).toFixed(1) + " K";
  return "₹" + v.toFixed(0);
}


/* ── totals across records that are not all in one currency ────────────
   ₹100 + $100 is not 200 of anything. The CRM adds up documents, deals and
   outstanding balances all over the place, and every one of those sums was
   silently treating a dollar as a rupee — so a list of five INR proformas
   and one USD one showed a total that was wrong by whatever the dollar one
   came to, with nothing on screen to say so.

   No exchange rates here on purpose. Converting needs a rate source and a
   decision about WHICH rate — the day the document was raised, the day it
   was paid, today — and getting that wrong produces a number that looks
   authoritative and is not. Until somebody decides that, the honest thing
   is to keep the currencies apart and show them apart. */

export interface CurrencyTotal {
  code: string;
  total: number;
  count: number;
}

/**
 * Sum by currency, largest first. A record with no currency counts as the
 * fallback — almost always INR, which is what a legacy row is.
 */
export function totalsByCurrency<T>(
  items: readonly T[],
  amountOf: (item: T) => number,
  currencyOf: (item: T) => string | null | undefined,
  fallback = "INR",
): CurrencyTotal[] {
  const bins = new Map<string, CurrencyTotal>();
  for (const item of items) {
    const code = (currencyOf(item) || fallback).trim().toUpperCase() || fallback;
    const bin = bins.get(code) ?? { code, total: 0, count: 0 };
    bin.total += Number(amountOf(item)) || 0;
    bin.count += 1;
    bins.set(code, bin);
  }
  return [...bins.values()].sort((a, b) => b.total - a.total);
}

/** One line for a set of totals: "₹23,59,366 + $11,948". Empty for none. */
export function formatTotals(
  totals: readonly CurrencyTotal[],
  format: (n: number, code: string) => string = moneyList,
): string {
  return totals.map((t) => format(t.total, t.code)).join(" + ");
}

/** True when there is more than one currency in play — the case every
 *  single-figure total is wrong for. */
export const isMixed = (totals: readonly CurrencyTotal[]): boolean => totals.length > 1;
