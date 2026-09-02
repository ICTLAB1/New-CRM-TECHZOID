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

  /* THE ADMINISTRATOR COMING BACK from Microsoft's /adminconsent screen.
     That endpoint returns admin_consent=True and a tenant id rather than an
     authorization code, so without this the admin would land on "the
     response from Microsoft was incomplete" immediately after doing the one
     thing everybody had been asking them to do. */
  if (params.admin_consent !== undefined) {
    const granted = String(params.admin_consent).toLowerCase() === "true";
    return granted
      ? page(200, "Approved for the whole organisation",
          "Microsoft has recorded your approval. Everyone here can now connect their own mailbox "
          + "from Settings \u2192 Integrations without being stopped \u2014 including anybody who hit "
          + "\u201cNeed admin approval\u201d before. You do not need to do this again unless the "
          + "permissions the CRM asks for change.", true)
      : page(200, "Not approved",
          "Nothing was changed. Colleagues will keep seeing \u201cNeed admin approval\u201d when they "
          + "try to connect a mailbox, and quotation email from their own address will not work "
          + "until this is granted.", false);
  }

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
        + "Your organisation only allows apps from Microsoft-verified publishers to be approved by "
        + "users themselves; this one is not verified, so Microsoft holds it until an administrator "
        + "says yes. "
        + "Ask an administrator to open Settings \u2192 Integrations in this CRM and use "
        + "\u201cApprove for the whole organisation\u201d \u2014 one screen, one click, and it covers "
        + "everybody here permanently. "
        + "Hunting for the app under Entra \u2192 App registrations is the thing to avoid: it will not "
        + "be listed there unless it was registered in this tenant, which is why it can look as "
        + "though the app does not exist.",
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
