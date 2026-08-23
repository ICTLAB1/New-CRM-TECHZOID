import { describe, expect, it } from "vitest";
import {
  applyCustomer, CARRIED_FIELDS, CUSTOMER_DERIVED_FIELDS, documentFieldsFrom,
  duplicateQuotation, effectiveStatus, newQuotation,
  proformaFromQuotation, taxTypeFor, type DocSettings, type SalesDocument,
} from "./create";
import { blankCustomer, type Customer } from "../customers/customer";

const SETTINGS: DocSettings = {
  quotePrefix: "TZ/QT", quoteSeq: 7,
  proformaPrefix: "TZ/PI", proformaSeq: 3,
  defaultCurrency: "INR", defaultTaxType: "gst", defaultGst: 18, defaultValidityDays: 15,
};
const USER = { id: "u1", name: "Priyanshi Sharma" };
const TODAY = "2026-08-24";

const domestic = (o: Partial<Customer> = {}): Customer => ({
  ...blankCustomer("u-owner", "c1"),
  company: "Acme Industries Pvt Ltd", contact: "Rajesh Kumar",
  address: "12 Industrial Area", city: "New Delhi", pincode: "110034",
  state: "Delhi", country: "India",
  gstin: "07AAPFU0939F1ZX", pan: "AAPFU0939F",
  email: "rajesh@acme.in", phone: "+91 98100 12345",
  currency: "INR", taxType: "gst", ...o,
});

const foreign = (): Customer => domestic({
  company: "Gulf Marine Services FZ-LLC", country: "United Arab Emirates",
  state: "", gstin: "", pan: "", currency: "AED", taxType: "none",
});

describe("customer to document", () => {
  it("carries every field on the list", () => {
    const fields = documentFieldsFrom(domestic(), SETTINGS);
    for (const key of CUSTOMER_DERIVED_FIELDS) {
      expect(fields, key).toHaveProperty(key);
    }
  });

  it("carries the four fields v1 dropped", () => {
    // billCountry, billPan, currency and taxType were lost by the customer
    // picker — and again, separately, by proforma generation.
    const fields = documentFieldsFrom(foreign(), SETTINGS);
    expect(fields.billCountry).toBe("United Arab Emirates");
    expect(fields.currency).toBe("AED");
    expect(fields.taxType).toBe("none");
    expect(documentFieldsFrom(domestic(), SETTINGS).billPan).toBe("AAPFU0939F");
  });

  it("builds the address from the parts the customer record holds", () => {
    expect(documentFieldsFrom(domestic(), SETTINGS).billAddress).toBe("12 Industrial Area, New Delhi, 110034");
  });

  it("moves ownership to the customer's owner", () => {
    expect(documentFieldsFrom(domestic(), SETTINGS).ownerId).toBe("u-owner");
  });

  it("falls back to settings defaults with no customer", () => {
    const fields = documentFieldsFrom(null, SETTINGS);
    expect(fields).toMatchObject({ currency: "INR", taxType: "gst", billCountry: "India", billState: "Delhi" });
  });
});

describe("tax regime for a customer", () => {
  it("uses the customer's own setting first", () => {
    expect(taxTypeFor(domestic({ taxType: "vat" }), SETTINGS)).toBe("vat");
  });

  it("exempts an export, because GST cannot apply to one", () => {
    expect(taxTypeFor(domestic({ country: "Singapore", taxType: "" }), SETTINGS)).toBe("none");
  });

  it("uses the configured default at home", () => {
    expect(taxTypeFor(domestic({ taxType: "" }), SETTINGS)).toBe("gst");
  });
});

