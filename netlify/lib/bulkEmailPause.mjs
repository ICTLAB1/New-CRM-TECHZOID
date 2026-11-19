/**
 * The stop on everything that sends email without somebody watching.
 *
 * WHY IT EXISTS. Microsoft restricted the company's mailbox from sending
 * after a day of mailshots — not a throttle that clears in five minutes,
 * a restriction that stays until an administrator lifts it. While it is in
 * place every automated send fails, and every failure is another entry in
 * the record Microsoft is judging the account on. The cheapest thing the
 * CRM can do is stop adding to it.
 *
 * WHAT IS PAUSED: everything that sends to many people, or sends to anyone
 * without a person pressing a button for that one customer.
 *
 *   · the company-profile mailshot
 *   · outreach campaigns, and the queue that drains them
 *   · the morning follow-up chasers
 *   · the morning payment reminders
 *
 * WHAT IS NOT: sending one quotation, proforma or invoice to one customer
 * from its own screen. That is the business working, it is one message
 * with a person behind it, and stopping it would stop the company trading.
 *
 * NOTHING IS LOST WHILE IT IS PAUSED, which is the part that matters most.
 * A follow-up due today is left `scheduled` rather than marked failed, so
 * it goes out when sending resumes instead of needing to be armed again. A
 * campaign keeps its queue. The pause is a held breath, not a bin.
 *
 * HOW TO LIFT IT: set PAUSED to false below and deploy. It is a constant
 * rather than a setting on purpose — a switch in Settings is one wrong tap
 * away from starting four hundred messages from a mailbox that is still
 * restricted, and the cost of that is the company's email rather than an
 * afternoon. Turning it back on should be a decision somebody makes with
 * the Defender portal open in the next tab.
 */

/** Set to false and deploy when Microsoft has lifted the restriction. */
export const PAUSED = true;

/** Why, in the words a person at a screen should read. */
export const PAUSE_REASON =
  "Bulk email is paused. Microsoft restricted this company's mailbox from sending after a large "
  + "mailshot, and every further attempt counts against it. Nothing has been lost — follow-ups and "
  + "campaigns are still queued and will go out when sending is turned back on. "
  + "An administrator lifts the restriction at security.microsoft.com → Email & collaboration → "
  + "Review → Restricted entities.";

/** True when this send should not happen. Named so a call site reads as a
 *  sentence: `if (bulkEmailPaused()) return ...`. */
export const bulkEmailPaused = () => PAUSED === true;

/** One line for a server log, so a job that did nothing says why. */
export const pausedLog = (what) => `${what}: skipped — bulk email is paused (lib/bulkEmailPause.mjs)`;
