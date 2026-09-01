/**
 * Sending one email, without caring who asked.
 *
 * Lifted out of email-send.mjs when automatic follow-ups arrived, because
 * the two callers are genuinely different: one is a person pressing Send and
 * wants an HTTP status back, the other is a scheduler at four in the morning
 * that wants to know whether to mark a row sent or failed. Both must use the
 * same transports — a follow-up that goes out through a second, slightly
 * different code path is a follow-up that renders differently from the
 * quotation it chases.
 *
 * Returns a plain result. Nothing here knows what an HTTP response is.
 */

/* MUST MATCH ms-oauth-start.mjs exactly. A refresh asking for fewer scopes
   than were granted quietly returns a token that can do less — which is how
   reply detection would break with nothing in any log to say why. */
const SCOPES = "openid profile offline_access User.Read Mail.Send Mail.Read";

/** @returns {{ok: true, via: "microsoft"|"resend", from?: string} | {ok: false, error: string, retryable?: boolean}} */
export async function sendMail({
  admin, userId, to, cc = [], subject, message, html = null, replyTo = "", attachment = null,
}) {
  /* The sender's OWN mailbox first, exactly as the interactive path chooses
     it: the customer sees the salesperson they have been dealing with, and a
     copy lands in that person's Sent Items — which is the only way a
     scheduled email is ever visible to the human it was sent on behalf of. */
  let mailbox = null;
  if (userId) {
    try {
      const { data } = await admin.from("ms_mail_accounts").select("*").eq("user_id", userId).maybeSingle();
      mailbox = data ?? null;
    } catch (err) {
      console.warn("mailbox lookup failed, falling back:", err?.message ?? err);
    }
  }

  if (mailbox?.refresh_token && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET) {
    return sendViaMicrosoft({ admin, userId, mailbox, to, cc, subject, message, html, replyTo, attachment });
  }
  return sendViaResend({ to, cc, subject, message, html, replyTo, attachment });
}

async function sendViaMicrosoft({ admin, userId, mailbox, to, cc, subject, message, html, replyTo, attachment }) {
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
      return { ok: false, error: "Your Microsoft 365 connection has expired. Reconnect it in Settings → Integrations." };
    }

    /* Microsoft ROTATES refresh tokens. Store the new one or the next send
       fails with an expired-token error that looks like a broken setup. */
    if (tok.refresh_token && tok.refresh_token !== mailbox.refresh_token) {
      const { error } = await admin.from("ms_mail_accounts")
        .update({ refresh_token: tok.refresh_token, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (error) console.error("could not store rotated refresh token:", error.message);
    }

    const graphMessage = {
      subject,
      /* Graph carries ONE body. With a designed version, that is the HTML —
         Outlook and Gmail both render it, and Graph generates the plain-text
         alternative itself. */
      body: html ? { contentType: "HTML", content: html } : { contentType: "Text", content: message },
      toRecipients: [{ emailAddress: { address: to } }],
    };
    if (cc.length) graphMessage.ccRecipients = cc.map((a) => ({ emailAddress: { address: a } }));
    /* Sending from their own mailbox already puts their address on it, so a
       Reply-To only earns its place when it points somewhere else. */
    if (replyTo && replyTo !== mailbox.ms_email) {
      graphMessage.replyTo = [{ emailAddress: { address: replyTo } }];
    }
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
      return { ok: true, via: "microsoft", from: mailbox.ms_email };
    }

    const errBody = await sendResp.json().catch(() => ({}));
    console.error("graph sendMail refused:", sendResp.status, errBody?.error?.code);
    return {
      ok: false,
      error: "Microsoft 365 refused to send that message. " +
        (errBody?.error?.message ? "It said: " + String(errBody.error.message).slice(0, 300) : "Check the mailbox is still active."),
    };
  } catch (err) {
    /* Retryable: the message was never handed over, so trying again later
       cannot deliver it twice. */
    return { ok: false, retryable: true, error: "Could not reach Microsoft 365. " + (err?.message ?? "") };
  }
}

async function sendViaResend({ to, cc, subject, message, html, replyTo, attachment }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM || "sales@techzoidtechnologies.com";

  if (!apiKey) {
    return {
      ok: false,
      error: "Email isn't connected yet. Either connect your own Microsoft 365 mailbox in Settings → Integrations, or ask an admin to add RESEND_API_KEY in Netlify.",
    };
  }

  try {
    const payload = {
      from: "TechZoid Technologies <" + fromAddress + ">",
      to: [to],
      subject,
      /* Both versions, so the recipient's client picks. Sending HTML alone
         scores worse with spam filters and leaves nothing for a client that
         refuses to render it. */
      text: message,
    };
    if (html) payload.html = html;
    if (cc.length) payload.cc = cc;
    /* This one matters most on this path: the message goes out from the
       shared company address, so without it a customer's reply never reaches
       the salesperson who actually quoted them. */
    if (replyTo) payload.reply_to = replyTo;
    if (attachment) payload.attachments = [{ filename: attachment.name, content: attachment.base64 }];

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify(payload),
    });
    const result = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("resend refused:", resp.status, result?.name);
      return { ok: false, error: "The email provider refused that message. " + String(result?.message ?? "").slice(0, 300) };
    }
    return { ok: true, via: "resend" };
  } catch (err) {
    return { ok: false, retryable: true, error: "Could not reach the email provider. " + (err?.message ?? "") };
  }
}
