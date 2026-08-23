/** The auto-extracted v1 reference implementation is plain JavaScript, used
 *  only by parity tests. Typed loosely on purpose — it is frozen legacy code,
 *  not part of the app. */
declare module "*v1-reference.mjs" {
  export const CURRENCIES: ReadonlyArray<readonly [string, string, string, number?]>;
  export function getCurrency(code: string): { code: string; symbol: string; name: string; decimals: number };
  export function fmtCurrency(amount: unknown, code: string): string;
  export function fmtCurrencyPdf(amount: unknown, code: string): string;
  export function fmtMoneyCellPdf(amount: unknown, code: string): string;
  export function validateGSTIN(raw: string): Record<string, unknown>;
  export function amountInWords(amount: unknown): string;
  export function amountInWordsForCurrency(amount: unknown, code: string): string;
  export function buildDocNumber(prefix: string, seq: number): string;
  export function computeQuote(quote: unknown, sellerState: string): Record<string, unknown>;
  export const PDF_UNSAFE_CURRENCY_CODES: ReadonlySet<string>;
}
