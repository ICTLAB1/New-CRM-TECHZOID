import { describe, expect, it } from "vitest";
import { buildDocumentModel, packLogoRows, rowWidth, type LogoCell } from "./model";
import { DEFAULT_DOC_TEMPLATE, normalizeDocTemplate } from "./template";
import { computeDocument } from "../tax/compute";

const SETTINGS = {
  company: {
    name: "TechZoid Technologies Private Limited",
    address: "Pitampura", city: "New Delhi", state: "Delhi", pincode: "110034",
    gstin: "07AAXXXXXXXXXZX", pan: "AAXXXXXXXX", cin: "U72900DL2015PTC000000",
    email: "sales@techzoidtechnologies.com", website: "www.techzoidtechnologies.com",
    phone: "",
  },
  signatoryName: "Abhinav Jain",
  signatoryDesignation: "Managing Director",
};

const DOC = {
  number: "TZ/QT/2526/0001",
  date: "2026-04-10",
  validUntil: "2026-04-25",
  billName: "Acme Industries Pvt Ltd",
  billAddress: "12 Industrial Area",
  billState: "Delhi",
  billGstin: "07AAPFU0939F1ZV",
  items: [{ id: "1", desc: "Microsoft 365 E3", qty: 10, rate: 2400, disc: 0, gst: 18 }],
  taxType: "gst",
  currency: "INR",
  terms: ["Payment 100% advance.", "Delivery in 3 working days."],
};

const build = (docOverrides = {}, docType: "quotation" | "proforma" = "quotation", settingsOverrides = {}, bank = {}) => {
  const doc = { ...DOC, ...docOverrides };
  const totals = computeDocument(doc, "Delhi");
  return buildDocumentModel({
    doc,
    settings: { ...SETTINGS, ...settingsOverrides },
    totals,
    docType,
    template: DEFAULT_DOC_TEMPLATE,
    bankAccount: bank,
  });
};

describe("header meta", () => {
  it("reads the document's currency on a quotation", () => {
    // v1 hardcoded "Currency: INR" in the quotation header while the proforma
    // read the document — an export quote said INR on its face.
    const m = build({ currency: "AED" });
    expect(m.header.meta).toContainEqual(["Currency", "AED"]);
  });

  it("reads the document's currency on a proforma too", () => {
    const m = build({ currency: "USD" }, "proforma");
    expect(m.header.meta).toContainEqual(["Currency", "USD"]);
  });

  it("titles each document type", () => {
    expect(build().title).toBe("QUOTATION");
    expect(build({}, "proforma").title).toBe("PROFORMA INVOICE");
  });

  it("builds the registration bar from what is configured", () => {
    expect(build().header.registration).toEqual([
      "GSTIN 07AAXXXXXXXXXZX",
      "PAN AAXXXXXXXX",
      "CIN U72900DL2015PTC000000",
    ]);
  });

  it("omits a blank phone rather than printing an empty contact line", () => {
    // A blank or punctuation-only phone must not survive as a leading " · "
    // or a bare "-" among the real contact details.
    expect(build().header.contactLine).not.toMatch(/^\s*·/);
    expect(build({}, "quotation", { company: { ...SETTINGS.company, phone: "-" } }).header.contactLine)
      .not.toContain("-");
  });
});

describe("totals", () => {
  it("splits CGST and SGST within the seller's state", () => {
    const m = build();
    expect(m.money.rows.map((r) => r.label)).toContain("CGST @ 9%");
    expect(m.money.rows.map((r) => r.label)).toContain("SGST @ 9%");
  });

  it("uses IGST across states", () => {
    const m = build({ billState: "Maharashtra" });
    expect(m.money.rows.map((r) => r.label)).toContain("IGST @ 18%");
    expect(m.money.rows.map((r) => r.label)).not.toContain("CGST @ 9%");
  });

  it("prints no tax row at all for an exempt document", () => {
    const m = build({ taxType: "none" });
    expect(m.money.rows.map((r) => r.label)).toEqual(["Subtotal", "Total Discount", "Taxable Value"]);
    expect(m.money.grandValue).toBe("Rs. 24,000.00");
  });

  it("shows only the tax rows that apply — never a zero IGST beside CGST", () => {
    // The reference image prints all three with zeros; the written spec says
    // per tax mode, and printing a zero line invites the reader to wonder
    // what it is for.
    expect(build().money.rows.map((r) => r.label)).not.toContain("IGST @ 18%");
    expect(build({ billState: "Maharashtra" }).money.rows.map((r) => r.label)).not.toContain("CGST @ 9%");
  });

  it("names the regime for VAT and Sales Tax", () => {
    expect(build({ taxType: "vat" }).money.rows.map((r) => r.label)).toContain("VAT @ 18%");
    expect(build({ taxType: "sales_tax" }).money.rows.map((r) => r.label)).toContain("Sales Tax @ 18%");
  });

  it("adds a round-off row only when round-off is on", () => {
    expect(build().money.rows.map((r) => r.label)).not.toContain("Round Off");
    expect(build({ roundOff: true }).money.rows.map((r) => r.label)).toContain("Round Off");
  });

  it("formats every figure in the document's currency, PDF-safe", () => {
    const m = build({ currency: "PKR" });
    expect(m.money.grandValue.startsWith("PKR ")).toBe(true);
    for (const r of m.money.rows) {
      expect([...r.value].every((ch) => (ch.codePointAt(0) ?? 0) <= 0xff)).toBe(true);
    }
  });
});

