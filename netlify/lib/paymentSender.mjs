import { sendMail } from "./mailer.mjs";
import { sendWhatsAppTemplate } from "./whatsapp.mjs";
import { renderReminderEmail, whatsappFor } from "./paymentMessages.mjs";

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
