import { describe, expect, it } from "vitest";
import { draftFromText } from "./fromText";
import type { Customer } from "../customers/customer";
import type { CatalogProduct } from "../catalog/types";

/**
 * Real readings, kept.
 *
 * Every payload below came back from the live model for the sentence above
 * it, using the deployed system prompt and tool schema. They are here
 * because the interesting failures are not in code that can be reasoned
 * about — they are in what the model does with "for 12,000 total" versus
 * "at 1,450 each", and the only way to know that is to ask it and write
 * down the answer.
 *
 * These pin the HANDOFF: given what the model really returns, the draft
 * comes out right. If the prompt is reworded or the model moves, re-run the
 * sentences and update the payloads deliberately — do not loosen the
 * expectations to make them pass.
 */

const customers: Customer[] = [
  { id: "c1", ownerId: "u1", company: "ACME Infotech Private Limited" } as Customer,
  { id: "c2", ownerId: "u1", company: "Orient Bell Limited" } as Customer,
];

const catalog: CatalogProduct[] = [{
  id: "p1", name: "Microsoft 365 Business Standard", publisher: "Microsoft",
  licenseType: "Subscription", productId: "CFQ7TTC0LDPB", skuId: "0002",
  termDuration: "P1Y", billingPlan: "Annual", segment: "Commercial",
  costPrice: 980, sellPrice: 1250, hsn: "997331", unit: "Nos",
  active: true, createdAt: 0, updatedAt: 0,
}];

const ctx = {
  settings: { defaultGst: 18, defaultValidityDays: 15, company: { name: "TechZoid" } },
  user: { id: "u1", name: "Abhinav" },
  customers,
  catalog,
  today: "2026-01-01",
};

describe("what the model really returns, turned into a draft", () => {
  it("splits a line total across the quantity, and leaves a per-unit price alone", () => {
    /* "10 licences of Microsoft 365 Business Standard for 12,000 total,
        plus 5 x Acrobat Pro at 1,450 each, valid 30 days, GST 18%" */
    const { doc, report } = draftFromText({
      is_quote_request: true,
      customer: { company: "ACME Infotech" },
      items: [
        { desc: "Microsoft 365 Business Standard", qty: 10, rate: 1200, unit: "licence", taxPercent: 18 },
        { desc: "Acrobat Pro", qty: 5, rate: 1450, unit: "licence", taxPercent: 18 },
      ],
      validityDays: 30,
    } as never, ctx);

    expect(report.matchedCustomer?.id).toBe("c1");
    expect(doc.items?.[0]?.rate).toBe(1200);
    expect(doc.items?.[1]?.rate).toBe(1450);
    expect(doc.validUntil).toBe("2026-01-31");

    /* The catalog line carries the SKU and the cost; the one that is not in
       the catalog carries neither, and is not invented. */
    expect(doc.items?.[0]?.sku).toBe("0002");
    expect(doc.items?.[0]?.cost).toBe(980);
    expect(doc.items?.[1]?.sku).toBe("");
    expect(doc.items?.[1]?.cost).toBeUndefined();
  });

  it("reads Indian digit grouping as written", () => {
    /* "2 Dell servers, 1,18,000 each, 45 days validity" */
    const { doc } = draftFromText({
      is_quote_request: true,
      customer: { company: "Orient Bell" },
      items: [{ desc: "Dell servers", qty: 2, rate: 118000 }],
      validityDays: 45,
    } as never, ctx);
    expect(doc.items?.[0]?.rate).toBe(118000);
    expect(doc.validUntil).toBe("2026-02-15");
  });

  it("flags 'price on request' instead of quoting zero", () => {
    /* "25 seats of Teams Phone, price on request" — the model correctly
       returns no rate. Before the number reader was fixed this became a
       rate of 0, and a quotation giving 25 seats away reads exactly like
       one that does not. */
    const { doc, report } = draftFromText({
      is_quote_request: true,
      customer: { company: "CARPL.AI" },
      items: [{ desc: "Teams Phone", qty: 25, unit: "seats" }],
    } as never, ctx);
    expect(report.lines[0]?.needsPrice).toBe(true);
    expect(doc.items?.[0]?.rate).toBe("");
    expect(doc.items?.[0]?.qty).toBe(25);
  });

  it("keeps a contact named alongside the company, without filing a customer", () => {
    /* "Suvidha Garg at Orient Bell Limited, 3 lakh worth of Autodesk AutoCAD" */
    const { doc, report } = draftFromText({
      is_quote_request: true,
      customer: { company: "Orient Bell Limited", contact: "Suvidha Garg" },
      items: [{ desc: "Autodesk AutoCAD 1 year sub", rate: 300000 }],
    } as never, ctx);
    expect(report.matchedCustomer?.id).toBe("c2");
    /* Quantity was not stated, so it is one — and one at three lakh is three
       lakh, which is what "3 lakh worth of" means. */
    expect(doc.items?.[0]?.qty).toBe(1);
    expect(doc.items?.[0]?.rate).toBe(300000);
  });
});
