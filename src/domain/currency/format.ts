import { getCurrency } from "./currencies";

/** On-screen money. Browsers have full Unicode font support, so the real
 *  symbol is used. Locale is en-US (v1 behaviour) — grouping is western
 *  even for INR here; the Indian-grouped helper below is separate. */
export function fmtCurrency(amount: unknown, currencyCode: string | null | undefined): string {
  const cur = getCurrency(currencyCode);
  const n = Number(amount) || 0;
  return (
    cur.symbol +
    n.toLocaleString("en-US", { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals })
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
    n.toLocaleString("en-US", { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals })
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
  return n.toLocaleString("en-US", {
    minimumFractionDigits: cur.decimals,
    maximumFractionDigits: cur.decimals,
  });
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
