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

/**
 * WHAT A REFRESH MAY ASK FOR — a subset of what was consented, never more.
 *
 * This nearly took the company's quotation email offline. When Mail.Read was
 * added to the consent request, this string was changed to match it "so they
 * could not drift". That is backwards: refresh tokens already in the database
 * were issued when only Mail.Send had been consented, and OAuth permits a
 * refresh to request a SUBSET of the granted scopes and rejects a SUPERSET
 * (AADSTS65001). Every existing mailbox would have started failing to refresh,
 * and sendMail returns "your connection has expired" WITHOUT falling back to
 * Resend — so quotations from three connected mailboxes would simply have
 * stopped, blamed on Microsoft.
 *
 * Sending needs Mail.Send. It does not need Mail.Read, so it does not ask for
 * it, and this works for a token granted before Mail.Read existed and one
 * granted after. Reply detection asks for Mail.Read separately, where a
 * refusal means "this mailbox predates that permission" — which is
 * actionable, and only affects reading.
 */
const SEND_SCOPES = "openid profile offline_access User.Read Mail.Send";

/** For reply detection. Only usable by a mailbox connected after Mail.Read
 *  was added to the consent screen. */
export const READ_SCOPES = "openid profile offline_access User.Read Mail.Read";

/**
 * @param {object} args
 * @param {string} [args.accountId] A row in `email_accounts` to send from,
 *   for a campaign sending on behalf of a shared mailbox somebody was granted
 *   (see supabase/024_shared_mailboxes.sql). When absent — every existing
 *   caller — the sender's own `ms_mail_accounts` row is used exactly as
 *   before. This parameter is additive on purpose: the quotation path is what
 *   this company runs on, and it must not change shape to let campaigns exist.
 * @returns {{ok: true, via: "microsoft"|"resend", from?: string} | {ok: false, error: string, retryable?: boolean}}
 */
export async function sendMail({
  admin, userId, accountId = null, to, cc = [], subject, message, html = null, replyTo = "", attachment = null,
}) {
  /* A named mailbox wins when one was asked for. `email_accounts` and
     `ms_mail_accounts` hold the same shape of secret but are different rows,
     so each carries its own way of writing a rotated token back — get that
     wrong and the token is stored against the wrong mailbox, which fails on
     the NEXT send and looks like an expired connection. */
  let mailbox = null;
  let persistToken = null;

  if (accountId) {
    try {
      const { data } = await admin
        .from("email_accounts")
        .select("id, email, refresh_token")
        .eq("id", accountId)
        .maybeSingle();
      if (data?.refresh_token) {
        mailbox = { refresh_token: data.refresh_token, ms_email: data.email };
        persistToken = (token) =>
          admin.from("email_accounts")
            .update({ refresh_token: token, updated_at: new Date().toISOString() })
            .eq("id", accountId);
      }
    } catch (err) {
      console.warn("campaign mailbox lookup failed:", err?.message ?? err);
    }
  }

  /* The sender's OWN mailbox otherwise, exactly as the interactive path
     chooses it: the customer sees the salesperson they have been dealing
     with, and a copy lands in that person's Sent Items — which is the only
     way a scheduled email is ever visible to the human it was sent on behalf
     of. */
  if (!mailbox && userId) {
    try {
      const { data } = await admin.from("ms_mail_accounts").select("*").eq("user_id", userId).maybeSingle();
      mailbox = data ?? null;
      if (mailbox) {
        persistToken = (token) =>
          admin.from("ms_mail_accounts")
            .update({ refresh_token: token, updated_at: new Date().toISOString() })
            .eq("user_id", userId);
      }
    } catch (err) {
      console.warn("mailbox lookup failed, falling back:", err?.message ?? err);
    }
  }

  if (mailbox?.refresh_token && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET) {
    return sendViaMicrosoft({ mailbox, persistToken, to, cc, subject, message, html, replyTo, attachment });
  }
  return sendViaResend({ to, cc, subject, message, html, replyTo, attachment });
}

async function sendViaMicrosoft({ mailbox, persistToken, to, cc, subject, message, html, replyTo, attachment }) {
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
        scope: SEND_SCOPES,
      }).toString(),
    });
    const tok = await tokenResp.json().catch(() => ({}));

    if (!tokenResp.ok || !tok.access_token) {
      console.error("ms refresh failed:", tokenResp.status, tok?.error);
      return { ok: false, error: "Your Microsoft 365 connection has expired. Reconnect it in Settings → Integrations." };
    }

    /* Microsoft ROTATES refresh tokens. Store the new one or the next send
       fails with an expired-token error that looks like a broken setup.
       Which row it belongs to was decided by the caller — see sendMail. */
    if (tok.refresh_token && tok.refresh_token !== mailbox.refresh_token && persistToken) {
      const { error } = await persistToken(tok.refresh_token);
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
