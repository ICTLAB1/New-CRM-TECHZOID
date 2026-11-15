import { describe, expect, it } from "vitest";
import { checkRecordType, daysBetween, factsFor, nameOf } from "./whatsappFacts.mjs";
import { buildParams } from "./whatsappTemplates.mjs";

const customer = { id: "c1", data: { company: "Acme Industries", contact: "Ravi Sharma", email: "ravi@acme.example" } };

/** What the whole chain produces: record in, the five strings Meta gets out. */
const sent = (template, args) => buildParams(template, factsFor(template, args)).values;

describe("a quotation", () => {
  const record = {
    id: "q1", number: "TZ/Q/26-27/0042", customer_id: "c1",
    data: {
      number: "TZ/Q/26-27/0042", date: "2026-11-10", sentAt: "2026-11-12", validUntil: "2026-11-22",
      items: [{ desc: "Microsoft 365 E3", qty: 10 }, { desc: "Visio Plan 2", qty: 2 }],
    },
  };

  it("tells the customer what was quoted and until when", () => {
    expect(sent("quotation_sent", { record, customer }))
      .toEqual(["Ravi Sharma", "TZ/Q/26-27/0042", "Microsoft 365 E3 ×10, Visio Plan 2 ×2", "22 Nov 2026"]);
  });

  it("chases it with the day it was SENT, not the day it was typed", () => {
    /* "I sent you this on the 12th" is about the conversation. The 10th is
       when somebody started writing it, which the customer never saw. */
    expect(sent("quotation_followup", { record, customer })[3]).toBe("12 Nov 2026");
  });

  it("falls back to the document date when it was never recorded as sent", () => {
    const never = { ...record, data: { ...record.data, sentAt: "" } };
    expect(sent("quotation_followup", { record: never, customer })[3]).toBe("10 Nov 2026");
  });
});

describe("an order", () => {
  const record = {
    id: "o1", number: "TZ/SO/26-27/0007", customer_id: "c1",
    data: { number: "TZ/SO/26-27/0007", items: [{ desc: "Dell Latitude 5450", qty: 4 }], deliveredOn: "2026-11-15" },
  };

  it("says what was delivered and when", () => {
    expect(sent("order_delivered", { record, customer }))
      .toEqual(["Ravi Sharma", "TZ/SO/26-27/0007", "Dell Latitude 5450 ×4", "15 Nov 2026"]);
  });

  it("uses today when the record does not say when it went", () => {
    const undated = { ...record, data: { ...record.data, deliveredOn: "" } };
    expect(sent("order_delivered", { record: undated, customer, extra: { today: "2026-11-16" } })[3])
      .toBe("16 Nov 2026");
  });

  it("says where the licence keys were emailed", () => {
    const values = sent("licence_delivered", { record, customer, extra: { sentTo: "it@acme.example" } });
    expect(values[3]).toBe("it@acme.example");
  });

  it("falls back to the customer's own address for the keys", () => {
    expect(sent("licence_delivered", { record, customer })[3]).toBe("ravi@acme.example");
  });
});

describe("a payment", () => {
  const bill = {
    id: "b1", invoice_no: "TZ/INV/26-27/0042", customer_name: "Acme Industries",
    due_date: "2026-11-15", amount: 118000, amount_paid: 0, customer_id: "c1",
  };

  it("asks for what is still owed, not the invoice total", () => {
    /* A customer who has paid half must be chased for the half. */
    const part = { ...bill, amount_paid: 48000 };
    expect(sent("payment_due_reminder", { record: part, customer })[2]).toBe("70,000");
  });

  it("writes the amount the Indian way", () => {
    expect(sent("payment_due_reminder", { record: bill, customer }))
      .toEqual(["Ravi Sharma", "TZ/INV/26-27/0042", "1,18,000", "15 Nov 2026"]);
  });

  it("counts the days overdue from the due date", () => {
    const values = sent("payment_overdue_reminder", { record: bill, customer, extra: { today: "2026-11-23" } });
    expect(values[4]).toBe("8");
  });

  it("thanks them for what they actually paid, against the right invoice", () => {
    expect(sent("payment_received", { record: bill, customer, extra: { amount: 118000 } }))
      .toEqual(["Ravi Sharma", "1,18,000", "invoice TZ/INV/26-27/0042"]);
  });

  it("can be told it was against an order instead", () => {
    expect(sent("payment_received", { record: bill, customer, extra: { amount: 50000, against: "order TZ/SO/0007" } })[2])
      .toBe("order TZ/SO/0007");
  });
});

describe("a renewal", () => {
  const sub = { id: "s1", customer_id: "c1", data: { product: "Microsoft 365 E3", expiryDate: "2026-12-15" } };

  it("names the product and the date it runs out", () => {
    expect(sent("renewal_reminder", { record: sub, customer }))
      .toEqual(["Ravi Sharma", "Microsoft 365 E3", "15 Dec 2026"]);
  });

  it("falls back to the vendor when no product was typed", () => {
    const vague = { ...sub, data: { vendor: "Microsoft", expiryDate: "2026-12-15" } };
    expect(sent("renewal_reminder", { record: vague, customer })[1]).toBe("Microsoft");
  });
});

describe("a record with holes in it", () => {
  it("still produces a sendable message", () => {
    const values = sent("quotation_sent", { record: { id: "q", data: {} }, customer: null });
    expect(values).toHaveLength(4);
    for (const v of values) expect(String(v).trim()).not.toBe("");
  });

  it("reports which facts were missing, so a preview can say so", () => {
    const { missing } = buildParams("quotation_sent", factsFor("quotation_sent", { record: { data: {} } }));
    expect(missing).toContain("quoteNo");
    expect(missing).toContain("customer");
  });
});

describe("who the customer is", () => {
  it("prefers the person, then the company", () => {
    expect(nameOf(customer)).toBe("Ravi Sharma");
    expect(nameOf({ data: { company: "Acme Industries" } })).toBe("Acme Industries");
    expect(nameOf({ customer_name: "Beta Ltd" })).toBe("Beta Ltd");
    expect(nameOf(null)).toBe("");
  });
});

describe("days between two dates", () => {
  it("counts forward from the due date", () => {
    expect(daysBetween("2026-11-15", "2026-11-23")).toBe(8);
    expect(daysBetween("2026-11-15", "2026-11-15")).toBe(0);
    expect(daysBetween("2026-11-15", "2026-11-12")).toBe(-3);
  });

  it("counts across a month end and a leap day", () => {
    expect(daysBetween("2026-01-30", "2026-02-02")).toBe(3);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("is not thrown by rubbish", () => {
    expect(daysBetween("", "2026-11-15")).toBe(0);
    expect(daysBetween("nonsense", "2026-11-15")).toBe(0);
  });
});

describe("asking for the wrong kind of record", () => {
  it("refuses a payment reminder about a quotation", () => {
    expect(checkRecordType("payment_due_reminder", "quote")).toMatch(/sent about a bill/);
  });

  it("allows the right one, and an unspecified one", () => {
    expect(checkRecordType("payment_due_reminder", "bill")).toBe("");
    expect(checkRecordType("payment_due_reminder", "")).toBe("");
  });

  it("refuses a template that does not exist", () => {
    expect(checkRecordType("made_up", "bill")).toMatch(/no WhatsApp template/);
  });
});
