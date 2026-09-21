/**
 * Which company a record written by the server belongs to.
 *
 * THE BUG THIS EXISTS TO FIX, which reached a customer. Migration 033 made
 * company_id NOT NULL with a default of default_company_id(), and that
 * function answers "the company of whoever is signed in". Every one of these
 * endpoints runs as the service role with nobody signed in, so the default
 * evaluated to null and the insert was refused. A customer filling in the
 * registration form got "Something went wrong submitting your details" and
 * their enquiry was lost. The website sync and the IndiaMART poller were
 * broken the same way and would have failed just as quietly.
 *
 * The lesson is not subtle: a default that depends on a session is no
 * default at all for code that has no session.
 *
 * HOW THE COMPANY IS DECIDED, in order:
 *
 *   1. The company whose settings nominate this person to receive inbound
 *      records. That setting is per company, so naming somebody there is a
 *      statement about which business their leads belong to.
 *   2. The company they belong to — their oldest membership, when there is
 *      no such nomination.
 *   3. The oldest company, if the owner belongs to none. Somewhere is better
 *      than nowhere: a misfiled lead is visible and can be moved, a rejected
 *      one is gone.
 */

export async function companyForOwner(admin, ownerId) {
  if (!ownerId) return await oldestCompany(admin);

  /* 1. Nominated for inbound records by a company's own settings. */
  try {
    const { data: rows } = await admin
      .from("settings")
      .select("company_id, data")
      .not("company_id", "is", null);
    const named = (rows ?? []).find(
      (r) => String((r.data ?? {}).webhook?.inboundOwnerId ?? "") === String(ownerId)
        || String((r.data ?? {}).indiamart?.ownerId ?? "") === String(ownerId),
    );
    if (named?.company_id) return String(named.company_id);
  } catch (err) {
    console.error("companyForOwner: could not read settings —", err?.message ?? err);
  }

  /* 2. Their own company. */
  try {
    const { data } = await admin
      .from("company_members")
      .select("company_id")
      .eq("user_id", ownerId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (data?.[0]?.company_id) return String(data[0].company_id);
  } catch (err) {
    console.error("companyForOwner: could not read membership —", err?.message ?? err);
  }

  /* 3. Anywhere rather than nowhere. */
  return await oldestCompany(admin);
}

async function oldestCompany(admin) {
  try {
    const { data } = await admin
      .from("companies")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1);
    return data?.[0]?.id ? String(data[0].id) : null;
  } catch (err) {
    /* A workspace that has not run migration 033 has no companies table at
       all. Returning null is right there: the column does not exist either,
       and the caller omits it. */
    return null;
  }
}

/** Add company_id to a row about to be written, when there is one to add. */
export const withCompany = (row, companyId) =>
  (companyId ? { ...row, company_id: companyId } : row);
