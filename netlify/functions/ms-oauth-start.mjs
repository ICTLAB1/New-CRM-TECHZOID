import { fail, guard, json, clientIp, readJson } from "../lib/http.mjs";
import { signedInUser, adminClient } from "../lib/auth.mjs";
import { PURPOSES, signState } from "../lib/state.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";

/* Scopes each user grants:
     Mail.Send       send mail as themselves
     offline_access  a refresh token, so the CRM can send later
     User.Read       their name and address, to show "Connected as …"

   MAIL.READ IS NOT ASKED FOR, and was removed after being added too early.
   It is wanted eventually — an outreach sequence that keeps chasing somebody
   who already replied is the worst thing this module could do, and the only
   way to know a reply arrived is to look — but reply detection does not
   exist yet, so today it would be a permission requested and never used.

   Asking for it early was not free. Every scope on the consent screen is one
   an IT department has to approve, and in a tenant that restricts consent to
   verified publishers — the default for tenants created since 2020 — any
   change to the scope list sends every user back to "Need admin approval",
   including users an administrator had already approved. That is what
   happened here: consent was granted, Mail.Read was added, and the next
   colleague to connect was stopped again.

   When reply detection is built it should ask for Mail.Read AT THAT POINT,
   incrementally, from the person turning it on — which is how a permission
   should be explained anyway: at the moment somebody chooses the feature
   that needs it. READ_SCOPES in ../lib/mailer.mjs is already written for
   exactly that. */
export const SCOPES = "openid profile offline_access User.Read Mail.Send";

/* THE MAILBOX GRANT, separate from the quotation one all the way down.
   ReadWrite because a mail client writes: drafts are saved, messages are
   moved and deleted. Mail.Send because a draft is sent through the message
   that holds it, not through /me/sendMail.
   
   It overlaps with SCOPES above and that is fine — they are different
   consents producing different tokens in different columns. What must never
   happen is ONE token covering both, because then losing the mailbox grant
   takes quotations down with it. See mailer.mjs. */
export const INBOX_SCOPES = "openid profile offline_access User.Read Mail.ReadWrite Mail.Send";

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const clientId = process.env.MS_CLIENT_ID;
  const tenant = process.env.MS_TENANT_ID || "common";
  const redirectUri = process.env.MS_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return fail(event, 400,
      "Microsoft 365 isn't set up yet. An admin needs to add MS_CLIENT_ID, MS_CLIENT_SECRET and MS_REDIRECT_URI in the Azure Function App settings — Settings → Integrations has the steps.");
  }

  /* Only a signed-in CRM user may start a connection, and the mailbox that
     results is bound to that user id and no other. */
  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  try {
    const rl = await consume(adminClient(), "ms-oauth-start", user.id);
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));
  } catch (err) {
    console.error("rate limit unavailable:", err?.message ?? err);
  }

  /* `own` unless a shared mailbox was asked for. Anything unrecognised is a
     caller error rather than a silent fall back to `own`: connecting the
     wrong kind of mailbox is not something to guess at. */
  const asked = String(readJson(event)?.purpose ?? "own");
  if (!PURPOSES.has(asked)) return fail(event, 400, "That request wasn't valid.");

  let state;
  try {
    state = signState(user.id, process.env, Date.now(), asked);
  } catch (err) {
    return fail(event, 500,
      "Microsoft 365 isn't fully configured on the server. An admin should check MS_STATE_SECRET.",
      err?.message);
  }

  const url = "https://login.microsoftonline.com/" + encodeURIComponent(tenant) + "/oauth2/v2.0/authorize"
    + "?client_id=" + encodeURIComponent(clientId)
    + "&response_type=code"
    + "&redirect_uri=" + encodeURIComponent(redirectUri)
    + "&response_mode=query"
    + "&scope=" + encodeURIComponent(asked === "inbox" ? INBOX_SCOPES : SCOPES)
    + "&state=" + state
    /* `login` for a shared mailbox, not `select_account`: they are signed in
       to Microsoft as themselves, and select_account would happily hand back
       their own account on one click — connecting abhinav's mailbox as the
       company's accounts@ address. Forcing a fresh sign-in makes the choice
       deliberate, which it has to be. */
    + "&prompt=" + (asked === "shared" ? "login" : "select_account");

  console.log("oauth start for", user.id, `(${asked})`, "from", clientIp(event));
  return json(event, 200, { url });
}
