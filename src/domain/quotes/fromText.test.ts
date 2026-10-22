import { describe, expect, it } from "vitest";
import { draftFromText, matchCustomer, matchProduct } from "./fromText";
import type { Customer } from "../customers/customer";
import type { CatalogProduct } from "../catalog/types";

const customer = (id: string, company: string): Customer =>
  ({ id, ownerId: "u1", company, state: "Haryana" } as Customer);

const product = (over: Partial<CatalogProduct>): CatalogProduct => ({
  id: "p1", name: "Microsoft 365 Business Standard", publisher: "Microsoft",
  licenseType: "Subscription", productId: "CFQ7TTC0LDPB", skuId: "0002",
  termDuration: "P1Y", billingPlan: "Annual", segment: "Commercial",
  costPrice: 1000, sellPrice: 1200, hsn: "997331", unit: "Nos",
  active: true, createdAt: 0, updatedAt: 0, ...over,
});

const ctx = (over: Partial<Parameters<typeof draftFromText>[1]> = {}) => ({
  settings: { defaultGst: 18, company: { name: "TechZoid", state: "Delhi" } },
  user: { id: "u1", name: "Abhinav" },
  customers: [customer("c1", "ACME Infotech Private Limited")],
  catalog: [product({})],
  ...over,
});

describe("matching a dictated company to a customer", () => {
  it("lands a short name on the full one", () => {
    expect(matchCustomer("ACME", [customer("c1", "ACME Infotech Private Limited")])?.id).toBe("c1");
  });

  it("ignores punctuation and case", () => {
    expect(matchCustomer("acme infotech pvt. ltd", [customer("c1", "ACME Infotech Pvt Ltd")])?.id).toBe("c1");
  });

  it("refuses to choose when two customers could be meant", () => {
    /* Quoting the wrong company is worse than asking which one. */
    const two = [customer("c1", "ACME Infotech"), customer("c2", "ACME Logistics")];
    expect(matchCustomer("ACME", two)).toBeNull();
  });

  it("is null for a company nobody has on file", () => {
    expect(matchCustomer("Nobody Ltd", [customer("c1", "ACME Infotech")])).toBeNull();
  });
});

describe("matching a dictated product to the catalog", () => {
  it("matches a partial product name", () => {
    expect(matchProduct("M365 Business Standard", [product({ name: "M365 Business Standard" })])?.id).toBe("p1");
  });

  it("prefers an SKU written out over a name", () => {
    const list = [product({ id: "a", skuId: "0002" }), product({ id: "b", name: "0002 Something Else", skuId: "9999" })];
    expect(matchProduct("0002", list)?.id).toBe("a");
  });

  it("will not match an inactive product", () => {
    expect(matchProduct("Microsoft 365 Business Standard", [product({ active: false })])).toBeNull();
  });

  it("refuses an ambiguous name", () => {
    const two = [product({ id: "a", name: "Acrobat Pro" }), product({ id: "b", name: "Acrobat Pro DC" })];
    expect(matchProduct("Acrobat", two)).toBeNull();
  });
});

describe("building the draft", () => {
  it("fills the customer, the line and the quantity from one sentence", () => {
    const { doc, report } = draftFromText({
      customer: { company: "ACME" },
      items: [{ desc: "Microsoft 365 Business Standard", qty: 10, rate: 1200 }],
    }, ctx());

    expect(report.matchedCustomer?.id).toBe("c1");
    expect(doc.items).toHaveLength(1);
    expect(doc.items?.[0]?.qty).toBe(10);
    expect(doc.items?.[0]?.rate).toBe(1200);
  });

  it("takes the SKU, HSN and cost from the catalog and never from the sentence", () => {
    /* An HSN code invented from English is a wrong tax return, and a guessed
       cost silently misreports the margin on the whole deal. */
    const { doc } = draftFromText({
      items: [{ desc: "Microsoft 365 Business Standard", qty: 1, rate: 1500 }],
    }, ctx());
    const line = doc.items?.[0];
    expect(line?.hsn).toBe("997331");
    expect(line?.sku).toBe("0002");
    expect(line?.cost).toBe(1000);
    expect(line?.brand).toBe("Microsoft");
  });

  it("lets a price said out loud beat the catalog's", () => {
    const { doc, report } = draftFromText({
      items: [{ desc: "Microsoft 365 Business Standard", qty: 1, rate: 1150 }],
    }, ctx());
    expect(doc.items?.[0]?.rate).toBe(1150);
    expect(report.lines[0]?.priceFromText).toBe(true);
  });

  it("falls back to the catalog price when none was said", () => {
    const { doc, report } = draftFromText({
      items: [{ desc: "Microsoft 365 Business Standard", qty: 3 }],
    }, ctx());
    expect(doc.items?.[0]?.rate).toBe(1200);
    expect(report.lines[0]?.priceFromText).toBe(false);
    expect(report.lines[0]?.needsPrice).toBe(false);
  });

  it("flags a line with no price anywhere rather than inventing one", () => {
    const { doc, report } = draftFromText({
      items: [{ desc: "Some bespoke integration work", qty: 1 }],
    }, ctx());
    expect(report.lines[0]?.needsPrice).toBe(true);
    expect(report.lines[0]?.matchedProduct).toBeNull();
    expect(doc.items?.[0]?.rate).toBe("");
  });

  it("does not invent a customer record for a company nobody has", () => {
    /* It fills what was dictated so a person can see it and decide. Filing a
       customer from a sentence with a typo in it creates a duplicate that
       outlives the quotation. */
    const { doc, report } = draftFromText({
      customer: { company: "Brand New Buyer Ltd", contact: "Rahul", email: "rahul@example.com" },
      items: [{ desc: "Microsoft 365 Business Standard", qty: 1 }],
    }, ctx());
    expect(report.matchedCustomer).toBeNull();
    expect(report.unmatchedCustomerName).toBe("Brand New Buyer Ltd");
    expect(doc.customerId).toBeFalsy();
    expect(doc.billName).toBe("Brand New Buyer Ltd");
    expect(doc.billContact).toBe("Rahul");
  });

  it("starts as a draft that has not been saved or sent", () => {
    const { doc } = draftFromText({ items: [{ desc: "x", qty: 1, rate: 1 }] }, ctx());
    expect(doc.status).toBe("Draft");
  });

  it("uses the workspace's default tax rate unless one was said", () => {
    const spoken = draftFromText({ items: [{ desc: "x", qty: 1, rate: 1, taxPercent: 5 }] }, ctx());
    expect(spoken.doc.items?.[0]?.gst).toBe(5);
    const silent = draftFromText({ items: [{ desc: "x", qty: 1, rate: 1 }] }, ctx());
    expect(silent.doc.items?.[0]?.gst).toBe(18);
  });

  it("reads prices written the way people write them", () => {
    const { doc } = draftFromText({
      items: [{ desc: "x", qty: 2, rate: "1,18,000.50" as unknown as number }],
    }, ctx());
    expect(doc.items?.[0]?.rate).toBe(118000.5);
  });

  it("produces an empty quotation rather than throwing on an empty reading", () => {
    const { doc, report } = draftFromText({}, ctx());
    expect(doc.status).toBe("Draft");
    expect(report.lines).toEqual([]);
  });
});
