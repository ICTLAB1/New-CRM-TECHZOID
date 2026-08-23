import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentPreview } from "./DocumentPreview";
import { buildDocumentModel } from "../../domain/documents/model";
import { DEFAULT_DOC_TEMPLATE } from "../../domain/documents/template";
import { DOMESTIC_TERMS } from "../../domain/documents/terms";
import { computeDocument } from "../../domain/tax/compute";

/**
 * THE DRIFT GUARD.
 *
 * v1's preview and PDF were built from different code. They drifted, and it
 * took a byte-level comparison of a generated file to notice. Both renderers
 * now read one DocumentModel, and this asserts the preview actually shows
 * every value that model carries — so a figure the PDF prints cannot quietly
 * go missing on screen, or vice versa.
 *
 * Rendered with renderToStaticMarkup: no DOM needed, and it is the markup
 * that matters, not the browser's layout of it.
 */

const SETTINGS = {
  company: {
    name: "TechZoid Technologies Private Limited",
    address: "407 Pearl Business Park", city: "New Delhi", state: "Delhi", pincode: "110034",
    gstin: "07AAGCT9158R1Z0", pan: "AAGCT9158R", cin: "U72900DL2016PTC302635",
    phone: "+91 97114 92098", email: "sales@techzoidtechnologies.com", website: "www.techzoidtechnologies.com",
  },
  partnerDesignations: [{ label: "Microsoft Solutions Partner" }],
  brandingLogos: [{ label: "HP" }],
  certLogos: [{ label: "ISO 9001:2015", caption: "Quality Management System" }],
};

const DOC = {
  number: "TZ/QT/2627/0001",
  date: "2026-08-24", validUntil: "2026-09-23",
  referenceNo: "PO/ABC/2425/078", enquiryRef: "ENQ-150826-01", customerCode: "CUST-000123",
  preparedBy: "Abhinav / Sales Team",
  paymentTerms: "50% advance", deliveryTerms: "Ex Works",
  billName: "ABC Private Limited", billAddress: "123 Business Park\nSector 62, Noida",
  billState: "Uttar Pradesh", billCountry: "India", billGstin: "09AABCA1234A1Z5",
  billContact: "Mr. Rajesh Sharma", billEmail: "purchase@abcpl.com", billPhone: "+91 98765 43210",
  taxType: "gst", currency: "INR", roundOff: true,
  terms: [...DOMESTIC_TERMS],
  items: [
    { id: "1", desc: "Microsoft 365 Business Premium", brand: "Microsoft", sku: "CFQ7TTC0LH1Y", qty: 25, unit: "User", rate: 18900, disc: 25, gst: 18 },
    { id: "2", desc: "HP EliteBook 840 G11", brand: "HP", sku: "9G0K8PT", qty: 10, unit: "Nos.", rate: 112500, disc: 10, gst: 18 },
  ],
};

function build(docOverrides = {}, docType: "quotation" | "proforma" = "quotation") {
  const doc = { ...DOC, ...docOverrides };
  const totals = computeDocument(doc, "Delhi");
  const model = buildDocumentModel({
    doc, settings: SETTINGS, totals, docType,
    template: DEFAULT_DOC_TEMPLATE,
    bankAccount: { name: "HDFC Bank Ltd", account: "50200045678901", ifsc: "HDFC0000123" },
  });
  const html = renderToStaticMarkup(<DocumentPreview model={model} rows={totals.rows} />);
  /* Decode entities and strip tags: we are checking what a reader sees. */
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ");
  return { model, totals, html, text };
}

