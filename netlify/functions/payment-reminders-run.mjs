import { officeToday } from "../lib/today.mjs";
import { adminClient } from "../lib/auth.mjs";
import { sendMail } from "../lib/mailer.mjs";
import { billFromRow, scheduleFrom, stepDueToday } from "../lib/paymentRules.mjs";
import { renderDigest } from "../lib/paymentMessages.mjs";
import { sendReminder, splitList } from "../lib/paymentSender.mjs";

/**
 * Payment Tracker — the morning run. 09:30 in India, every day.
 *
 * For every open bill: work out which step of the schedule is owed today,
 * and send it by email and (when switched on) WhatsApp — once. Then send each
 * company's team a one-page summary of what is overdue, due today and due
 * this week.
 *
 * Nobody is watching when this runs, so:
 *   - a bill that is paid, written off, paused or switched off is skipped;
 *   - only the LATEST step due is sent, never a backlog of old ones;
 *   - every send is claimed in the log first, so nothing goes twice;
 *   - it is bounded, and a failure on one bill never stops the rest.
 */

const BATCH = 200;

export async function handler() {
  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("payment reminders: no service credentials —", err?.message ?? err);
    return { statusCode: 500, body: "not configured" };
  }

  const today = officeToday();
  const tally = { checked: 0, due: 0, sent: 0, failed: 0, already: 0, digests: 0 };

  /* ── settings, per company ── */
  const { data: settingRows, error: settingsError } = await admin
    .from("payment_tracker_settings")
    .select("company_id, data");
  if (settingsError) {
    console.error("payment reminders: settings unreadable —", settingsError.message);
    return { statusCode: 500, body: "settings unreadable" };
  }
  const settingsFor = new Map((settingRows ?? []).map((r) => [String(r.company_id), r.data ?? {}]));

  /* ── open bills ── */
  const { data: rows, error } = await admin
    .from("payment_bills")
    .select("*")
    .eq("status", "open")
    .order("due_date", { ascending: true })
    .limit(5000);
  if (error) {
    console.error("payment reminders: bills unreadable —", error.message);
    return { statusCode: 500, body: "bills unreadable" };
  }

  const open = rows ?? [];
  let sends = 0;

  for (const row of open) {
    tally.checked += 1;
    const settings = settingsFor.get(String(row.company_id)) ?? {};
    /* The master switch. Off means off: nothing goes to any customer. */
    if (settings.enabled === false) continue;

    const step = stepDueToday(billFromRow(row), today, scheduleFrom(settings.schedule));
    if (!step) continue;
    tally.due += 1;

    const channels = [];
    if (settings.emailOn !== false && row.email) channels.push("email");
    if (settings.whatsappOn === true && row.phone) channels.push("whatsapp");

    for (const channel of channels) {
      if (sends >= BATCH) break;
      try {
        const result = await sendReminder({ admin, row, step: step.key, tone: step.tone, channel, today, settings });
        if (result.state === "already") tally.already += 1;
        else { sends += 1; tally[result.state] += 1; }
      } catch (err) {
        tally.failed += 1;
        console.error("payment reminders: bill", row.id, channel, "—", err?.stack ?? err);
      }
    }
  }

  /* ── the team's morning summary, once a day per company ── */
  const companies = new Set([...settingsFor.keys(), ...open.map((r) => String(r.company_id))]);
  for (const companyId of companies) {
    const settings = settingsFor.get(companyId) ?? {};
    if (settings.digestOn === false) continue;
    const to = splitList(settings.digestTo);
    if (to.length === 0) continue;
    if (settings.lastDigestOn === today) continue;

    const digest = renderDigest(open.filter((r) => String(r.company_id) === companyId), today, settings);
    if (digest.count === 0 && settings.digestWhenEmpty !== true) continue;

    try {
      const result = await sendMail({
        admin,
        userId: settings.sendFromUserId || null,
        to: to[0],
        cc: to.slice(1),
        subject: digest.subject,
        message: digest.text,
        html: digest.html,
      });
      if (result?.ok) {
        tally.digests += 1;
        await admin.from("payment_tracker_settings")
          .update({ data: { ...settings, lastDigestOn: today }, updated_at: new Date().toISOString() })
          .eq("company_id", companyId);
      } else {
        console.error("payment reminders: digest for", companyId, "not sent —", result?.error);
      }
    } catch (err) {
      console.error("payment reminders: digest for", companyId, "—", err?.stack ?? err);
    }
  }

  console.log("payment reminders:", JSON.stringify(tally));
  return { statusCode: 200, body: JSON.stringify(tally) };
}
