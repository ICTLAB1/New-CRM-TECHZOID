import { describe, expect, it } from "vitest";
import { newPurchaseOrder } from "./create";
import { buildDocumentModel } from "./model";
import { DEFAULT_DOC_TEMPLATE } from "./template";
import { PURCHASE_ORDER_TERMS } from "./terms";
import { computeDocument } from "../tax/compute";
import type { Customer } from "../customers/customer";

/**
 * A purchase order faces the opposite way from a quotation: the company is
 * the buyer. Everything here guards that one fact, because the ways it goes
 * wrong all look plausible on screen — the customer's name in the box that
 * says who pays the supplier, or a quotation's seller-side disclaimers on a
 * document meant to bind a distributor.
 */

const SETTINGS = {
  company: {
    name: "TechZoid Technologies Private Limited",
    address: "407 Pearl Business Park", city: "New Delhi", state: "Delhi", pincode: "110034",
    gstin: "07AAGCT9158R1Z0", pan: "AAGCT9158R", cin: "U72900DL2016PTC302635",
    phone: "+91 97114 92098", email: "sales@techzoidtechnologies.com",
  },
  purchaseOrderPrefix: "TZ/PO",
  purchaseOrderSeq: 7,
  defaultGst: 18,
};

const USER = { id: "u1", name: "Abhinav Jain" };

const CUSTOMER: Customer = {
  id: "c1", ownerId: "u9", company: "Acme Manufacturing India Pvt Ltd",
  contact: "Rajesh Kumar", email: "rajesh@acme.co.in", phone: "+91 98100 12345",
  address: "Plot 88, Sector 63", city: "Noida", state: "Uttar Pradesh", country: "India",
  gstin: "09AABCA1234A1Z5", pan: "AABCA1234A",
};

const build = (doc: Record<string, unknown>, settings: Record<string, unknown> = SETTINGS) => {
  const totals = computeDocument({ ...doc, billState: doc.vendorState as string }, "Delhi");
  return buildDocumentModel({
    doc, settings, totals, docType: "purchase_order",
    template: DEFAULT_DOC_TEMPLATE,
    bankAccount: { name: "HDFC Bank Ltd", account: "50200058982457", ifsc: "HDFC0000331" },
  });
};

describe("raising a purchase order", () => {
  it("numbers from its own prefix and sequence, not the quotation's", () => {
    const po = newPurchaseOrder({ settings: SETTINGS, user: USER, today: "2026-08-24" });
    expect(po.number).toBe("TZ/PO/2026-27/0007");
  });

  it("carries the buyer-side terms, not the quotation's seller-side ones", () => {
    const po = newPurchaseOrder({ settings: SETTINGS, user: USER, today: "2026-08-24" });
    expect(po.terms).toEqual([...PURCHASE_ORDER_TERMS]);
    /* The quotation set disclaims what the company promises. On a purchase
       order that would disclaim the supplier's obligations to us. */
    expect(po.terms.join(" ")).not.toContain("Quotation is valid for 30 days");
  });

  it("leaves the billing party empty — on a purchase order that party is us", () => {
    const po = newPurchaseOrder({ settings: SETTINGS, user: USER, customer: CUSTOMER, today: "2026-08-24" });
    expect(po.billName).toBe("");
    expect(po.billGstin).toBe("");
  });

  it("takes only the shipping details from a drop-ship customer", () => {
    // The failure this prevents: the customer's name appearing in the box
    // that tells a distributor who is paying them.
    const po = newPurchaseOrder({ settings: SETTINGS, user: USER, customer: CUSTOMER, today: "2026-08-24" });
    expect(po.shipName).toBe("Acme Manufacturing India Pvt Ltd");
    expect(po.shipState).toBe("Uttar Pradesh");
    expect(po.shipSameAsBilling).toBe(false);
    expect(po.customerId).toBe("c1");
    expect(po.billName).toBe("");
  });

  it("ships to our own address when no customer is chosen", () => {
    const po = newPurchaseOrder({ settings: SETTINGS, user: USER, today: "2026-08-24" });
    expect(po.shipSameAsBilling).toBe(true);
    expect(po.customerId).toBe("");
  });

  it("is owned by whoever raised it", () => {
    const po = newPurchaseOrder({ settings: SETTINGS, user: USER, customer: CUSTOMER, today: "2026-08-24" });
    // Not the customer's owner — buying is the raiser's job, not the
    // account manager's.
    expect(po.ownerId).toBe("u1");
  });
});