describe("grand total label", () => {
  it("uses the configured label when it is not currency-specific", () => {
    expect(build().money.grandLabel).toBe("Grand Total");
  });

  it("drops a stale '(INR)' label when the document is in another currency", () => {
    const template = normalizeDocTemplate({
      labels: { ...DEFAULT_DOC_TEMPLATE.labels, grandTotalLabel: "Grand Total (INR)" },
    });
    const doc = { ...DOC, currency: "USD" };
    const m = buildDocumentModel({
      doc, settings: SETTINGS, totals: computeDocument(doc, "Delhi"),
      docType: "quotation", template,
    });
    expect(m.money.grandLabel).toBe("Grand Total (USD)");
  });

  it("keeps an '(INR)' label when the document really is in INR", () => {
    const template = normalizeDocTemplate({
      labels: { ...DEFAULT_DOC_TEMPLATE.labels, grandTotalLabel: "Grand Total (INR)" },
    });
    const m = buildDocumentModel({
      doc: DOC, settings: SETTINGS, totals: computeDocument(DOC, "Delhi"),
      docType: "quotation", template,
    });
    expect(m.money.grandLabel).toBe("Grand Total (INR)");
  });
});

describe("amount in words", () => {
  it("follows the document's currency", () => {
    expect(build().money.amountInWords).toContain("Rupees");
    expect(build({ currency: "USD" }).money.amountInWords).toContain("US Dollar");
  });

  it("can be switched off", () => {
    const template = normalizeDocTemplate({ sections: { amountInWords: false } });
    const m = buildDocumentModel({
      doc: DOC, settings: SETTINGS, totals: computeDocument(DOC, "Delhi"),
      docType: "quotation", template,
    });
    expect(m.money.amountInWords).toBeNull();
  });
});

describe("proforma specifics", () => {
  it("shows an advance row only for a part advance", () => {
    expect(build({ advancePercent: 50 }, "proforma").money.advance).toMatchObject({ label: "Advance (50%)" });
    expect(build({ advancePercent: 100 }, "proforma").money.advance).toBeNull();
    expect(build({ advancePercent: 0 }, "proforma").money.advance).toBeNull();
  });

  it("carries bank details on a proforma and on a quotation", () => {
    // The approved reference prints bank details on a quotation too, in its
    // own block below the HSN/SAC summary — not only on a proforma.
    const bank = { name: "HDFC Bank", account: "50200012345678", ifsc: "HDFC0001234" };
    expect(build({}, "proforma", {}, bank).money.bank?.rows).toContainEqual(["Bank Name", "HDFC Bank"]);
    expect(build({}, "quotation", {}, bank).money.bank?.rows).toContainEqual(["Bank Name", "HDFC Bank"]);
  });

  it("prints notes instead of terms", () => {
    const m = build({}, "proforma");
    expect(m.notes.length).toBeGreaterThan(0);
    expect(m.money.terms).toEqual([]);
    expect(build().notes).toEqual([]);
    expect(build().money.terms).toHaveLength(2);
  });

  it("closes with the not-a-tax-invoice line", () => {
    expect(build({}, "proforma").footer.closing).toContain("not a Tax Invoice");
  });
});

