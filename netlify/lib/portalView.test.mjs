import { describe, expect, it } from "vitest";
import {
  isVisibleToCustomer, publicCompany, publicCustomer, publicDocument,
} from "./portalView.mjs";

/**
 * The portal is the only surface in this product where a stranger with a URL
 * reads out of the database. These tests are the fence around it, and they are
 * written to fail when somebody ADDS something, not only when somebody breaks
 * something — because the realistic accident is a new field riding out on a
 * payload nobody re-read.
 */

/* A row with everything a real one carries, plus the things that must never
   leave. The numbers are distinctive so a leak is greppable rather than
   arguable. */
const QUOTE_ROW = {
  id: "q1",
  owner_id: "11111111-1111-1111-1111-111111111111",
  customer_id: "c1",
  data: {
    number: "TTPL/Q/25-26/0042",
    status: "Sent",
    date: "2026-03-01",
    validUntil: "2026-03-15",
    subject: "Microsoft 365 E3 — 40 seats",
    currency: "INR",
    preparedBy: "Abhinav",
    items: [
      { id: "i1", desc: "Microsoft 365 E3", sku: "AAA-11111", qty: 40, rate: 3100, gst: 18, cost: 2750 },
      { id: "i2", desc: "Dell Latitude 5450", qty: 2, rate: 71000, gst: 18, cost: 68500 },
    ],
    terms: ["Payment 30 days from invoice."],
    paymentHistory: [
      { date: "2026-03-04", amount: 500000, mode: "NEFT", reference: "UTR8891", note: "cheque bounced first time, chasing" },
    ],
    /* The internal ones. */
    ownerId: "11111111-1111-1111-1111-111111111111",
    margin: 41200,
    internalNotes: "they will pay more, quoted low to win volume",
  },
};

describe("what a customer may see on a document", () => {
  const out = publicDocument("quotation", QUOTE_ROW);

  it("shows the document as it was printed", () => {
    expect(out.number).toBe("TTPL/Q/25-26/0042");
    expect(out.items).toHaveLength(2);
    expect(out.items[0].desc).toBe("Microsoft 365 E3");
    expect(out.items[0].rate).toBe(3100);
    expect(out.terms).toEqual(["Payment 30 days from invoice."]);
  });

  it("NEVER carries what a line cost us", () => {
    for (const line of out.items) {
      expect(line).not.toHaveProperty("cost");
    }
    expect(JSON.stringify(out)).not.toContain("2750");
    expect(JSON.stringify(out)).not.toContain("68500");
  });

  it("shows a payment back, without the remark beside it", () => {
    expect(out.payments[0].amount).toBe(500000);
    expect(out.payments[0].reference).toBe("UTR8891");
    expect(JSON.stringify(out)).not.toContain("chasing");
  });

  it("drops every internal field on the row, named or not", () => {
    const json = JSON.stringify(out);
    for (const secret of ["margin", "internalNotes", "ownerId", "owner_id", "quoted low"]) {
      expect(json).not.toContain(secret);
    }
  });

  /* THE DRIFT GUARD. Everything above tests a field somebody thought of. This
     one fails on a field nobody thought of: the shape of the output is pinned,
     so adding to it is a deliberate act with a test to update, and adding to
     the stored document is not. */
  it("has exactly this shape, and gaining a field is a decision", () => {
    expect(Object.keys(out).sort()).toEqual([
      "advancePercent", "currency", "date", "deliveryTerms", "footer", "id",
      "intro", "items", "kind", "number", "payments", "paymentTerms",
      "preparedBy", "referenceNo", "roundOff", "status", "subject", "taxType",
      "terms", "updatedAt", "validUntil",
    ].sort());
    expect(Object.keys(out.items[0]).sort()).toEqual([
      "brand", "desc", "disc", "gst", "hsn", "id", "qty", "rate", "sku", "subDesc", "unit",
    ].sort());
    expect(Object.keys(out.payments[0]).sort()).toEqual(
      ["amount", "date", "mode", "reference"].sort(),
    );
  });

  it("survives a document with nothing in it", () => {
    const empty = publicDocument("quotation", {});
    expect(empty.items).toEqual([]);
    expect(empty.currency).toBe("INR");
    expect(empty.number).toBe("");
  });
});

describe("which documents a customer may see at all", () => {
  it("never a draft", () => {
    expect(isVisibleToCustomer("quotation", "Draft")).toBe(false);
    expect(isVisibleToCustomer("proforma", "Draft")).toBe(false);
    expect(isVisibleToCustomer("invoice", "Draft")).toBe(false);
  });

  it("shows what was actually sent to them", () => {
    expect(isVisibleToCustomer("quotation", "Sent")).toBe(true);
    expect(isVisibleToCustomer("quotation", "Accepted")).toBe(true);
    expect(isVisibleToCustomer("proforma", "Paid")).toBe(true);
    expect(isVisibleToCustomer("invoice", "Issued")).toBe(true);
  });

  it("reads a status however it was cased or spaced", () => {
    expect(isVisibleToCustomer("quotation", " sent ")).toBe(true);
  });

  /* A purchase order is what WE send a distributor. It carries our buying
     price on its face, so there is no redaction that makes it safe — it is
     simply not a kind the portal knows about. */
  it("does not know what a purchase order is", () => {
    expect(isVisibleToCustomer("purchase_order", "Sent")).toBe(false);
    expect(isVisibleToCustomer("purchaseOrder", "Ordered")).toBe(false);
  });

  it("says no to a status it has never heard of", () => {
    expect(isVisibleToCustomer("quotation", undefined)).toBe(false);
    expect(isVisibleToCustomer("quotation", "Superseded")).toBe(false);
  });
});

describe("what a customer may see about themselves and about us", () => {
  it("shows their own details and nothing about the account", () => {
    const out = publicCustomer({
      data: {
        code: "CUST-000124", company: "Acme Pvt Ltd", email: "ravi@acme.in",
        gstin: "07AABCU9603R1ZX",
        ownerId: "11111111-1111-1111-1111-111111111111",
        stage: "negotiation", value: 2200000, source: "cold call",
        notes: [{ text: "budget approved, push before quarter end" }],
      },
    });
    expect(out.company).toBe("Acme Pvt Ltd");
    expect(out.code).toBe("CUST-000124");
    const json = JSON.stringify(out);
    for (const internal of ["negotiation", "2200000", "cold call", "quarter end", "ownerId"]) {
      expect(json).not.toContain(internal);
    }
  });

  it("shows the letterhead and not the safe behind it", () => {
    const out = publicCompany({
      data: {
        company: { name: "TechZoid Technologies", website: "techzoid.in" },
        logo: "data:image/png;base64,AAAA",
        bankAccounts: [{ name: "HDFC Current", number: "50200012345678", ifsc: "HDFC0000123" }],
        interaktApiKey: "secret-key-value",
        customerSeq: 124,
      },
    });
    expect(out.name).toBe("TechZoid Technologies");
    const json = JSON.stringify(out);
    for (const secret of ["50200012345678", "HDFC0000123", "secret-key-value", "customerSeq"]) {
      expect(json).not.toContain(secret);
    }
  });
});