describe("what a purchase order says", () => {
  const doc = {
    number: "TZ/PO/2026-27/0007", date: "2026-08-24", validUntil: "2026-09-08",
    vendorName: "Redington (India) Limited", vendorGstin: "33AAACR0977P1ZL",
    vendorAddress: "SPL Guindy House, 95 Mount Road", vendorState: "Tamil Nadu",
    vendorCountry: "India", vendorContact: "Sales Desk", vendorPhone: "+91 44 4224 3111",
    billName: "", billState: "",
    shipSameAsBilling: false, shipName: "Acme Manufacturing India Pvt Ltd",
    shipAddress: "Plot 88, Sector 63", shipState: "Delhi",
    taxType: "gst", currency: "INR",
    terms: [...PURCHASE_ORDER_TERMS],
    items: [{ id: "1", desc: "HP ProBook 450 G10", hsn: "847130", qty: 12, rate: 68000, disc: 0, gst: 18 }],
    preparedBy: "Abhinav Jain", referenceNo: "RDGT/QT/88214",
  };

  it("is titled PURCHASE ORDER", () => {
    expect(build(doc).title).toBe("PURCHASE ORDER");
  });

  it("shows three party boxes: who we buy from, who pays, where it goes", () => {
    expect(build(doc).parties.map((p) => p.heading)).toEqual(["SUPPLIER", "BILL TO", "SHIP TO"]);
  });

  it("names the supplier in the first box", () => {
    const supplier = build(doc).parties[0]!;
    expect(supplier.name).toBe("Redington (India) Limited");
    expect(supplier.rows).toContainEqual(["GSTIN", "33AAACR0977P1ZL"]);
  });

  it("bills to our own company, taken from settings rather than the document", () => {
    // Read at render time on purpose: changing the company's address must
    // not leave last year's orders showing the old one.
    const billTo = build(doc).parties[1]!;
    expect(billTo.name).toBe("TechZoid Technologies Private Limited");
    expect(billTo.rows).toContainEqual(["GSTIN", "07AAGCT9158R1Z0"]);
  });

  it("ships to the drop-ship customer when one is set", () => {
    expect(build(doc).parties[2]!.name).toBe("Acme Manufacturing India Pvt Ltd");
  });

  it("ships to our own address when it is not a drop-ship", () => {
    const model = build({ ...doc, shipSameAsBilling: true });
    expect(model.parties[2]!.name).toBe("TechZoid Technologies Private Limited");
  });

  it("labels the details for a purchase order, not a quotation", () => {
    const labels = build(doc).details.map(([k]) => k);
    expect(labels).toEqual(["PO No.", "PO Date", "Required By", "Supplier Ref.", "Raised By"]);
    /* "Valid Until" is a quotation's word. A purchase order's date is when
       the goods are needed, which is what the delay clauses bite on. */
    expect(labels).not.toContain("Valid Until");
  });

  it("asks for the supplier's reference, not the customer's", () => {
    expect(build(doc).references[0]!.label).toBe("Supplier Reference");
  });

  it("prints every legal term", () => {
    expect(build(doc).money.terms).toHaveLength(PURCHASE_ORDER_TERMS.length);
  });

  it("has no salutation — it is an instruction, not a letter", () => {
    expect(build(doc).intro.salutation).toBeNull();
  });

  it("charges IGST when the supplier is in another state", () => {
    expect(build(doc).money.rows.map((r) => r.label)).toContain("IGST @ 18%");
  });

  it("splits CGST and SGST when the supplier is in ours", () => {
    const model = build({ ...doc, vendorState: "Delhi" });
    const labels = model.money.rows.map((r) => r.label);
    expect(labels).toContain("CGST @ 9%");
    expect(labels).toContain("SGST @ 9%");
  });

  it("survives a purchase order with no supplier typed in yet", () => {
    const model = build({ ...doc, vendorName: "", vendorAddress: "", vendorState: "", vendorGstin: "" });
    expect(model.parties[0]!.name).toBe("—");
    expect(JSON.stringify(model)).not.toContain("undefined");
  });
});

