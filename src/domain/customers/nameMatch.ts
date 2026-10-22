/**
 * Comparing two company names that are meant to be the same company.
 *
 * "ACME Infotech Pvt Ltd" and "ACME Infotech Private Limited" are one
 * customer. Treating them as two is how a second quotation to a company you
 * already deal with files a second customer record, and the payment history
 * ends up split down the middle.
 *
 * This existed already, inside src/data/paymentTracker.ts, where it matched
 * a scanned invoice to a customer. It is here now because the quotation
 * reader needs exactly the same judgement, and two copies of a rule like
 * this drift: one learns about "LLP", the other does not, and which spelling
 * finds your customer then depends on which screen you are standing on.
 */

/** Legal forms and prefixes that carry no identity. */
const NOISE = /\b(pvt|private|ltd|limited|llp|inc|incorporated|corp|corporation|co|company|the|m\/s)\b/g;

/**
 * A company name reduced to what identifies it.
 *
 * Falls back to the plain alphanumeric form when stripping leaves nothing —
 * a company actually called "The Company" is not improved by becoming "".
 */
export function squashCompanyName(value: unknown): string {
  const lower = String(value ?? "").toLowerCase();
  const squashed = lower.replace(NOISE, "").replace(/[^a-z0-9]/g, "");
  return squashed || lower.replace(/[^a-z0-9]/g, "");
}

/** True when two names are the same company, allowing for legal forms. */
export function sameCompany(a: unknown, b: unknown): boolean {
  const left = squashCompanyName(a);
  const right = squashCompanyName(b);
  return left.length > 0 && left === right;
}