describe("party grid", () => {
  it("carries exactly two boxes: BILL TO and SHIP TO", () => {
    // v1 had a third column that repeated the billing party verbatim.
    expect(build().parties.map((p) => p.heading)).toEqual(["BILL TO", "SHIP TO"]);
  });

  it("keeps the bill-to box to GSTIN, contact, email and phone", () => {
    const m = build({ billContact: "Rajesh Kumar", billEmail: "rajesh@acme.in", billPhone: "+91 98100 12345" });
    expect(m.parties[0]!.rows.map(([k]) => k)).toEqual(["GSTIN", "Contact", "Email", "Phone"]);
  });

  it("keeps the ship-to box to contact and phone only", () => {
    // The design's ship box is deliberately short; state and place of supply
    // are already on the address lines above it.
    const ship = build({ shipSameAsBilling: false, shipContact: "Amit Verma", shipPhone: "+91 87654 32109" }).parties[1]!;
    expect(ship.rows.map(([k]) => k)).toEqual(["Contact", "Phone"]);
  });

  it("falls back to billing when shipping is the same", () => {
    const m = build();
    expect(m.parties[1]!.name).toBe(m.parties[0]!.name);
  });

  it("uses distinct shipping details when they differ", () => {
    const m = build({ shipSameAsBilling: false, shipName: "Acme Warehouse", shipState: "Haryana" });
    expect(m.parties[1]!.name).toBe("Acme Warehouse");
    expect(m.parties[0]!.name).toBe("Acme Industries Pvt Ltd");
  });

  it("does not repeat the state when the address already names it", () => {
    const m = build({ billAddress: "12 Industrial Area\nDelhi - 110034", billState: "Delhi" });
    const delhiLines = m.parties[0]!.lines.filter((l) => l.toLowerCase().includes("delhi"));
    expect(delhiLines).toHaveLength(1);
  });

  it("ends the address with the country, for exports", () => {
    const m = build({ billCountry: "United Arab Emirates", billState: "" });
    expect(m.parties[0]!.lines.at(-1)).toBe("United Arab Emirates");
  });

  it("omits empty rows rather than printing blank labels", () => {
    const m = build({ billGstin: "", billPhone: "" });
    expect(m.parties[0]!.rows.map(([k]) => k)).not.toContain("GSTIN");
    expect(m.parties[0]!.rows.map(([k]) => k)).not.toContain("Phone");
  });
});

describe("header and details", () => {
  it("keeps the header block to date, validity, revision and currency", () => {
    // Printing the number, customer id and sales executive here too cost
    // 20mm of page and said everything twice.
    expect(build().header.meta.map(([k]) => k)).toEqual(["Date", "Valid Until", "Revision", "Currency"]);
  });

  it("carries the rest in the details column", () => {
    const m = build({ customerCode: "CUST-000123", enquiryRef: "ENQ-150826-01", preparedBy: "Priyanshi" });
    const labels = m.details.map(([k]) => k);
    expect(labels).toEqual([
      "Quotation No.", "Quotation Date", "Valid Until", "Customer ID", "Sales Executive", "Enquiry Reference",
    ]);
    expect(m.details).toContainEqual(["Customer ID", "CUST-000123"]);
  });

  it("never falls back to the database id for the customer-facing code", () => {
    // A sequential or guessable identifier must not leave the system.
    const m = build({ customerCode: "" });
    expect(m.details.find(([k]) => k === "Customer ID")?.[1]).toBe("—");
  });

  it("carries the company tagline", () => {
    expect(build().header.tagline).toContain("Technology Procurement");
  });
});

describe("reference strip", () => {
  it("has the four cells the design specifies", () => {
    expect(build().references.map((r) => r.label)).toEqual([
      "Customer Reference", "Enquiry Reference", "Payment Terms", "Delivery Terms",
    ]);
  });

  it("falls back rather than leaving a cell blank", () => {
    const m = build({ referenceNo: "", enquiryRef: "", paymentTerms: "", deliveryTerms: "" });
    expect(m.references.map((r) => r.value)).toEqual(["—", "—", "As specified", "As specified"]);
  });
});

