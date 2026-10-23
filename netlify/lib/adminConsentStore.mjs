/**
 * Whether a Microsoft administrator has approved this CRM for the tenant,
 * and for which permissions.
 *
 * WHY THIS EXISTS. The approval worked and left no trace. An admin clicked
 * "Approve for the whole organisation", got Microsoft's confirmation page,
 * came back — and the panel looked exactly as it had before, because it was
 * a button with no state behind it. So they clicked it again. And again. A
 * one-time setup that cannot say it is done is not a one-time setup.
 *
 * WHY THE SCOPES ARE KEPT, not just a date. Consent is granted for a
 * specific set of permissions. Add one to the app and every existing grant
 * stops covering what is asked for, and the whole organisation walks back
 * into "Need admin approval" — which is how this was first seen. A date
 * alone would then say "approved" while nobody could connect. Recording the
 * set lets the panel say the truer thing: approved, for these, and the app
 * now asks for more.
 */

const KEY = "msAdminConsent";

/** Normalised for comparison: order and duplicates are not differences. */
const canon = (scopes) =>
  [...new Set((scopes ?? []).map((s) => String(s).trim()).filter(Boolean))].sort();

export async function readConsent(admin) {
  const { data } = await admin.from("settings").select("data").eq("id", "main").maybeSingle();
  const row = data?.data?.[KEY];
  if (!row?.grantedAt) return null;
  return {
    grantedAt: String(row.grantedAt),
    scopes: canon(row.scopes),
    byUserId: row.byUserId ? String(row.byUserId) : null,
  };
}

export async function recordConsent(admin, { scopes, byUserId }) {
  const { data } = await admin.from("settings").select("data").eq("id", "main").maybeSingle();
  const all = data?.data ?? {};
  const next = {
    ...all,
    [KEY]: { grantedAt: new Date().toISOString(), scopes: canon(scopes), byUserId: byUserId ?? null },
  };
  const { error } = await admin
    .from("settings")
    .update({ data: next, updated_at: new Date().toISOString() })
    .eq("id", "main");
  if (error) {
    /* Never fails the admin's flow. They did approve; Microsoft has recorded
       it; all that is lost is this CRM's note of it. */
    console.error("admin consent: could not record —", error.message);
    return false;
  }
  return true;
}

/**
 * Does a recorded grant still cover what the app asks for today?
 *
 * Only a MISSING scope matters. A grant covering more than is asked for is
 * fine — consent is not withdrawn by requesting less — and treating it as
 * stale would send an admin to re-approve something already approved.
 */
export function consentCovers(granted, asked) {
  const have = new Set(canon(granted));
  return canon(asked).every((s) => have.has(s));
}
