/**
 * Legacy-record normalisation.
 *
 * The live database holds documents written before `currency`, `taxType`,
 * `billCountry`, `paymentHistory` and `lostReason` existed. Every screen must
 * survive them. The rule is: normalise once, on load — never test for a
 * field's existence at the point of use, and never assume it is there.
 *
 * Defaults reproduce what v1 fell back to inline at each call site:
 *   currency   -> "INR"
 *   taxType    -> "gst"
 *   billCountry-> "India"
 */
import type { LineItem } from "../domain/tax/types";
import type { ObjType } from "../domain/documents/objType";

export interface NormalizedDocFields {
  currency: string;
  taxType: string;
  billCountry: string;
  paymentHistory: unknown[];
  items: LineItem[];
}

/**
 * @param objType What this record is, taken from the table it was read out
 *   of. Every document written before the type was carried on the record has
 *   no idea what it is, and the only thing that does know is the collection
 *   it arrived in — so this is the one place that can fill it in. A record
 *   that already carries a type keeps it; the argument never overrides.
 */
export function normalizeDocument<T extends Record<string, unknown>>(
  doc: T,
  objType?: ObjType,
): Omit<T, keyof NormalizedDocFields> & NormalizedDocFields & { objType?: ObjType } {
  return {
    ...doc,
    currency: (doc["currency"] as string) || "INR",
    taxType: (doc["taxType"] as string) || "gst",
    billCountry: (doc["billCountry"] as string) || "India",
    paymentHistory: Array.isArray(doc["paymentHistory"]) ? (doc["paymentHistory"] as unknown[]) : [],
    items: Array.isArray(doc["items"]) ? (doc["items"] as LineItem[]) : [],
    objType: (doc["objType"] as ObjType | undefined) ?? objType,
  };
}

type NormalizedCustomerFields = { currency: string; taxType: string; country: string };

export function normalizeCustomer<T extends Record<string, unknown>>(
  c: T,
): Omit<T, keyof NormalizedCustomerFields> & NormalizedCustomerFields {
  return {
    ...c,
    currency: (c["currency"] as string) || "INR",
    taxType: (c["taxType"] as string) || "gst",
    country: (c["country"] as string) || "India",
  };
}
