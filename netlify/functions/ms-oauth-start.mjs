import { fail, guard, json, clientIp } from "../lib/http.mjs";
import { signedInUser, adminClient } from "../lib/auth.mjs";
import { signState } from "../lib/state.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";

/* Scopes each user grants:
     Mail.Send       send mail as themselves
     offline_access  a refresh token, so the CRM can send later
     User.Read       their name and address, to show "Connected as …"

   Deliberately NOT Mail.Read or Mail.ReadWrite. The CRM sends; it has no
   business reading anyone's inbox, and asking for it would be a much harder
   consent screen to justify to a customer's IT department. */
const SCOPES = "openid profile offline_access User.Read Mail.Send";

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