describe("partner, certification and footer strips", () => {
  it("renders a slot as text when no approved asset is configured", () => {
    // Nothing is ever fabricated: no asset means the name, not a badge.
    const m = build({}, "quotation", { partnerDesignations: [{ label: "Microsoft Solutions Partner" }] });
    expect(m.strips.designations[0]).toMatchObject({ text: "Microsoft Solutions Partner", src: null });
  });

  it("is empty when nothing is configured", () => {
    const m = build();
    expect(m.strips.designations).toEqual([]);
    expect(m.strips.partners).toEqual([]);
    expect(m.strips.certifications).toEqual([]);
  });

  it("carries the registration numbers in the header, not the footer", () => {
    // Company details moved to the header banner in the redesign — the
    // footer keeps only the closing line and page number.
    expect(build().header.registration).toEqual([
      "GSTIN 07AAXXXXXXXXXZX",
      "PAN AAXXXXXXXX",
      "CIN U72900DL2015PTC000000",
    ]);
  });

  it("closes with the design's line", () => {
    expect(build().footer.closing).toBe("Thank you for the opportunity to submit this quotation.");
  });
});

describe("partner logo strip", () => {
  const cell = (w: number): LogoCell => ({ type: "image", w, h: 13, src: "x" });

  it("keeps a small set on one row", () => {
    const rows = packLogoRows([cell(26), cell(26), cell(26)], 184);
    expect(rows).toHaveLength(1);
  });

  it("wraps six or more logos instead of running off the page", () => {
    // Single-row centring pushed the first logo past the left page edge.
    const rows = packLogoRows(Array.from({ length: 8 }, () => cell(26)), 184);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(rowWidth(row)).toBeLessThanOrEqual(184);
    }
  });

  it("keeps every logo when wrapping", () => {
    const cells = Array.from({ length: 11 }, () => cell(26));
    expect(packLogoRows(cells, 184).flat()).toHaveLength(11);
  });

  it("centres each row within the page rather than overflowing it", () => {
    const rows = packLogoRows(Array.from({ length: 7 }, () => cell(26)), 184);
    for (const row of rows) {
      const left = (184 - rowWidth(row)) / 2;
      expect(left).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles a single logo wider than the page without looping forever", () => {
    const rows = packLogoRows([cell(300), cell(26)], 184);
    expect(rows.flat()).toHaveLength(2);
  });
});

describe("legacy documents", () => {
  it("renders one with no currency, taxType, country or terms", () => {
    const doc = { number: "TZ/QT/2425/0007", billName: "Old Customer", items: [{ id: "1", desc: "Thing", qty: 1, rate: 100 }] };
    const m = buildDocumentModel({
      doc, settings: SETTINGS, totals: computeDocument(doc, "Delhi"),
      docType: "quotation", template: DEFAULT_DOC_TEMPLATE,
    });
    expect(m.currency).toBe("INR");
    expect(m.taxType).toBe("gst");
    expect(m.money.terms).toEqual([]);
    expect(m.money.grandValue).toBe("Rs. 100.00");
    expect(JSON.stringify(m)).not.toContain("undefined");
  });
});

describe("what a customer must never be able to read", () => {
  /* THE RULE. Cost and margin live on the document record and on the
     editor's own screen. They are not in the model the PDF and the preview
     are built from, and they must never be. The day somebody adds a cost
     column to the item table for debugging is the day a customer opens a
     quotation and reads what the product cost us. */
  const COSTED = {
    ...DOC,
    items: [
      { id: "1", desc: "Microsoft 365 E3", qty: 10, rate: 2400, disc: 0, gst: 18, cost: 1717 },
      { id: "2", desc: "Adobe Creative Cloud", qty: 4, rate: 5000, disc: 5, gst: 18, cost: 4321 },
    ],
  };

  const model = buildDocumentModel({
    doc: COSTED as never,
    settings: SETTINGS,
    totals: computeDocument(COSTED as never, "Delhi"),
    docType: "quotation",
    template: normalizeDocTemplate(DEFAULT_DOC_TEMPLATE),
    bankAccount: {},
  });

  it("carries no cost figure anywhere in the model", () => {
    // Serialised whole, so this catches a cost reaching ANY part of the
    // document — a column, a note, a total, a debug field somebody added.
    const json = JSON.stringify(model);
    expect(json).not.toContain("1717");
    expect(json).not.toContain("4321");
  });

  it("names no column that would print a cost or a margin", () => {
    const columns = JSON.stringify(model.items.columns).toLowerCase();
    for (const word of ["cost", "margin", "profit", "buy price", "landed"]) {
      expect(columns, `item table must not have a ${word} column`).not.toContain(word);
    }
  });

  it("still prices the document correctly with costs present", () => {
    // The guard must not be achieved by dropping the line.
    expect(model.items.rowCount).toBe(2);
    expect(model.money.grandValue).toBeTruthy();
  });
});
