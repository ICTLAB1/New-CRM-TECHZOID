import { describe, expect, it } from "vitest";
import { approvedMessagesFor, sentMessageFor } from "./documentWhatsApp";

describe("which approved messages a document may send", () => {
  it("offers a quotation its own two", () => {
    const { templates, recordType } = approvedMessagesFor("quotation");
    expect(templates).toEqual(["quotation_sent", "quotation_followup"]);
    expect(recordType).toBe("quote");
  });

  it("offers a proforma its own three, sending first", () => {
    const { templates, recordType } = approvedMessagesFor("proforma");
    expect(templates).toEqual(["proforma_sent", "proforma_followup", "proforma_advance_reminder"]);
    expect(recordType).toBe("proforma");
  });

  /* THE RULE THIS FILE EXISTS FOR. A customer asked to pay against a
     proforma must not be told they have received a quotation: it invites
     them to treat a bill as a price still open to negotiation, and the
     mistake only ever shows up in somebody else's inbox. */
  it("never lets a proforma borrow the quotation's wording, or the other way about", () => {
    for (const t of approvedMessagesFor("proforma").templates) {
      expect(t, t).not.toContain("quotation");
    }
    for (const t of approvedMessagesFor("quotation").templates) {
      expect(t, t).not.toContain("proforma");
    }
  });

  /* An invoice's reminders come from the Payment tracker, which knows what
     is still owed; a purchase order goes to a vendor, not a customer. */
  it("gives an invoice and a purchase order no button at all", () => {
    for (const docType of ["invoice", "purchase_order", "challan", ""]) {
      expect(approvedMessagesFor(docType).templates, docType).toEqual([]);
      expect(approvedMessagesFor(docType).recordType, docType).toBe("");
    }
  });

  /* The figure comes from the screen that drew the document, because that
     is the only place the total exists. Asking for it where no message
     names one would put a number on screen that nothing reads. */
  it("asks the screen for the figure only where a message names one", () => {
    expect(approvedMessagesFor("proforma").needsAmount).toBe(true);
    expect(approvedMessagesFor("quotation").needsAmount).toBe(false);
    expect(approvedMessagesFor("invoice").needsAmount).toBe(false);
  });
});

describe("the message sent when the customer gets the document", () => {
  it("is the right one for each document that has one", () => {
    expect(sentMessageFor("quotation")).toBe("quotation_sent");
    expect(sentMessageFor("proforma")).toBe("proforma_sent");
  });

  it("is nothing where the document has no approved message", () => {
    expect(sentMessageFor("invoice")).toBe("");
    expect(sentMessageFor("purchase_order")).toBe("");
  });
});
