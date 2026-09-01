import { fail, guard, json, clientIp } from "../lib/http.mjs";
import { signedInUser, adminClient } from "../lib/auth.mjs";
import { signState } from "../lib/state.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";

/* Scopes each user grants:
     Mail.Send       send mail as themselves
     Mail.Read       read their own mailbox, to notice a prospect's REPLY
     offline_access  a refresh token, so the CRM can send later
     User.Read       their name and address, to show "Connected as …"

   MAIL.READ WAS ADDED FOR ONE PURPOSE and it is worth being precise about
   it, because it is the permission a customer's IT department will ask
   about. An outreach sequence that keeps chasing somebody who already
   replied is the single most damaging thing this module could do, and the
   only way to know a reply arrived is to look. It is DELEGATED and
   read-only: the CRM sees the signed-in person's own mailbox, never anyone
   else's, and never the tenant's.

   Adding it widens the consent screen, so EVERY ALREADY-CONNECTED MAILBOX
   MUST RECONNECT ONCE. An old refresh token does not silently gain a scope
   — it keeps working for sending and simply cannot read, so the failure is
   quiet unless the UI says so. It does. */
const SCOPES = "openid profile offline_access User.Read Mail.Send Mail.Read";

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const clientId = process.env.MS_CLIENT_ID;
  const tenant = process.env.MS_TENANT_ID || "common";
  const redirectUri = process.env.MS_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return fail(event, 400,
      "Microsoft 365 isn't set up yet. An admin needs to add MS_CLIENT_ID, MS_CLIENT_SECRET and MS_REDIRECT_URI in the Netlify environment variables — Settings → Integrations has the steps.");
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

  let state;
  try {
    state = signState(user.id, process.env);
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
    + "&scope=" + encodeURIComponent(SCOPES)
    + "&state=" + state
    + "&prompt=select_account";

  console.log("oauth start for", user.id, "from", clientIp(event));
  return json(event, 200, { url });
}
