import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, whatsappFor } from "./paymentMessages.mjs";
import { TEMPLATES } from "./whatsappTemplates.mjs";

const bill = {
  invoice_no: "TZ/INV/0042",
  amount: 118000,
  amount_paid: 0,
  due_date: "2026-11-10",
  contact_name: "Rahul Verma",
  customer_name: "Acme Infotech",
  currency: "INR",
};

describe("the WhatsApp reminder a bill sends", () => {
  it("only ever names a template Meta has approved", () => {
    for (const [tone, name] of Object.entries(DEFAULT_TEMPLATES)) {
      expect(TEMPLATES[name], `${tone} uses ${name}`).toBeTruthy();
    }
  });

  it("passes exactly as many values as the approved wording has blanks", () => {
    for (const tone of Object.keys(DEFAULT_TEMPLATES)) {
      const wa = whatsappFor(bill, tone, {}, "2026-11-15");
      expect(wa.bodyValues.length, `${tone} → ${wa.templateName}`)
        .toBe(TEMPLATES[wa.templateName].params.length);
    }
  });

  it("writes money the Indian way, with no currency symbol and no paise", () => {
    const wa = whatsappFor(bill, "due", {}, "2026-11-15");
    expect(wa.bodyValues[2]).toBe("1,18,000");
  });

  it("asks only for what is still owed, not the whole invoice", () => {
    const part = { ...bill, amount_paid: 18000 };
    expect(whatsappFor(part, "due", {}, "2026-11-15").bodyValues[2]).toBe("1,00,000");
  });

  it("writes the due date the way the templates were approved with", () => {
    expect(whatsappFor(bill, "due", {}, "2026-11-15").bodyValues[3]).toBe("10 Nov 2026");
  });

  it("counts the days overdue from the day it is sent", () => {
    expect(whatsappFor(bill, "overdue", {}, "2026-11-15").bodyValues[4]).toBe("5");
    expect(whatsappFor(bill, "overdue", {}, "2026-11-11").bodyValues[4]).toBe("1");
  });

  it("never says a bill is overdue by a negative number of days", () => {
    expect(whatsappFor(bill, "overdue", {}, "2026-11-01").bodyValues[4]).toBe("0");
  });

  it("leaves the days-overdue blank empty when the day is not known", () => {
    /* Empty, not papered over: the sender refuses a message with a hole in
       it rather than telling a customer their invoice is "a few" days
       overdue. The nightly job always knows the day, so this is the case
       where somebody called it wrong. */
    const wa = whatsappFor(bill, "overdue", {});
    expect(wa.bodyValues[4]).toBe("");
  });

  it("greets the person, then the company, then Sir/Madam", () => {
    expect(whatsappFor(bill, "due", {}, "2026-11-15").bodyValues[0]).toBe("Rahul Verma");
    expect(whatsappFor({ ...bill, contact_name: "" }, "due", {}, "2026-11-15").bodyValues[0])
      .toBe("Acme Infotech");
    expect(whatsappFor({ ...bill, contact_name: "", customer_name: "" }, "due", {}, "2026-11-15").bodyValues[0])
      .toBe("Sir/Madam");
  });

  it("still honours a template name somebody typed into settings", () => {
    const wa = whatsappFor(bill, "due", { waTemplates: { due: "our_own_thing" } }, "2026-11-15");
    expect(wa.templateName).toBe("our_own_thing");
    /* The old four values, because nothing here knows that template's wording. */
    expect(wa.bodyValues).toHaveLength(4);
    expect(wa.bodyValues[2]).toContain("₹");
  });

  it("leaves a bill with nothing on it showing empty blanks, for the sender to refuse", () => {
    /* Meta refuses an empty blank outright, and so does the sender, before
       it ever gets that far — `sendMessage` checks what is missing and
       writes the refusal into the customer's history instead of sending.
       Greeting and amount always have something; the rest do not. */
    const bare = { invoice_no: "", amount: 0, amount_paid: 0, due_date: "", contact_name: "", customer_name: "" };
    const wa = whatsappFor(bare, "due", {}, "2026-11-15");
    expect(wa.bodyValues[0]).toBe("Sir/Madam");
    expect(wa.bodyValues[1]).toBe("");
    expect(wa.bodyValues[3]).toBe("");
  });
});
