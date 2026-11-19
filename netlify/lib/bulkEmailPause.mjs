/**
 * The stop on the company-profile mailshot, and on nothing else.
 *
 * WHY IT EXISTS. Microsoft restricted the company's mailbox from sending
 * after a day of profile mailshots — a hundred and twenty-eight messages,
 * each carrying a two-megabyte PDF. Not a throttle that clears in five
 * minutes: a restriction an administrator has to lift. The mailshot is
 * what caused it, so the mailshot is what stops.
 *
 * WHAT IS PAUSED: the company-profile mailshot, and only that.
 *
 * WHAT IS NOT, at the company's instruction and after they were told what
 * it means:
 *
 *   · the morning follow-up chasers
 *   · the morning payment reminders
 *   · outreach campaigns and the queue that drains them
 *   · one quotation, proforma or invoice to one customer
 *
 * THE DIFFERENCE IS VOLUME PER SEND, not whether a person is watching. A
 * follow-up goes to one customer about one document they asked for, a
 * handful a morning, with no attachment. A mailshot is hundreds of cold
 * introductions carrying two megabytes each, which is both the thing
 * Microsoft objected to and the thing a business can wait a week for.
 *
 * WHILE THE MAILBOX IS STILL RESTRICTED everything above will attempt and
 * fail, and a follow-up that fails is marked failed rather than left
 * scheduled — it has to be armed again by hand. That is the cost of
 * unpausing before the restriction is lifted, and it was explained before
 * this was narrowed.
 *
 * HOW TO LIFT IT: set PAUSED to false below and deploy. A constant rather
 * than a setting, because a switch on a screen is one wrong tap away from
 * four hundred messages leaving a mailbox that is still restricted.
 */

/** Set to false and deploy when the mailshot should run again. */
export const PAUSED = true;

/** Why, in the words a person at a screen should read. */
export const PAUSE_REASON =
  "Company profile mailshots are paused. Microsoft restricted this company's mailbox from sending "
  + "after a large mailshot, and sending more of them is what would keep it restricted. "
  + "Nothing has been lost — the list is still here and will send when this is turned back on. "
  + "Follow-ups, payment reminders and sending one quotation to one customer are unaffected. "
  + "An administrator lifts the restriction at security.microsoft.com → Email & collaboration → "
  + "Review → Restricted entities.";

/** True when the mailshot should not go. Named so a call site reads as a
 *  sentence: `if (bulkEmailPaused()) return ...`. */
export const bulkEmailPaused = () => PAUSED === true;

/** One line for a server log, so a job that did nothing says why. */
export const pausedLog = (what) => `${what}: skipped — the profile mailshot is paused (lib/bulkEmailPause.mjs)`;