describe("applying a customer to an existing document", () => {
  it("sets every derived field", () => {
    // New documents are created with no customer and linked afterwards, so
    // this is the real entry point for these fields.
    const blank = newQuotation({ settings: SETTINGS, user: USER, today: TODAY });
    const linked = applyCustomer(blank, foreign(), SETTINGS);
    expect(linked.billCountry).toBe("United Arab Emirates");
    expect(linked.currency).toBe("AED");
    expect(linked.taxType).toBe("none");
    expect(linked.billName).toBe("Gulf Marine Services FZ-LLC");
  });

  it("leaves everything else untouched", () => {
    const q = newQuotation({ settings: SETTINGS, user: USER, today: TODAY });
    const edited = { ...q, subject: "Custom subject", referenceNo: "PO/123", items: [] };
    const linked = applyCustomer(edited, domestic(), SETTINGS);
    expect(linked.subject).toBe("Custom subject");
    expect(linked.referenceNo).toBe("PO/123");
    expect(linked.number).toBe(q.number);
  });

  it("clears the link when the customer is removed", () => {
    const q = applyCustomer(newQuotation({ settings: SETTINGS, user: USER }), domestic(), SETTINGS);
    expect(applyCustomer(q, null, SETTINGS).customerId).toBe("");
  });
});

describe("new quotation", () => {
  const q = newQuotation({ settings: SETTINGS, user: USER, customer: domestic(), today: TODAY });

  it("numbers from the configured prefix and sequence", () => {
    expect(q.number).toBe("TZ/QT/2627/0007");
  });

  it("starts as a draft, valid for the configured period", () => {
    expect(q.status).toBe("Draft");
    expect(q.date).toBe(TODAY);
    expect(q.validUntil).toBe("2026-09-08");
  });

  it("opens with one empty line at the default tax rate", () => {
    expect(q.items).toHaveLength(1);
    expect(q.items[0]?.gst).toBe(18);
  });

  it("uses domestic terms for an Indian customer", () => {
    expect(q.terms[0]).toContain("valid for 30 days");
  });

  it("uses export terms for a customer outside India", () => {
    // An export quotation carrying GST clauses and Indian jurisdiction is a
    // real commercial problem, not a cosmetic one.
    const e = newQuotation({ settings: SETTINGS, user: USER, customer: foreign(), today: TODAY });
    expect(e.terms.join(" ")).toContain("Incoterms 2020");
    expect(e.terms.join(" ")).not.toContain("CGST");
  });

  it("records who prepared it", () => {
    expect(q.preparedBy).toBe("Priyanshi Sharma");
  });
});

describe("proforma from a quotation", () => {
  const quote: SalesDocument = {
    ...newQuotation({ settings: SETTINGS, user: USER, customer: foreign(), today: TODAY }),
    shipSameAsBilling: false,
    shipName: "Gulf Marine Warehouse", shipAddress: "Plot 9, Free Zone",
    shipState: "Ajman", shipCountry: "United Arab Emirates",
    shipContact: "Omar", shipPhone: "+971 50 123 4567", shipEmail: "omar@gulf.ae",
    shipGstin: "", shipPan: "",
    referenceNo: "PO/GM/2026/12", enquiryRef: "ENQ-99", customerCode: "CUST-000123",
    subject: "Marine IT refresh", status: "Accepted", roundOff: false,
  };
  const pf = proformaFromQuotation(quote, SETTINGS, USER, TODAY);

  it("carries EVERY field on the carried list", () => {
    // This is the test that would have caught hard-won detail #4.
    for (const key of CARRIED_FIELDS) {
      expect(pf[key], key).toEqual(quote[key]);
    }
  });

  it("carries the four fields v1 dropped, and all the shipping ones", () => {
    expect(pf.billCountry).toBe("United Arab Emirates");
    expect(pf.billPan).toBe(quote.billPan);
    expect(pf.currency).toBe("AED");
    expect(pf.taxType).toBe("none");
    expect(pf.shipName).toBe("Gulf Marine Warehouse");
    expect(pf.shipState).toBe("Ajman");
    expect(pf.shipEmail).toBe("omar@gulf.ae");
    expect(pf.shipSameAsBilling).toBe(false);
  });

  it("takes a fresh proforma number and keeps the link back", () => {
    expect(pf.number).toBe("TZ/PI/2627/0003");
    expect(pf.quoteId).toBe(quote.id);
    expect(pf.quoteNumber).toBe(quote.number);
    expect(pf.id).not.toBe(quote.id);
  });

  it("starts as a draft, whatever the quotation's status was", () => {
    expect(pf.status).toBe("Draft");
  });

  it("copies the line items with fresh ids, so editing one does not edit both", () => {
    expect(pf.items.map((i) => i.desc)).toEqual(quote.items.map((i) => i.desc));
    expect(pf.items[0]?.id).not.toBe(quote.items[0]?.id);
  });

  it("opens an empty payment ledger", () => {
    expect(pf.paymentHistory).toEqual([]);
    expect(pf.advancePercent).toBe(100);
  });
});

