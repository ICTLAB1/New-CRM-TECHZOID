/**
 * Saying, on the message itself, that nobody typed it.
 *
 * WHY EVERY AUTOMATIC MESSAGE CARRIES THIS LINE. A chaser that arrives
 * three days after a quotation, signed by a salesperson, reads as a person
 * sitting there waiting — so a customer who has already replied wonders
 * whether their reply was read, and one who has already paid reads a
 * payment reminder as an accusation. Saying plainly that the machine sent
 * it costs one line and removes both.
 *
 * AND IT IS NOT A "DO NOT REPLY" NOTICE — the opposite. These go out from
 * a real mailbox with a real reply-to, so the line says a reply reaches a
 * person. "Do not reply to this email" on a message chasing somebody for
 * money is how a supplier becomes unreachable at the exact moment the
 * customer wants to tell them something.
 *
 * ONE WORDING, EVERYWHERE. The sentence differs by what the message is
 * for, and nothing else: a reminder has to excuse itself to somebody who
 * has already paid, an acknowledgement has to say nothing is needed. They
 * are written out here rather than typed into each renderer, because four
 * nearly-identical disclaimers drifting apart is how a company ends up
 * sounding like four companies.
 *
 * A DELIBERATE SECOND COPY lives in netlify/lib/automatedNotice.mjs: the
 * payment reminders are rendered on the server, which runs plain
 * JavaScript and cannot import TypeScript. automated.test.ts holds the two
 * side by side and fails if a word moves in one and not the other.
 */

export type AutomatedKind =
  /** A chaser from an armed follow-up sequence. */
  | "follow-up"
  /** A payment reminder from the tracker's schedule. */
  | "payment-reminder"
  /** The acknowledgement sent when a payment is recorded. */
  | "payment-receipt"
  /** Anything that goes to our own people rather than a customer. */
  | "internal";

/** What the line says, with "%s" standing in for the company's name. */
export const AUTOMATED_NOTICE: Record<AutomatedKind, string> = {
  "follow-up":
    "This reminder was sent automatically by %s because this quotation is still open — "
    + "nobody typed it today. If you have already replied, or would rather not be reminded, "
    + "reply to this email and a person will read it.",
  "payment-reminder":
    "This reminder was sent automatically by %s, and our records may not have caught up with a "
    + "payment made in the last day or two. If you have already paid, reply with the payment "
    + "reference and we will match it — replies to this email reach a person.",
  "payment-receipt":
    "This acknowledgement was sent automatically by %s when your payment was recorded. "
    + "Nothing is needed from you. Replies to this email reach a person.",
  internal:
    "Sent automatically by the CRM. Nobody typed this message.",
};

/** Without a company name — "us" is wrong, so the sentence loses the name
 *  rather than inventing one. */
const ANONYMOUS = "our system";

/**
 * The sentence to print at the foot of an automatic message.
 *
 * @param kind    what the message is for
 * @param company the company's name, as the customer knows it
 */
export function automatedNotice(kind: AutomatedKind, company = ""): string {
  const name = String(company ?? "").trim() || ANONYMOUS;
  return AUTOMATED_NOTICE[kind].replace("%s", name);
}
