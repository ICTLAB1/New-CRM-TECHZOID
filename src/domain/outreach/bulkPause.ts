/**
 * The screens' copy of the pause on automated email.
 *
 * THE PAUSE ITSELF IS THE SERVER'S — netlify/lib/bulkEmailPause.mjs — and
 * nothing here enforces anything. A browser cannot be where a send is
 * stopped: the endpoints are reachable without one, and the scheduled jobs
 * have no browser at all.
 *
 * What this is for is saying so BEFORE somebody fills in a recipient list
 * and presses Send, instead of after. bulkPause.test.ts fails if the two
 * fall out of step, the same arrangement the WhatsApp template names are
 * under.
 */

/** Keep in step with PAUSED in netlify/lib/bulkEmailPause.mjs.
 *  Currently off — lifted 21 November 2026 at the company's instruction. */
export const BULK_EMAIL_PAUSED = false;

/** Said on screen, where a sender will meet it. */
export const BULK_PAUSE_NOTICE =
  "Microsoft has restricted this company's mailbox from sending, after a large mailshot — and sending "
  + "more of them is what would keep it restricted. Nothing has been lost: your list is still here and "
  + "will send when this is turned back on. "
  + "Follow-ups, payment reminders and sending one quotation to one customer are unaffected.";
