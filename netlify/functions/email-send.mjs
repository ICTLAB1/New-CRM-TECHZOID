import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { checkAttachment, emailList, isEmail, str } from "../lib/validate.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { sendMail } from "../lib/mailer.mjs";

/**
 * Send a quotation, proforma or reminder, on behalf of a signed-in person.
 *
 * This function is the DOOR: it decides whether the caller may send at all —
 * signed in, within their rate limit, with a recipient and a body that pass
 * validation — and then hands the message to ../lib/mailer.mjs, which is the
 * only place that knows how to actually send one.
 *
 * The split is not tidiness. Automatic follow-ups go out from a scheduler
 * with no signed-in user and no HTTP request to answer, and they must render
 * through the same transports as the quotation they chase. One mailer, two
 * doors.
 */

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid JSON.");

  const to = str(body.to, 320);
  const subject = str(body.subject, 300);
  const message = String(body.message ?? "");
  /* The designed version, when the client built one. Larger cap than the
     text: the markup and an inlined logo are most of its weight. */
  const html = String(body.html ?? "").slice(0, 400_000) || null;

  if (!to || !subject || !message) {
    return fail(event, 400, "A recipient, a subject and a message are all required.");
  }
  if (!isEmail(to)) {
    return fail(event, 400, `"${to}" doesn't look like an email address.`);
  }
  if (message.length > 100_000) {
    return fail(event, 400, "That message is too long to send.");
  }

  const { list: cc, invalid } = emailList(body.cc);
  if (invalid) return fail(event, 400, `"${invalid}" in the CC list isn't a valid email address.`);

  /* Validated rather than passed through: an unchecked Reply-To is a way to
     have the company's own mailbox invite replies to somewhere else. */
  const replyTo = str(body.replyTo, 320);
  if (replyTo && !isEmail(replyTo)) {
    return fail(event, 400, `"${replyTo}" isn't a valid reply-to address.`);
  }

  const att = checkAttachment(body.attachmentBase64, body.attachmentName);
  if (!att.ok) return fail(event, 400, att.error);

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "Email isn't configured on the server yet.", err?.message);
  }

  const rl = await consume(admin, "email-send", user.id);
  if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));

  const result = await sendMail({
    admin, userId: user.id, to, cc, subject, message, html, replyTo, attachment: att.attachment,
  });

  if (result.ok) return json(event, 200, { success: true, via: result.via, from: result.from });
  /* A transport that never handed the message over is a 502 — the caller may
     try again. Anything else is a refusal, and retrying sends it twice. */
  return fail(event, result.retryable ? 502 : 400, result.error);
}

