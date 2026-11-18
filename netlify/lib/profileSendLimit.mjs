import { todayInIndia } from "./whatsappSchedule.mjs";

/**
 * How many company-profile emails may leave this domain in one day.
 *
 * WHAT THIS IS PROTECTING, because it is not the mailbox. Microsoft will
 * accept thousands of messages a day from one account and never complain.
 * The thing that breaks is the DOMAIN'S REPUTATION at the receiving end:
 * Google, Outlook.com and every corporate filter in between score a sender
 * on how much mail it suddenly starts sending, to how many people who never
 * asked, and how many of them bounce or press "this is spam". A domain that
 * has been sending twenty ordinary business emails a day and then sends
 * four hundred introductions in an afternoon is the exact shape of a
 * compromised account, and it gets filtered as one.
 *
 * Reputation damage is slow to notice and slow to undo. The quotations and
 * invoices that go from the same domain start landing in junk, and nobody
 * connects it to a mailshot sent a fortnight earlier. That asymmetry — cheap
 * to prevent, expensive to recover from — is why this is a hard stop on the
 * server rather than a warning on a screen.
 *
 * PER COMPANY, NOT PER PERSON. Reputation belongs to the domain, so three
 * salespeople sending forty each is one hundred and twenty from one domain
 * and exactly the pattern this exists to prevent. The count is shared.
 *
 * ONLY WHAT ACTUALLY WENT. A send the transport refused never reached a
 * recipient and never touched the domain's reputation, so it does not use
 * up the allowance — otherwise a Microsoft outage would spend a company's
 * whole day of sending without a single message arriving.
 */

/**
 * The default, for a company that has not chosen one.
 *
 * FORTY IS A STARTING NUMBER, NOT A TARGET. It is low enough that a domain
 * with no history of bulk sending does not look like it has been taken
 * over, and high enough to be a useful afternoon's work. The guidance
 * everyone in deliverability gives is the same shape: start small, raise it
 * over weeks, and watch what bounces. Settings carries that advice next to
 * the field.
 */
export const DEFAULT_DAILY_CAP = 40;

/**
 * The most a company may set it to.
 *
 * A LIMIT ON THE LIMIT, because the field exists to be raised as a domain
 * warms up, not to be switched off in a hurry on the day somebody buys a
 * list. Past a few hundred introductions a day from a single business
 * mailbox, the right tool stops being a CRM and starts being a service
 * built for it, with its own sending domain so that a bad week cannot take
 * the company's invoices down with it.
 */
export const MAX_DAILY_CAP = 300;

/** What this company allows itself, clamped to something sane. */
export function dailyCapFrom(settings = {}) {
  const raw = settings?.profile?.dailySendLimit ?? settings?.profileDailySendLimit;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAILY_CAP;
  return Math.min(n, MAX_DAILY_CAP);
}

/**
 * How many went today, on the Indian calendar day.
 *
 * THE DAY IS THE BUSINESS'S, not UTC's. A cap that resets at half past five
 * in the evening, which is what midnight UTC is in India, would let an
 * afternoon's sending be doubled by waiting an hour — and nobody would ever
 * work out why the limit had not held.
 */
export async function sentTodayCount(admin, companyId, now = new Date()) {
  const day = todayInIndia(now);
  /* Midnight in India, written as the instant it actually is. */
  const from = new Date(`${day}T00:00:00+05:30`).toISOString();

  const { count, error } = await admin
    .from("profile_sends")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "sent")
    .gte("created_at", from);

  if (error) throw new Error(error.message);
  return Number(count ?? 0);
}

/**
 * What is left of today, and what to say about it.
 *
 * Returns `{ cap, sentToday, remaining }`. The caller decides what to do
 * with a short allowance; this only counts.
 */
export async function allowanceFor(admin, companyId, settings = {}, now = new Date()) {
  const cap = dailyCapFrom(settings);
  const sentToday = await sentTodayCount(admin, companyId, now);
  return { cap, sentToday, remaining: Math.max(0, cap - sentToday) };
}

/**
 * The sentence a person reads when the day is spent.
 *
 * It says what happened, what the limit is, when it lifts and where to
 * change it — because "limit reached" on its own reads as a fault in the
 * CRM, and the next thing somebody does is try again.
 */
export const spentMessage = ({ cap, sentToday }) =>
  `Today's sending limit is used up: ${sentToday} of ${cap} company profiles have gone out from this company today. `
  + "The limit protects your domain — a sudden jump in volume is what gets a business's mail filtered as spam, "
  + "and it takes weeks to recover. The count resets at midnight. "
  + "Settings → Company profile is where the daily limit is changed, if your domain is ready for more.";

/**
 * The sentence for a list that is longer than what is left.
 *
 * The send is not refused: the first of them go and the rest are reported,
 * by name, as not sent. A half-sent list that says exactly which half is
 * recoverable; one that refuses everything wastes the allowance that was
 * still there.
 */
export const partialMessage = ({ remaining, cap }) =>
  `Only ${remaining} of today's ${cap} are left, so the rest were not sent. `
  + "They are listed below and can be sent tomorrow, when the limit resets.";
