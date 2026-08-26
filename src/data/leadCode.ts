import { getSupabase, isSupabaseConfigured } from "./supabase";

/**
 * This user's short registration code.
 *
 * Minted by the database on first use — `public.my_lead_code()` — because
 * uniqueness cannot be decided by a browser that has no way to see the other
 * codes, and because a Sales user must not be able to write to a profile row
 * to claim one.
 *
 * Returns "" when there is nothing to ask, which is not a failure: the
 * caller falls back to the long ?lead=<uuid> form, and a working long link
 * beats a short one that 404s.
 */
export async function myLeadCode(): Promise<string> {
  if (!isSupabaseConfigured()) return "";
  try {
    const { data, error } = await getSupabase().rpc("my_lead_code");
    if (error || !data) return "";
    return String(data);
  } catch {
    return "";
  }
}
