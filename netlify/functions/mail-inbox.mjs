import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { getMessage, listMessages, readToken } from "../lib/mailbox.mjs";

/**
 * The CRM's view of one person's own mailbox.
 *
 * ALWAYS THEIR OWN. The user id comes from the verified token and is never
 * taken from the request — there is no parameter here that could name
 * somebody else's mailbox, which is the only reason this endpoint is safe to
 * expose at all.
 */

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event) ?? {};
  const admin = adminClient();

  try {
    const rl = await consume(admin, "mail-inbox", user.id);
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));
  } catch (err) {
    console.error("rate limit unavailable:", err?.message ?? err);
  }

  const access = await readToken(admin, user.id);
  if (!access.ok) {
    /* 409 rather than 403: nothing is forbidden, something is not set up
       yet, and the screen needs to tell those apart to know whether to
       offer the Connect button. */
    return fail(event, access.needsConsent ? 409 : 400, access.error);
  }

  if (body.id) {
    const one = await getMessage(access.token, String(body.id));
    if (!one.ok) return fail(event, 502, one.error);
    return json(event, 200, { message: one.message, mailbox: access.email });
  }

  const page = await listMessages(access.token, {
    folder: String(body.folder ?? "inbox"),
    top: body.top,
    skip: body.skip,
    search: String(body.search ?? "").slice(0, 120),
  });
  if (!page.ok) return fail(event, 502, page.error);
  return json(event, 200, { messages: page.messages, mailbox: access.email });
}
