/**
 * Saying, on the message itself, that nobody typed it — server side.
 *
 * A DELIBERATE SECOND COPY of src/domain/integrations/automated.ts. The
 * payment reminders and the acknowledgement are rendered here, in plain
 * JavaScript, and cannot import the TypeScript one. Read the comment at
 * the top of that file for why the line exists and why it is not a "do not
 * reply" notice.
 *
 * The two are held side by side in src/domain/integrations/automated.test.ts,
 * which fails if a word moves in one and not the other.
 */

/** What the line says, with "%s" standing in for the company's name. */
export const AUTOMATED_NOTICE = {
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

const ANONYMOUS = "our system";

/** The sentence to print at the foot of an automatic message. */
export function automatedNotice(kind, company = "") {
  const name = String(company ?? "").trim() || ANONYMOUS;
  return String(AUTOMATED_NOTICE[kind] ?? "").replace("%s", name);
}
