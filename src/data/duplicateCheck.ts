import { getSupabase, isSupabaseConfigured } from "./supabase";
import type { DuplicateReason } from "../domain/customers/duplicates";

/**
 * Asking the database whether this customer already exists.
 *
 * WHY THIS IS NOT DONE IN THE BROWSER. The customers loaded in the app are
 * the ones RLS lets this person see. A Sales user checking for duplicates
 * against that list is checking against their own book only — so the case
 * that actually matters, two salespeople entering the same company a week
 * apart, is invisible to both. The first anybody learns of it is two
 * quotations at two prices.
 *
 * `find_duplicate_customer` is security-definer and returns three fields:
 * the company name as stored, so the speller can see it; who owns it, so
 * they know who to ask; and which signal matched. No contact details, no
 * id, no value, no notes. See supabase/017_duplicate_lookup.sql.
 */

export interface DuplicateHit {
  reason: DuplicateReason;
  company: string;
  ownerName: string;
}

/** Null for "no duplicate". Also null when there is nothing to ask — the
 *  preview has no database, and a check that cannot run must not be
 *  reported as a clean result. */
export async function checkDuplicate(fields: {
  company?: string;
  phone?: string;
  gstin?: string;
}): Promise<DuplicateHit | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await getSupabase().rpc("find_duplicate_customer", {
    p_company: fields.company ?? "",
    p_phone: fields.phone ?? "",
    p_gstin: fields.gstin ?? "",
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return {
    reason: (row.reason ?? "name") as DuplicateReason,
    company: String(row.company ?? ""),
    ownerName: String(row.owner_name ?? "another user"),
  };
}

/** Whether the check can run at all, so the UI can stay quiet rather than
 *  claiming a customer is new when nothing was asked. */
export const duplicateCheckAvailable = (): boolean => isSupabaseConfigured();
