import { sendMail } from "./mailer.mjs";
import { sendWhatsAppTemplate } from "./whatsapp.mjs";
import { renderReminderEmail, renderThanksEmail, whatsappFor } from "./paymentMessages.mjs";

/**
 * Send one reminder for one bill on one channel — exactly once.
 *
 * THE CLAIM COMES FIRST. A log row keyed (bill, step, channel) is inserted
 * before anything is sent; the unique index on those three columns means a
 * second run, a retry, or two servers at once find the row already there and
 * send nothing. A failure is recorded on that row and NOT retried in the same
 * run — tomorrow's step, or a person pressing "Send now", is soon enough.
 *
 * @returns {Promise<{state: "sent"|"failed"|"already", error?: string}>}
 */
export async function sendReminder({ admin, row, step, tone, channel, today, settings }) {
  const sendTo = channel === "whatsapp" ? String(row.phone ?? "").trim() : String(row.email ?? "").trim();
  if (!sendTo) return { state: "failed", error: `No ${channel === "whatsapp" ? "WhatsApp number" : "email"} on this bill.` };

  const id = `${row.id}:${step}:${channel}`;
  const { data: claimed, error: claimError } = await admin
    .from("payment_reminders")
    .upsert(
      {
        id,
        company_id: row.company_id,
        bill_id: row.id,
        step,
        channel,
        state: "sending",
        sent_on: today,
        send_to: sendTo,
      },
      { onConflict: "bill_id,step,channel", ignoreDuplicates: true },
    )
    .select("id");

  if (claimError) {
    console.error("payment reminders: could not claim", id, "—", claimError.message);
    return { state: "failed", error: "Could not record the reminder, so it was not sent." };
  }
  if (!claimed || claimed.length === 0) return { state: "already" };

  let result;
  if (channel === "whatsapp") {
    const wa = whatsappFor(row, tone, settings);
    result = await sendWhatsAppTemplate({
      to: sendTo,
      templateName: wa.templateName,
      bodyValues: wa.bodyValues,
      callbackData: id,
    });
  } else {
    const mail = renderReminderEmail(row, tone, today, settings);
    const cc = [...splitList(settings.ccEmails), ...splitList(row.cc)];
    result = await sendMail({
      admin,
      /* A shared mailbox wins when one is configured, and then the owner is
         not consulted at all: "all reminders come from accounts@" has to mean
         all of them, including the bills owned by somebody who has since left.
         Falling through to the owner on a disabled or deleted mailbox would
         quietly resume sending from individuals, which is the thing this
         setting exists to stop. sendMail refuses outright on a named mailbox
         it cannot use, and the reminder is recorded failed with that reason. */
      accountId: String(settings.sendFromAccountId ?? "").trim() || null,
      userId: settings.sendFromUserId || row.owner_id,
      to: sendTo,
      cc: [...new Set(cc.map((c) => c.toLowerCase()))],
      subject: mail.subject,
      message: mail.text,
      html: mail.html,
      replyTo: String(settings.replyTo ?? "").trim(),
    });
  }

  const now = new Date().toISOString();
  if (result?.ok) {
    await admin.from("payment_reminders").update({
      state: "sent",
      error: null,
      ...(result.id ? { provider_message_id: String(result.id) } : {}),
      updated_at: now,
    }).eq("id", id);
    return { state: "sent" };
  }

  const error = String(result?.error ?? "Not sent.").slice(0, 500);
  await admin.from("payment_reminders").update({ state: "failed", error, updated_at: now }).eq("id", id);
  return { state: "failed", error };
}

export const splitList = (value) =>
  String(value ?? "").split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"));

/**
 * Thank a customer for one payment — exactly once, ever.
 *
 * THE SAME CLAIM-FIRST SHAPE AS sendReminder, and for a sharper reason.
 * A reminder that goes twice is an irritation; a second thank-you for a
 * payment made once reads either as incompetence or as a second demand,
 * and this one is triggered by a person pressing Save rather than by a
 * schedule — so it meets double-clicks, retried saves on a bad connection
 * and two people in accounts entering the same cheque. The row keyed
 * (source, ref_id, payment_id) is inserted before anything is sent, and
 * the second attempt finds it already there.
 *
 * THE RECIPIENT IS NEVER TAKEN FROM THE REQUEST. It is read out of the
 * bill or the invoice by the caller, so this cannot be used to send mail
 * to an address somebody typed into a browser console.
 *
 * NO BANK DETAILS, unlike a reminder: a message about money already
 * received that repeats where to send money is the shape of every
 * payment-redirection fraud. renderThanksEmail leaves them out.
 *
 * @returns {Promise<{state: "sent"|"failed"|"already", error?: string}>}
 */
export async function sendThanks({ admin, receipt, settings, today }) {
  const sendTo = String(receipt.email ?? "").trim();
  if (!sendTo.includes("@")) {
    return { state: "failed", error: "No email address on this customer, so there was nobody to thank." };
  }

  const id = `${receipt.source}:${receipt.ref_id}:${receipt.payment_id}`;
  const { data: claimed, error: claimError } = await admin
    .from("payment_receipts")
    .upsert(
      {
        id,
        company_id: receipt.company_id,
        source: receipt.source,
        ref_id: receipt.ref_id,
        payment_id: receipt.payment_id,
        state: "sending",
        sent_on: today,
        send_to: sendTo,
        amount: Number(receipt.paid_now) || 0,
        currency: receipt.currency || "INR",
      },
      { onConflict: "source,ref_id,payment_id", ignoreDuplicates: true },
    )
    .select("id");

  if (claimError) {
    console.error("payment thanks: could not claim", id, "—", claimError.message);
    return { state: "failed", error: "Could not record the acknowledgement, so it was not sent." };
  }
  if (!claimed || claimed.length === 0) return { state: "already" };

  const mail = renderThanksEmail(receipt, settings);
  /* The customer's own further contacts, and not the company's ccEmails
     list: that exists so somebody sees the chasing, and copying it on
     every acknowledgement turns an accounts inbox into a feed. */
  const cc = [...new Set(splitList(receipt.cc).map((c) => c.toLowerCase()))];
  const result = await sendMail({
    admin,
    accountId: String(settings.sendFromAccountId ?? "").trim() || null,
    userId: settings.sendFromUserId || receipt.owner_id,
    to: sendTo,
    cc,
    subject: mail.subject,
    message: mail.text,
    html: mail.html,
    replyTo: String(settings.replyTo ?? "").trim(),
  });

  const now = new Date().toISOString();
  if (result?.ok) {
    await admin.from("payment_receipts").update({
      state: "sent",
      error: null,
      ...(result.id ? { provider_message_id: String(result.id) } : {}),
      updated_at: now,
    }).eq("id", id);
    return { state: "sent" };
  }

  const error = String(result?.error ?? "Not sent.").slice(0, 500);
  await admin.from("payment_receipts").update({ state: "failed", error, updated_at: now }).eq("id", id);
  return { state: "failed", error };
}
