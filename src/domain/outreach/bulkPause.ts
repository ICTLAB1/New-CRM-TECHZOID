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

/** Keep in step with PAUSED in netlify/lib/bulkEmailPause.mjs. */
export const BULK_EMAIL_PAUSED = true;

/** Said on screen, where a sender will meet it. */
export const BULK_PAUSE_NOTICE =
  "Microsoft has restricted this company's mailbox from sending, after a large mailshot. "
  + "Until an administrator lifts it, the CRM will not send mailshots, campaigns, follow-up chasers "
  + "or payment reminders — every further attempt counts against the account. "
  + "Nothing has been lost: everything queued stays queued and goes out when sending is turned back on. "
  + "Sending one quotation to one customer still works.";
