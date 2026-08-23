import { getCurrency } from "../currency/currencies";

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
] as const;
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"] as const;

function twoDigit(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  return (TENS[Math.floor(n / 10)] ?? "") + (n % 10 ? " " + ONES[n % 10] : "");
}

function threeDigit(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return (h ? ONES[h] + " Hundred" + (r ? " " : "") : "") + (r ? twoDigit(r) : "");
}

/**
 * Split an amount into whole units and minor units.
 *
 * DEVIATION FROM v1 (deliberate, verified by parity tests): when the minor
 * part rounds up to a full unit — 99.995 → 99 rupees + 100 paise — v1 emitted
 * `ONES[100]`, which is undefined, printing the literal string
 * "Ninety Nine Rupees and undefined Paise Only" on the document. The carry is
 * applied here instead, so 99.995 reads "One Hundred Rupees Only".
 *
 * In practice every document total passes through round2() before reaching
 * this function, so a three-decimal amount should never arrive — but a
 * document that prints the word "undefined" to a customer is not a failure
 * mode worth preserving.
 */
function splitAmount(amount: unknown): { whole: number; minor: number } {
  const abs = Math.abs(Number(amount) || 0);
  let whole = Math.floor(abs);
  let minor = Math.round((abs - whole) * 100);
  if (minor >= 100) {
    whole += Math.floor(minor / 100);
    minor = minor % 100;
  }
  return { whole, minor };
}

/** Indian numbering system — Lakh / Crore. Used for INR only. */
export function amountInWords(amount: unknown): string {
  const { whole: num, minor: paise } = splitAmount(amount);
  if (num === 0 && paise === 0) return "Zero Rupees Only";

  const parts: string[] = [];
  const crore = Math.floor(num / 1e7);
  const lakh = Math.floor((num % 1e7) / 1e5);
  const thousand = Math.floor((num % 1e5) / 1e3);
  const rest = num % 1e3;
  if (crore) parts.push(threeDigit(crore) + " Crore");
  if (lakh) parts.push(threeDigit(lakh) + " Lakh");
  if (thousand) parts.push(threeDigit(thousand) + " Thousand");
  if (rest) parts.push(threeDigit(rest));

  let out = parts.join(" ").trim();
  out = out ? out + " Rupees" : "";
  if (paise) out += (out ? " and " : "") + twoDigit(paise) + " Paise";
  return out + " Only";
}

/** Western short scale — Thousand / Million / Billion. The Lakh/Crore scale
 *  reads oddly for USD/EUR/AED, so every non-INR currency uses this. */
export function amountInWordsWestern(amount: unknown, currencyName: string, minorName: string): string {
  const { whole: num, minor: cents } = splitAmount(amount);
  if (num === 0 && cents === 0) return "Zero " + currencyName + " Only";

  const parts: string[] = [];
  const billion = Math.floor(num / 1e9);
  const million = Math.floor((num % 1e9) / 1e6);
  const thousand = Math.floor((num % 1e6) / 1e3);
  const rest = num % 1e3;
  if (billion) parts.push(threeDigit(billion) + " Billion");
  if (million) parts.push(threeDigit(million) + " Million");
  if (thousand) parts.push(threeDigit(thousand) + " Thousand");
  if (rest) parts.push(threeDigit(rest));

  let out = parts.join(" ").trim();
  out = out ? out + " " + currencyName : "";
  if (cents) out += (out ? " and " : "") + twoDigit(cents) + " " + (minorName || "Cents");
  return (out || "Zero " + currencyName) + " Only";
}

/** Every document's "amount in words" line goes through this, never through
 *  amountInWords() directly — that one is INR-only. */
export function amountInWordsForCurrency(amount: unknown, currencyCode: string | null | undefined): string {
  if (!currencyCode || currencyCode === "INR") return amountInWords(amount);
  const cur = getCurrency(currencyCode);
  if (cur.decimals === 0) return amountInWordsWestern(amount, cur.name, "");
  return amountInWordsWestern(amount, cur.name, "Cents");
}
