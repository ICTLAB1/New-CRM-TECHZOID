import { getSupabase, isSupabaseConfigured } from "./supabase";

/**
 * The customer ID a person reads: CUST-000124.
 *
 * ALLOCATED BY THE DATABASE, in `public.next_customer_code()`. Customers
 * arrive from two places that never see each other — a salesperson pressing
 * "New customer", and the public registration form, which runs on a server
 * with nobody watching. Two readers of one counter, each doing read-then-
 * write, hand out the same number twice; and a duplicate created by a form
 * submission at 2am is one nobody will ever catch. A single
 * `update … returning` in Postgres makes the two callers queue instead.
 *
 * The number is taken when a record is SAVED, never when a blank form is
 * opened, so cancelling out of "New customer" does not burn one.
 */

/** The format, for the preview only — the live one lives in SQL so there is
 *  exactly one of it anywhere a real customer is created. */
export const previewCustomerCode = (seq: number, prefix = "CUST-"): string =>
  `${prefix}${String(Math.max(1, seq)).padStart(6, "0")}`;

/**
 * @param previewSeq what to number by when there is no database — the
 * preview has no counter to advance, so it counts what is on screen.
 * @returns the code, or "" when one could not be allocated. Deliberately
 * not an error: a numbering hiccup must never be the reason somebody loses
 * a customer they have just typed in. The field stays editable.
 */
export async function nextCustomerCode(previewSeq: number, prefix = "CUST-"): Promise<string> {
  if (!isSupabaseConfigured()) return previewCustomerCode(previewSeq, prefix);
  try {
    const { data, error } = await getSupabase().rpc("next_customer_code");
    if (error || !data) return "";
    return String(data);
  } catch {
    return "";
  }
}