describe("duplicating a quotation", () => {
  const quote = {
    ...newQuotation({ settings: SETTINGS, user: USER, customer: domestic(), today: "2026-01-01" }),
    status: "Accepted", revisionNo: 3, referenceNo: "PO/9",
  };
  const copy = duplicateQuotation(quote, SETTINGS, TODAY);

  it("takes a fresh number", () => {
    // Two live documents claiming to be the same one is worse than no copy.
    expect(copy.number).toBe("TZ/QT/2627/0007");
    expect(copy.id).not.toBe(quote.id);
  });

  it("resets to Draft", () => {
    // Copying "Accepted" would claim the customer accepted something they
    // have never seen.
    expect(copy.status).toBe("Draft");
    expect(copy.revisionNo).toBe(0);
  });

  it("refreshes the dates", () => {
    expect(copy.date).toBe(TODAY);
    expect(copy.validUntil).toBe("2026-09-08");
  });

  it("keeps every party, shipping and commercial field", () => {
    for (const key of CARRIED_FIELDS) {
      expect(copy[key], key).toEqual(quote[key]);
    }
  });

  it("copies items with fresh ids", () => {
    expect(copy.items[0]?.id).not.toBe(quote.items[0]?.id);
  });
});

describe("the carried field list", () => {
  it("covers every party and shipping field a document has", () => {
    // The guard: a new field added to the document must be considered here,
    // not silently dropped by conversion. If this fails, add the field to
    // CARRIED_FIELDS or state why it should not carry.
    const q = newQuotation({ settings: SETTINGS, user: USER, customer: domestic() });
    const partyFields = Object.keys(q).filter((k) => /^(bill|ship)/.test(k));
    for (const key of partyFields) {
      expect(CARRIED_FIELDS as readonly string[], key).toContain(key);
    }
    for (const key of ["currency", "taxType", "customerId"]) {
      expect(CARRIED_FIELDS as readonly string[], key).toContain(key);
    }
  });

  it("does not carry anything that must be fresh", () => {
    for (const key of ["id", "number", "status", "date", "validUntil", "createdAt", "revisionNo"]) {
      expect(CARRIED_FIELDS as readonly string[], key).not.toContain(key);
    }
  });
});

describe("effective status", () => {
  it("reads a sent quotation past its validity as expired", () => {
    expect(effectiveStatus({ status: "Sent", validUntil: "2026-08-01" }, TODAY)).toBe("Expired");
  });

  it("leaves an accepted quotation alone, however old", () => {
    expect(effectiveStatus({ status: "Accepted", validUntil: "2020-01-01" }, TODAY)).toBe("Accepted");
  });

  it("leaves a draft alone — it was never sent to anyone", () => {
    expect(effectiveStatus({ status: "Draft", validUntil: "2020-01-01" }, TODAY)).toBe("Draft");
  });

  it("does not expire on the validity date itself", () => {
    expect(effectiveStatus({ status: "Sent", validUntil: TODAY }, TODAY)).toBe("Sent");
  });
});
