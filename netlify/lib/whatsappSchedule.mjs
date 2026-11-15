import { daysBetween } from "./whatsappFacts.mjs";

/**
 * Which of the four time-based messages is due today.
 *
 * ALL OF THEM ARE "EXACTLY ON THE DAY" RULES, not "on or after". A rule
 * that fires on or after would send a reminder every single day until the
 * invoice was paid, which is how a company teaches its customers to mute
 * it. The one exception is the overdue chase, which is meant to repeat —
 * and repeats on a stated rhythm rather than daily.
 *
 * The day is decided in INDIA, wherever the server happens to be. The job
 * runs at 10:00 IST; at that moment it is still yesterday in UTC for four
 * and a half hours, so a rule reading the server's date would send
 * everything a day early. See todayInIndia.
 */

/** Today's date in India, as YYYY-MM-DD. */
export function todayInIndia(now = new Date()) {
  /* en-CA gives 2026-11-15, which is the shape every date in this product
     is stored in. */
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Three days before it falls due. */
export const paymentDueToday = (dueDate, today) => daysBetween(dueDate, today) === -3;

/**
 * The day after it was due, then every seventh day after that.
 *
 * 1, 8, 15, 22 … A customer who has not paid hears from us once a week,
 * not once a day.
 */
export function paymentOverdueToday(dueDate, today) {
  const days = daysBetween(dueDate, today);
  if (days < 1) return false;
  return (days - 1) % 7 === 0;
}

/** Thirty days before the subscription runs out. */
export const renewalDueToday = (expiryDate, today) => daysBetween(expiryDate, today) === -30;

/** Three days after the quotation was sent, with no answer. */
export const followUpDueToday = (sentOn, today) => daysBetween(sentOn, today) === 3;

/** How many days overdue, for the message itself. */
export const daysOverdue = (dueDate, today) => Math.max(0, daysBetween(dueDate, today));

/**
 * Is this quotation still waiting for an answer?
 *
 * A quotation that was accepted, rejected or has expired is not chased —
 * the customer has answered, and a chaser afterwards reads as nobody
 * paying attention.
 */
export function awaitingAnswer(status) {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "sent";
}

/** Is there still money on this bill? */
export function stillOwed(bill) {
  const status = String(bill?.status ?? "open").toLowerCase();
  if (status !== "open") return false;
  const outstanding = Number(bill?.amount ?? 0) - Number(bill?.amount_paid ?? 0);
  return outstanding > 0.5;
}

/**
 * Reminders can be held for a customer who has promised a date.
 *
 * The Payment Tracker already has this switch and this pause; WhatsApp
 * honours both, or the two channels would say different things about the
 * same invoice on the same morning.
 */
export function remindersAllowed(bill, today) {
  if (bill?.reminders_on === false) return false;
  const until = String(bill?.paused_until ?? "").slice(0, 10);
  return !until || until < String(today).slice(0, 10);
}
