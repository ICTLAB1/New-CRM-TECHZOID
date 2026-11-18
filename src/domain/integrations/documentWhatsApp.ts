import { WHATSAPP_FOR } from "../../data/whatsapp";

/**
 * Which approved WhatsApp messages a document screen may send.
 *
 * WHY THIS IS NOT THREE TERNARIES IN THE SCREEN, which is what it was.
 * The rule it carries is one a customer feels: a proforma invoice must
 * never go out under the quotation's wording. Somebody asked to pay
 * against a proforma and told they have received a quotation reads it as a
 * price still open to haggling, and the mistake only ever surfaces in
 * their inbox, days later, in a conversation about money. A rule like that
 * belongs somewhere a test can hold it down, not inside the render.
 *
 * THE RECORD TYPE IS PART OF THE SAME ANSWER. The server reads the figures
 * out of the table this names, and the pairing of template to table is
 * checked at both ends — ask for a quotation message about a proforma and
 * the send is refused rather than quietly filling a quotation's blanks
 * from a proforma's row, which both documents have enough fields to do.
 */
export interface DocumentMessages {
  /** Best first: the chooser puts this at the top. Empty means no button. */
  templates: readonly string[];
  /** What the server should read this document out of. */
  recordType: string;
  /** Whether the message names a figure this screen has to supply.
   *
   *  A document's total is not stored anywhere: it comes from the lines,
   *  the tax type, the seller's state, the discount and the round-off, and
   *  the only copy of that arithmetic is the one that drew the PDF being
   *  attached. So the screen hands the figure over with the document,
   *  which is what stops the message and its attachment disagreeing. */
  needsAmount: boolean;
}

export function approvedMessagesFor(docType: string): DocumentMessages {
  if (docType === "quotation") {
    return { templates: WHATSAPP_FOR["quote"] ?? [], recordType: "quote", needsAmount: false };
  }
  if (docType === "proforma") {
    return { templates: WHATSAPP_FOR["proforma"] ?? [], recordType: "proforma", needsAmount: true };
  }

  /* An invoice's reminders are sent from the Payment tracker, which knows
     the due date and what has been paid; a purchase order goes to a vendor
     rather than a customer. Neither has approved wording about the
     document itself, so neither gets the button. */
  return { templates: [], recordType: "", needsAmount: false };
}

/** The message sent when the document reaches the customer, for the screen
 *  that reports a send. Empty where there is none. */
export const sentMessageFor = (docType: string): string =>
  approvedMessagesFor(docType).templates.find((t) => t.endsWith("_sent")) ?? "";