describe("what a purchase order deliberately leaves off", () => {
  const doc = {
    number: "TZ/PO/2026-27/0007", date: "2026-08-24", validUntil: "2026-09-08",
    vendorName: "Redington (India) Limited", vendorState: "Tamil Nadu",
    billName: "", billState: "", shipSameAsBilling: true,
    taxType: "gst", currency: "INR", terms: [...PURCHASE_ORDER_TERMS],
    items: [{ id: "1", desc: "Thing", hsn: "847130", qty: 1, rate: 1000, disc: 0, gst: 18 }],
  };

  it("never prints our bank details — we are the one paying", () => {
    // Bank details tell someone where to pay US. On an order where we are
    // the buyer they are noise at best, and an invitation to misdirect a
    // payment at worst. A bank account IS configured here, on purpose.
    expect(build(doc).money.bank).toBeNull();
  });

  it("never offers 'We Accept UPI / NEFT' — that is how we take money in", () => {
    expect(build(doc).signature.weAccept).toBeNull();
  });

  it("asks the SUPPLIER to acknowledge, not a customer to accept", () => {
    const acceptance = build(doc).signature.acceptance;
    expect(acceptance?.heading).toBe("Supplier Acknowledgement");
    // The supplier is the party being asked to sign, so their designation
    // is asked for too — a quotation's box does not.
    expect(acceptance?.fields).toEqual(["Name", "Designation", "Signature", "Date"]);
  });

  it("shows that acknowledgement even when customer acceptance is switched off", () => {
    // The customerAcceptance toggle is about a CUSTOMER countersigning a
    // quotation. It has nothing to say about a supplier acknowledging an
    // order, and must not silently remove the box.
    const off = {
      ...DEFAULT_DOC_TEMPLATE,
      sections: { ...DEFAULT_DOC_TEMPLATE.sections, customerAcceptance: false },
    };
    const totals = computeDocument({ ...doc, billState: doc.vendorState }, "Delhi");
    const model = buildDocumentModel({
      doc, settings: SETTINGS, totals, docType: "purchase_order", template: off,
    });
    expect(model.signature.acceptance?.heading).toBe("Supplier Acknowledgement");
  });

  it("closes with the terms notice, not by thanking the supplier for quoting us", () => {
    expect(build(doc).footer.closing).not.toContain("opportunity");
    expect(build(doc).footer.closing).toContain("terms and conditions");
  });
});

describe("the company logo", () => {
  const doc = {
    number: "TZ/PO/2026-27/0007", date: "2026-08-24", validUntil: "2026-09-08",
    vendorName: "A Supplier", vendorState: "Delhi", billName: "", billState: "",
    shipSameAsBilling: true, taxType: "gst", currency: "INR",
    terms: [], items: [{ id: "1", desc: "Thing", qty: 1, rate: 100, disc: 0, gst: 18 }],
  };

  it("is carried on the model when one is uploaded, with its natural size", () => {
    const withLogo = {
      ...SETTINGS,
      company: { ...SETTINGS.company, logo: "data:image/png;base64,AAA", logoW: 300, logoH: 80 },
    };
    expect(build(doc, withLogo).header.logo).toEqual({ src: "data:image/png;base64,AAA", w: 300, h: 80 });
  });

  it("is null without one, so a renderer leads with the company name instead", () => {
    expect(build(doc).header.logo).toBeNull();
  });

  it("is refused without its natural size — a renderer would stretch it", () => {
    const noDims = { ...SETTINGS, company: { ...SETTINGS.company, logo: "data:image/png;base64,AAA" } };
    expect(build(doc, noDims).header.logo).toBeNull();
  });
});
