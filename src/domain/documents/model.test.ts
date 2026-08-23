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
    expect(build().header.registrationParts).toEqual([
      "CIN: U72900DL2015PTC000000",
      "GSTIN: 07AAXXXXXXXXXZX",
      "PAN: AAXXXXXXXX",
    ]);
  });

  it("omits a blank phone rather than printing an empty contact line", () => {
    expect(build().header.contactLines).not.toContain("");
    expect(build({}, "quotation", { company: { ...SETTINGS.company, phone: "-" } }).header.contactLines)
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
    expect(m.money.rows.map((r) => r.label)).toEqual(["Sub Total", "Discount", "Taxable Amount"]);
    expect(m.money.grandValue).toBe("Rs. 24,000.00");
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

  it("carries bank details, and never on a quotation", () => {
    const bank = { name: "HDFC Bank", account: "50200012345678", ifsc: "HDFC0001234" };
    expect(build({}, "proforma", {}, bank).money.bank?.rows).toContainEqual(["Bank Name", "HDFC Bank"]);
    expect(build({}, "quotation", {}, bank).money.bank).toBeNull();
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
  it("shows place of supply only under GST", () => {
    const gst = build().parties[0]!;
    expect(gst.rows.map(([k]) => k)).toContain("Place of Supply");
    const vat = build({ taxType: "vat" }).parties[0]!;
    expect(vat.rows.map(([k]) => k)).not.toContain("Place of Supply");
  });

  it("decodes the state code into the place of supply", () => {
    expect(build().parties[0]!.rows).toContainEqual(["Place of Supply", "Delhi (07)"]);
  });

  it("falls back to billing when shipping is the same", () => {
    const m = build();
    expect(m.parties[2]!.name).toBe(m.parties[1]!.name);
  });

  it("uses distinct shipping details when they differ", () => {
    const m = build({ shipSameAsBilling: false, shipName: "Acme Warehouse", shipState: "Haryana" });
    expect(m.parties[2]!.name).toBe("Acme Warehouse");
    expect(m.parties[1]!.name).toBe("Acme Industries Pvt Ltd");
  });

  it("carries the country on the address line, for exports", () => {
    const m = build({ billCountry: "United Arab Emirates", billState: "" });
    expect(m.parties[0]!.lines.join(" ")).toContain("United Arab Emirates");
  });

  it("omits empty rows rather than printing blank labels", () => {
    const m = build({ billGstin: "", billPan: "", billPhone: "" });
    expect(m.parties[0]!.rows.map(([k]) => k)).not.toContain("GSTIN");
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
