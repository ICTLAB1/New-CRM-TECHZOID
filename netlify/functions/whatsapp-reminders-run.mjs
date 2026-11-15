import { adminClient } from "../lib/auth.mjs";
import { sendMessage } from "../lib/whatsappSender.mjs";
import {
  awaitingAnswer, daysOverdue, followUpDueToday, paymentDueToday, paymentOverdueToday,
  remindersAllowed, renewalDueToday, stillOwed, todayInIndia,
} from "../lib/whatsappSchedule.mjs";

/**
 * The four WhatsApp messages that go out on a date rather than on an action.
 *
 * Runs once a day at 10:00 in India — see SCHEDULED in
 * api/src/functions/netlifyBridge.mjs, where the time is set in UTC. Ten in
 * the morning is deliberate: a reminder about money that arrives at 03:12
 * reads as a machine, and one that arrives at six in the evening is read
 * tomorrow anyway.
 *
 * MOST RUNS CORRECTLY SEND NOTHING. The rules are "exactly on the day"
 * (whatsappSchedule.mjs), every one of the eight switches starts off, and
 * most customers have not ticked the consent box. Silence here is the
 * feature working, not a fault.
 *
 * NOTHING IN THIS FILE DECIDES WHETHER IT MAY SEND. It decides what is DUE;
 * whether that may be sent to that customer is settled in one place for the
 * whole product (whatsappSender.mjs → whatsappConsent.mjs), and the
 * database's own unique index is what stops a second run of this job
 * sending anything twice.
 */

/** A ceiling, so one bad day cannot turn into a thousand messages. */
const MAX_PER_RUN = 200;

export async function handler() {
  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    console.error("whatsapp reminders: no service credentials —", err?.message ?? err);
    return { statusCode: 500, body: "not configured" };
  }

  const today = todayInIndia();
  const tally = { date: today, sent: 0, skipped: 0, failed: 0, considered: 0 };

  let companies = [];
  try {
    const { data } = await admin.from("companies").select("id");
    companies = data ?? [];
  } catch (err) {
    console.error("whatsapp reminders: could not list companies —", err?.message ?? err);
    return { statusCode: 500, body: "companies unreadable" };
  }

  for (const company of companies) {
    await chaseQuotations(admin, company.id, today, tally);
    await chasePayments(admin, company.id, today, tally);
    await chaseRenewals(admin, company.id, today, tally);
  }

  console.log("whatsapp reminders:", JSON.stringify(tally));
  return { statusCode: 200, body: JSON.stringify(tally) };
}

/* ── a quotation nobody has answered ─────────────────────────────────── */

async function chaseQuotations(admin, companyId, today, tally) {
  const { data: quotes, error } = await admin
    .from("quotes").select("id, customer_id, data").eq("company_id", companyId);
  if (error) {
    console.error("whatsapp reminders: quotes unreadable —", error.message);
    return;
  }

  for (const quote of quotes ?? []) {
    if (tally.sent >= MAX_PER_RUN) return;
    const d = quote.data ?? {};
    if (!awaitingAnswer(d.status)) continue;

    const sentOn = String(d.sentAt ?? d.date ?? "").slice(0, 10);
    if (!followUpDueToday(sentOn, today)) continue;

    await attempt(admin, tally, {
      companyId, template: "quotation_followup", recordType: "quote", recordId: quote.id,
      customerId: quote.customer_id, trigger: "daily:quotation_followup", extra: { today },
    });
  }
}

/* ── an invoice coming due, and one already past ─────────────────────── */

async function chasePayments(admin, companyId, today, tally) {
  const { data: bills, error } = await admin
    .from("payment_bills").select("*").eq("company_id", companyId).eq("status", "open");
  if (error) {
    console.error("whatsapp reminders: bills unreadable —", error.message);
    return;
  }

  for (const bill of bills ?? []) {
    if (tally.sent >= MAX_PER_RUN) return;
    if (!stillOwed(bill) || !remindersAllowed(bill, today)) continue;

    const due = String(bill.due_date ?? "").slice(0, 10);

    if (paymentDueToday(due, today)) {
      await attempt(admin, tally, {
        companyId, template: "payment_due_reminder", recordType: "bill", recordId: bill.id,
        customerId: bill.customer_id, trigger: "daily:payment_due", extra: { today },
      });
      continue;
    }

    if (paymentOverdueToday(due, today)) {
      await attempt(admin, tally, {
        companyId, template: "payment_overdue_reminder", recordType: "bill", recordId: bill.id,
        customerId: bill.customer_id, trigger: "daily:payment_overdue",
        extra: { today, daysOverdue: daysOverdue(due, today) },
      });
    }
  }
}

/* ── a subscription coming up for renewal ────────────────────────────── */

async function chaseRenewals(admin, companyId, today, tally) {
  const { data: subs, error } = await admin
    .from("subscriptions").select("id, customer_id, data").eq("company_id", companyId);
  if (error) {
    console.error("whatsapp reminders: subscriptions unreadable —", error.message);
    return;
  }

  for (const sub of subs ?? []) {
    if (tally.sent >= MAX_PER_RUN) return;
    const d = sub.data ?? {};
    /* A perpetual licence has no renewal, whatever date is sitting on the
       row — see src/domain/subscriptions/expiry.ts for why both fields can
       say so. */
    if (d.type === "Perpetual" || d.status === "Perpetual License") continue;
    if (!renewalDueToday(String(d.expiryDate ?? "").slice(0, 10), today)) continue;

    await attempt(admin, tally, {
      companyId, template: "renewal_reminder", recordType: "subscription", recordId: sub.id,
      customerId: sub.customer_id, trigger: "daily:renewal", extra: { today },
    });
  }
}

/* ── one attempt, counted ────────────────────────────────────────────── */

async function attempt(admin, tally, args) {
  tally.considered += 1;
  try {
    const out = await sendMessage(admin, { ...args, manual: false });
    if (out.ok) tally.sent += 1;
    /* Switched off, no consent, no number, or already sent today: all
       ordinary, all silent. Only a real failure is worth a log line. */
    else if (out.alreadySent || out.switchedOff) tally.skipped += 1;
    else {
      tally.skipped += 1;
      if (!/has not agreed|no WhatsApp number|switched off/i.test(out.reason ?? "")) {
        tally.failed += 1;
        tally.skipped -= 1;
        console.error("whatsapp reminders:", args.template, args.recordId, "—", out.reason);
      }
    }
  } catch (err) {
    tally.failed += 1;
    console.error("whatsapp reminders: threw on", args.template, args.recordId, "—", err?.message ?? err);
  }
}
