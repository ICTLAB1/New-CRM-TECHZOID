import { officeToday } from "../lib/today.mjs";
import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInProfile } from "../lib/auth.mjs";
import { sendMail } from "../lib/mailer.mjs";
import { billFromRow, daysBetween, scheduleFrom, stepDueToday, toneFor } from "../lib/paymentRules.mjs";
import { renderReminderEmail } from "../lib/paymentMessages.mjs";
import { sendReminder } from "../lib/paymentSender.mjs";
import { handler as runMorning } from "./payment-reminders-run.mjs";

/**
 * Payment Tracker — the buttons on the screen.
 *
 *   send     "Send reminder now" on one bill, by email and/or WhatsApp
 *   preview  the email a bill would get today, without sending it
 *   test     a sample reminder to an address of your choice
 *   run      run this morning's batch now (admin / manager)
 *   status   is email / WhatsApp actually set up on the server?
 *
 * Signed-in only. A bill can be acted on by its owner, or by an admin or
 * manager in the same company.
 */

const PRIVILEGED = new Set(["Admin", "Manager"]);

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const who = await signedInProfile(event);
  if (!who) return fail(event, 403, "Sign in required.");
  const userId = who.user.id;
  const privileged = PRIVILEGED.has(who.role);

  const body = readJson(event) ?? {};
  const admin = adminClient();
  const today = officeToday();

  if (body.action === "status") {
    return json(event, 200, {
      whatsappKey: !!process.env.INTERAKT_API_KEY,
      resendKey: !!process.env.RESEND_API_KEY,
      today,
    });
  }

  if (body.action === "run") {
    if (!privileged) return fail(event, 403, "Only an admin or a manager can run the morning batch.");
    const result = await runMorning();
    let tally = null;
    try { tally = JSON.parse(result.body); } catch { /* reported as-is */ }
    return json(event, 200, { ran: result.statusCode === 200, tally, note: tally ? null : String(result.body) });
  }

  if (body.action === "test") {
    const to = String(body.to ?? "").trim();
    if (!to.includes("@")) return fail(event, 400, "Give an email address to send the test to.");
    const settings = await settingsOf(admin, body.companyId);
    const sample = {
      id: "sample", invoice_no: "TZ/2026-27/0001", customer_name: "Sample Customer Pvt. Ltd.",
      contact_name: "Mr. Sharma", amount: 118000, amount_paid: 0, currency: "INR",
      invoice_date: today, due_date: today,
    };
    const tone = ["upcoming", "due", "overdue", "firm", "final"].includes(body.tone) ? body.tone : "overdue";
    const mail = renderReminderEmail(sample, tone, today, settings);
    const result = await sendMail({
      admin, userId: settings.sendFromUserId || userId, to,
      subject: "[TEST] " + mail.subject, message: mail.text, html: mail.html,
      replyTo: String(settings.replyTo ?? "").trim(),
    });
    return result.ok
      ? json(event, 200, { sent: true, via: result.via, from: result.from ?? null })
      : fail(event, 502, result.error ?? "The test email was not sent.");
  }

  /* send / preview need a bill the caller may act on */
  const billId = String(body.billId ?? "");
  if (!billId) return fail(event, 400, "Which bill?");
  const { data: row, error } = await admin.from("payment_bills").select("*").eq("id", billId).maybeSingle();
  if (error) return fail(event, 500, "Could not read that bill.", error.message);
  if (!row) return fail(event, 404, "That bill no longer exists.");

  const { data: membership } = await admin
    .from("company_members").select("user_id").eq("company_id", row.company_id).eq("user_id", userId).maybeSingle();
  if (!membership) return fail(event, 403, "That bill belongs to another company.");
  if (row.owner_id !== userId && !privileged) return fail(event, 403, "Only the bill's owner, an admin or a manager can do that.");

  const settings = await settingsOf(admin, row.company_id);
  const schedule = scheduleFrom(settings.schedule);
  const days = daysBetween(String(row.due_date).slice(0, 10), today);
  const scheduled = stepDueToday(billFromRow(row), today, schedule);
  const tone = scheduled?.tone ?? (days < 0 ? "upcoming" : toneFor(days, schedule));

  if (body.action === "preview") {
    return json(event, 200, { tone, ...renderReminderEmail(row, tone, today, settings) });
  }

  if (body.action === "send") {
    const wanted = Array.isArray(body.channels) ? body.channels : ["email"];
    const step = `manual-${new Date().toISOString().slice(0, 16)}`;
    const results = {};
    for (const channel of wanted.filter((c) => c === "email" || c === "whatsapp")) {
      results[channel] = await sendReminder({ admin, row, step, tone, channel, today, settings });
    }
    return json(event, 200, { results });
  }

  return fail(event, 400, "Unknown action.");
}

async function settingsOf(admin, companyId) {
  if (!companyId) {
    const { data } = await admin.from("payment_tracker_settings").select("data").limit(1);
    return data?.[0]?.data ?? {};
  }
  const { data } = await admin.from("payment_tracker_settings").select("data").eq("company_id", companyId).maybeSingle();
  return data?.data ?? {};
}