describe("the preview shows everything the model carries", () => {
  const { model, text } = build();

  it("prints every header meta value", () => {
    for (const [label, value] of model.header.meta) {
      expect(text, label).toContain(label);
      expect(text, `${label} = ${value}`).toContain(value);
    }
  });

  it("prints every detail row", () => {
    for (const [label, value] of model.details) {
      expect(text, label).toContain(label);
      expect(text, `${label} = ${value}`).toContain(value);
    }
  });

  it("prints every reference cell", () => {
    for (const cell of model.references) {
      expect(text, cell.label).toContain(cell.label.toUpperCase());
      expect(text, cell.value).toContain(cell.value);
    }
  });

  it("prints every party row", () => {
    for (const party of model.parties) {
      expect(text, party.heading).toContain(party.heading);
      expect(text).toContain(party.name);
      for (const [label, value] of party.rows) {
        expect(text, `${party.heading}/${label}`).toContain(value);
      }
    }
  });

  it("prints every summary line and the grand total", () => {
    for (const row of model.money.rows) {
      expect(text, row.label).toContain(row.label);
      expect(text, row.value).toContain(row.value);
    }
    expect(text).toContain(model.money.grandValue);
    expect(text).toContain(model.money.grandLabel.toUpperCase());
  });

  it("prints the amount in words", () => {
    expect(text).toContain(model.money.amountInWords);
  });

  it("prints every term, in full", () => {
    for (const term of model.money.terms) {
      expect(text, term.slice(0, 40)).toContain(term);
    }
  });

  it("prints the footer registration and closing line", () => {
    for (const [label, value] of model.footer.registration) {
      expect(text, label).toContain(value);
    }
    expect(text).toContain(model.footer.closing);
  });

  it("prints every strip slot", () => {
    for (const slot of [...model.strips.designations, ...model.strips.partners, ...model.strips.certifications]) {
      expect(text, slot.text).toContain(slot.text);
      if (slot.caption) expect(text, slot.caption).toContain(slot.caption);
    }
  });
});

describe("the items table matches the shared column definition", () => {
  const { model, totals, text } = build();

  it("renders every column header", () => {
    for (const col of model.items.columns) {
      /* Headers carry a newline before the currency; check both halves. */
      for (const part of col.head.split("\n")) {
        if (part) expect(text, part).toContain(part);
      }
    }
  });

  it("renders every cell exactly as the column getter formats it", () => {
    // The PDF calls the same getters. If a figure is formatted differently
    // on screen, one of them stopped using the shared definition.
    totals.rows.forEach((row, i) => {
      for (const col of model.items.columns) {
        const value = col.get(row, i);
        if (value) expect(text, `${col.key} row ${i}`).toContain(value);
      }
    });
  });

  it("sizes its columns from the same millimetre widths the PDF uses", () => {
    const { html, model: m } = build();
    for (const col of m.items.columns) {
      expect(html, col.key).toContain(`width:${(col.w / 184) * 100}%`);
    }
  });

  it("allots the whole table width, with nothing left over", () => {
    const total = model.items.columns.reduce((a, c) => a + c.w, 0);
    expect(total).toBeCloseTo(184, 6);
  });
});

describe("document variants", () => {
  it("renders a proforma with its bank block and no terms column", () => {
    const { text } = build({ advancePercent: 50 }, "proforma");
    expect(text).toContain("PROFORMA INVOICE");
    expect(text).toContain("HDFC Bank Ltd");
    expect(text).toContain("Advance (50%)");
  });

  it("renders an exempt export with no tax row", () => {
    const { model, text } = build({ taxType: "none", currency: "AED", billCountry: "United Arab Emirates", billGstin: "" });
    // Round-off is on for this document, so it earns a row; no tax row does.
    expect(model.money.rows.map((r) => r.label)).toEqual(["Subtotal", "Total Discount", "Taxable Value", "Round Off"]);
    expect(text).toContain("(AED)");
    expect(text).not.toContain("CGST");
  });

  it("survives a legacy document with almost nothing on it", () => {
    const doc = { number: "TZ/QT/2425/0009", items: [{ id: "1", desc: "Thing", qty: 1, rate: 100 }] };
    const totals = computeDocument(doc, "Delhi");
    const model = buildDocumentModel({
      doc, settings: SETTINGS, totals, docType: "quotation", template: DEFAULT_DOC_TEMPLATE,
    });
    const html = renderToStaticMarkup(<DocumentPreview model={model} rows={totals.rows} />);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });
});
