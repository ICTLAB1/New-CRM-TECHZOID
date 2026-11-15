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

  it("falls back to the template's own words when the day is not known", () => {
    const wa = whatsappFor(bill, "overdue", {});
    expect(wa.bodyValues[4]).toBe(TEMPLATES.payment_overdue_reminder.params[4].fallback);
    expect(wa.bodyValues[4]).not.toBe("");
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

  it("leaves no blank empty, which Meta refuses", () => {
    const bare = { invoice_no: "", amount: 0, amount_paid: 0, due_date: "", contact_name: "", customer_name: "" };
    for (const tone of Object.keys(DEFAULT_TEMPLATES)) {
      for (const v of whatsappFor(bare, tone, {}, "2026-11-15").bodyValues) {
        expect(String(v).trim(), `${tone}`).not.toBe("");
      }
    }
  });
});
