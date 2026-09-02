import { htmlHeaders, resultPage } from "../lib/html.mjs";
import { adminClient } from "../lib/auth.mjs";
import { verifyState } from "../lib/state.mjs";

/**
 * Microsoft redirects the browser here after consent.
 *
 * THE PATH IS LOAD-BEARING: the deployed Azure app registration's redirect
 * URI points at /.netlify/functions/ms-oauth-callback. Renaming this file
 * breaks every existing connection until someone edits the app registration.
 *
 * It answers with HTML, so everything variable is escaped — see lib/html.mjs
 * for the injection v1 carried here.
 */

const page = (statusCode, title, message, ok) => ({
  statusCode,
  headers: htmlHeaders,
  body: resultPage(title, message, ok),
});

export async function handler(event) {
  const params = event.queryStringParameters || {};

  if (params.error) {
    /* Microsoft's own text, escaped. It is a query-string value and so is
       attacker-controlled. */
    const raw = String(params.error_description || params.error || "");

    /* THE ONE WORTH NAMING. "Need admin approval" is not a fault the person
       staring at it can fix, and Microsoft's wording ("needs permission to
       access resources in your organization") sends people to IT with no
       idea what to ask for. It happens whenever the app requests a scope
       beyond what the tenant has already consented to — adding one to this
       CRM invalidates the existing grant for EVERYBODY at once, which is
       exactly how this was first seen.
       AADSTS65001 is "no consent", AADSTS90094 is "admin consent
       required". */
    const needsAdmin = /AADSTS65001|AADSTS90094|consent_required|admin_consent_required/i.test(
      raw + " " + String(params.error || ""));

    if (needsAdmin) {
      return page(200, "Your Microsoft administrator has to approve this once",
        "This is not something you can fix from here, and nothing is wrong with your account. "
        + "The CRM is asking for a permission your organisation has not approved yet, so Microsoft "
        + "is holding it until an administrator says yes. "
        + "Ask whoever manages your Microsoft 365 tenant to open Entra admin centre → App "
        + "registrations → TechZoid CRM → API permissions, and press \u201cGrant admin consent\u201d. "
        + "It takes a moment and only needs doing once for the whole company \u2014 after that, "
        + "come back to Settings \u2192 Integrations and connect your mailbox again.",
        false);
    }

    return page(200, "Connection cancelled",
      "Microsoft reported: " + raw, false);
  }

  const { code, state } = params;
  if (!code || !state) {
    return page(400, "Something went wrong",
      "The response from Microsoft was incomplete. Please try connecting again from Settings → Integrations.", false);
  }

  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const tenant = process.env.MS_TENANT_ID || "common";
  const redirectUri = process.env.MS_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return page(500, "Not configured",
      "The Microsoft 365 environment variables are missing on the server. An admin can add them in Netlify.", false);
  }

  /* Verify the state signed in ms-oauth-start. Without this, anyone could
     call this endpoint with a hand-made state and attach their own mailbox
     to another person's CRM account — from then on that person's quotations
     would send from the attacker's address, and their customer
     correspondence would land in the attacker's Sent Items.

     Every failure gives the same message: which check failed is not the
     caller's business. */
  const verified = verifyState(state, process.env);
  if (!verified.ok) {
    console.warn("oauth state rejected:", verified.reason);
    return page(403, "That link is no longer valid",
      "Connection links expire after fifteen minutes. Please start again from Settings → Integrations.", false);
  }

  try {
    const tokenResp = await fetch("https://login.microsoftonline.com/" + encodeURIComponent(tenant) + "/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, code,
        redirect_uri: redirectUri, grant_type: "authorization_code",
      }).toString(),
    });
    const tok = await tokenResp.json().catch(() => ({}));

    if (!tokenResp.ok || !tok.refresh_token) {
      console.error("token exchange failed:", tokenResp.status, tok?.error);
      return page(400, "Couldn't connect",
        tok?.error_description
          || "Microsoft did not return a refresh token. Check that offline_access is included in the app registration's permissions.",
        false);
    }

    /* Who they actually signed in as, so Settings can show it. Non-fatal:
       the connection works regardless. */
    let msEmail = "";
    let msName = "";
    try {
      const me = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: "Bearer " + tok.access_token },
      }).then((r) => r.json());
      msEmail = me.mail || me.userPrincipalName || "";
      msName = me.displayName || "";
    } catch (err) {
      console.warn("graph /me lookup failed:", err?.message ?? err);
    }

    const { error } = await adminClient().from("ms_mail_accounts").upsert({
      user_id: verified.userId,
      ms_email: msEmail,
      ms_display_name: msName,
      refresh_token: tok.refresh_token,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error("saving mailbox failed:", error.message);
      return page(500, "Couldn't save the connection",
        "The mailbox authorised correctly but the CRM could not store it. Please try again, or ask an admin to check the server logs.", false);
    }

    console.log("mailbox connected for", verified.userId);
    return page(200, "Mailbox connected",
      "The CRM can now send quotations and reminders from " + (msEmail || "your Microsoft 365 account") + ".", true);
  } catch (err) {
    console.error("oauth callback failed:", err?.message ?? err);
    return page(500, "Something went wrong",
      "The connection could not be completed. Please try again from Settings → Integrations.", false);
  }
}
