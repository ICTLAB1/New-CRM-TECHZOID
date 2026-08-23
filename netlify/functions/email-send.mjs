import { fail, guard, json, readJson, clientIp } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { checkAttachment, emailList, isEmail, str } from "../lib/validate.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";

/**
 * Send a quotation, proforma or reminder.
 *
 * Two transports, in order of preference:
 *
 *   1. The sender's OWN Microsoft 365 mailbox, when they have connected one.
 *      The customer sees it from the actual salesperson, replies go straight
 *      back to them, and a copy lands in that person's Sent Items.
 *   2. The shared Resend sender, when no mailbox is linked.
 *
 * Swapping provider means changing the URL, auth header and body in
 * `sendViaResend` and nothing else.
 */

const SCOPES = "openid profile offline_access User.Read Mail.Send";

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

  /* ── the sender's own mailbox, if connected ── */
  let mailbox = null;
  try {
    const { data } = await admin.from("ms_mail_accounts").select("*").eq("user_id", user.id).maybeSingle();
    mailbox = data ?? null;
  } catch (err) {
    console.warn("mailbox lookup failed, falling back:", err?.message ?? err);
  }

  if (mailbox?.refresh_token && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET) {
    return sendViaMicrosoft(event, { admin, user, mailbox, to, cc, subject, message, attachment: att.attachment });
  }
  return sendViaResend(event, { to, cc, subject, message, attachment: att.attachment, ip: clientIp(event) });
}

async function sendViaMicrosoft(event, { admin, user, mailbox, to, cc, subject, message, attachment }) {
  const tenant = process.env.MS_TENANT_ID || "common";
  try {
    const tokenResp = await fetch("https://login.microsoftonline.com/" + encodeURIComponent(tenant) + "/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        refresh_token: mailbox.refresh_token,
        grant_type: "refresh_token",
        scope: SCOPES,
      }).toString(),
    });
    const tok = await tokenResp.json().catch(() => ({}));

    if (!tokenResp.ok || !tok.access_token) {
      console.error("ms refresh failed:", tokenResp.status, tok?.error);
      return fail(event, 400, "Your Microsoft 365 connection has expired. Reconnect it in Settings → Integrations.");
    }

    /* Microsoft ROTATES refresh tokens. Store the new one or the next send
       fails with an expired-token error that looks like a broken setup. */
    if (tok.refresh_token && tok.refresh_token !== mailbox.refresh_token) {
      const { error } = await admin.from("ms_mail_accounts")
        .update({ refresh_token: tok.refresh_token, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
      if (error) console.error("could not store rotated refresh token:", error.message);
    }

    const graphMessage = {
      subject,
      body: { contentType: "Text", content: message },
      toRecipients: [{ emailAddress: { address: to } }],
    };
    if (cc.length) graphMessage.ccRecipients = cc.map((a) => ({ emailAddress: { address: a } }));
    if (attachment) {
      graphMessage.attachments = [{
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.name,
        contentType: "application/pdf",
        contentBytes: attachment.base64,
      }];
    }

    const sendResp = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok.access_token },
      body: JSON.stringify({ message: graphMessage, saveToSentItems: true }),
    });

    if (sendResp.status === 202 || sendResp.ok) {
      return json(event, 200, { success: true, via: "microsoft", from: mailbox.ms_email });
    }

    const errBody = await sendResp.json().catch(() => ({}));
    console.error("graph sendMail refused:", sendResp.status, errBody?.error?.code);
    return fail(event, 400, "Microsoft 365 refused to send that message. " +
      (errBody?.error?.message ? "It said: " + str(errBody.error.message, 300) : "Check the mailbox is still active."));
  } catch (err) {
    return fail(event, 502, "Could not reach Microsoft 365. Try again in a moment.", err?.message);
  }
}

async function sendViaResend(event, { to, cc, subject, message, attachment }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM || "sales@techzoidtechnologies.com";

  if (!apiKey) {
    return fail(event, 400,
      "Email isn't connected yet. Either connect your own Microsoft 365 mailbox in Settings → Integrations, or ask an admin to add RESEND_API_KEY in Netlify.");
  }

  try {
    const payload = {
      from: "TechZoid Technologies <" + fromAddress + ">",
      to: [to],
      subject,
      text: message,
    };
    if (cc.length) payload.cc = cc;
    if (attachment) payload.attachments = [{ filename: attachment.name, content: attachment.base64 }];

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify(payload),
    });
    const result = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("resend refused:", resp.status, result?.name);
      return fail(event, 400, "The email provider refused that message. " + str(result?.message ?? "", 300));
    }
    return json(event, 200, { success: true, via: "resend" });
  } catch (err) {
    return fail(event, 502, "Could not reach the email provider. Try again in a moment.", err?.message);
  }
}
