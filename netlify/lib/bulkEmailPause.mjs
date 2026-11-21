/**
 * The stop on the company-profile mailshot, and on nothing else.
 *
 * CURRENTLY OFF. Lifted on 21 November 2026 at the company's instruction.
 * The machinery below stays wired up: turning it back on is one constant,
 * which is the whole reason it was built this way.
 *
 * WHY IT EXISTS. Microsoft restricted the company's mailbox from sending
 * after a day of profile mailshots — a hundred and twenty-eight messages,
 * each carrying a two-megabyte PDF. Not a throttle that clears in five
 * minutes: a restriction an administrator has to lift at
 * security.microsoft.com → Email & collaboration → Review → Restricted
 * entities. The mailshot is what caused it, so the mailshot is what
 * stopped.
 *
 * WHAT IT COVERS WHEN ON: the company-profile mailshot, and only that.
 * Never the morning follow-up chasers, the morning payment reminders,
 * outreach campaigns and the queue that drains them, or one quotation,
 * proforma or invoice to one customer.
 *
 * THE DIFFERENCE IS VOLUME PER SEND, not whether a person is watching. A
 * follow-up goes to one customer about one document they asked for, a
 * handful a morning, with no attachment. A mailshot is hundreds of cold
 * introductions carrying two megabytes each, which is both the thing
 * Microsoft objected to and the thing a business can wait a week for.
 *
 * WHAT LIFTING IT DOES NOT DO is unrestrict the mailbox. If Microsoft has
 * not released it, every message still fails — this flag decides whether
 * the CRM tries, not whether Microsoft accepts. And the behaviour that
 * caused the restriction is available again: the daily volume is nobody's
 * but the sender's to judge now, the per-day cap having been removed at
 * the company's instruction in an earlier change.
 *
 * HOW TO PUT IT BACK: set PAUSED to true below and deploy. A constant
 * rather than a setting, because a switch on a screen is one wrong tap
 * away from four hundred messages leaving a mailbox that is still
 * restricted.
 */

/** Set to true and deploy to stop the mailshot again. */
export const PAUSED = false;

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
