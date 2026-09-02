import { fail, guard, json } from "../lib/http.mjs";
import { signedInProfile } from "../lib/auth.mjs";

/**
 * The link a Microsoft administrator opens once to approve this CRM for the
 * whole organisation.
 *
 * WHY A LINK RATHER THAN INSTRUCTIONS. The instructions were already there —
 * "Entra admin centre → App registrations → TechZoid CRM → API permissions →
 * Grant admin consent" — and they sent somebody to the wrong blade. An app
 * registered in one tenant and used from another does not appear under App
 * registrations in the second one; it appears under Enterprise applications,
 * and only after somebody has tried to consent. So the admin went looking,
 * found nothing named TechZoid CRM, and reasonably concluded the app did not
 * exist. Meanwhile every colleague kept hitting "Need admin approval".
 *
 * This endpoint sidesteps the whole navigation problem. Microsoft's
 * /adminconsent endpoint takes the client id and grants for the entire
 * tenant in one screen, and it works whichever tenant the registration lives
 * in. One click, once, for everybody.
 *
 * WHY IT IS ADMIN-ONLY HERE. Not because the URL is a secret — it contains a
 * client id and nothing else, and it is useless to anybody who is not a
 * Microsoft administrator, since Microsoft does its own authorisation on the
 * other end. It is gated because handing a "grant this application access to
 * your organisation" link to every user is how somebody gets talked into
 * clicking one, and a CRM should not be in the business of teaching that
 * habit.
 *
 * WHAT THE ADMIN IS APPROVING. The same three delegated scopes a single user
 * would approve for themselves: send mail as themselves, read their own name
 * and address, and stay signed in. Nothing tenant-wide, nothing that reads
 * anybody else's mailbox. The consent screen says so; this says so too, so
 * the two agree.
 */

/** Kept identical to ms-oauth-start.mjs on purpose. Consent granted for a
 *  different set than the one later requested sends everybody back to the
 *  approval screen, which is the failure this whole endpoint exists to end. */
const SCOPES = "openid profile offline_access User.Read Mail.Send";

export async function handler(event) {
  const stop = guard(event, "GET", "GET, OPTIONS");
  if (stop) return stop;

  const caller = await signedInProfile(event);
  if (!caller?.user) return fail(event, 403, "Sign in required.", null, "GET, OPTIONS");
  if (caller.role !== "Admin") {
    return fail(event, 403, "Only an admin can request this link.", null, "GET, OPTIONS");
  }

  const clientId = process.env.MS_CLIENT_ID;
  const redirectUri = process.env.MS_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return fail(event, 400,
      "Microsoft 365 is not configured on the server yet — MS_CLIENT_ID and MS_REDIRECT_URI have to be set in Netlify first.",
      null, "GET, OPTIONS");
  }

  /* `organizations` rather than `common`: admin consent is a thing a work
     tenant grants, and `common` would offer a personal Microsoft account the
     chance to try and fail confusingly. An explicit MS_TENANT_ID wins, since
     a single-tenant app must use its own. */
  const tenant = process.env.MS_TENANT_ID || "organizations";

  const url = "https://login.microsoftonline.com/" + encodeURIComponent(tenant) + "/v2.0/adminconsent"
    + "?client_id=" + encodeURIComponent(clientId)
    + "&scope=" + encodeURIComponent(SCOPES)
    + "&redirect_uri=" + encodeURIComponent(redirectUri);

  return json(event, 200, { url, scopes: SCOPES.split(" ") }, "GET, OPTIONS");
}
