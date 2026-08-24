/**
 * Reproduce the client-supplied reference quotation (TZ/QT/2026-27/0042) with
 * the new header/footer/HSN-summary/signature redesign, to compare visually
 * against the reference PDF.
 *
 *   npx tsx scripts/render-reference-check.ts
 *   pdftoppm -png -r 130 tmp/reference-check.pdf tmp/reference-check
 */
import { writeFileSync } from "node:fs";
import { computeDocument } from "../src/domain/tax/compute";
import { buildDocumentModel } from "../src/domain/documents/model";
import { DEFAULT_DOC_TEMPLATE } from "../src/domain/documents/template";
import { renderDocumentPdf } from "../src/documents/pdf/render";
import { DEFAULT_CERTIFICATIONS } from "../src/domain/documents/brandDefaults";

const settings = {
  company: {
    name: "TechZoid Technologies Private Limited",
    tagline: "One procurement partner. Multiple technology brands.",
    address: "407, 4th Floor, Pearl Business Park, Netaji Subhash Place, Pitampura",
    city: "New Delhi", state: "Delhi", pincode: "110034", country: "India",
    gstin: "07AAICT5606J1Z4", pan: "AAICT5606J", cin: "U72900DL2021PTC380025",
    phone: "+91 98765 43210",
    email: "sales@techzoidtechnologies.com",
    website: "https://www.techzoidtechnologies.com",
  },
  uaeOffice: {
    address: "Office C1-1F-SF2571, Ajman Free Zone C1 Building, Ajman Free Zone, Ajman",
    phone: "+971 58 939 7239",
    businessLicense: "42287",
    taxRegistrationNumber: "105122230300001",
  },
  signatoryName: "Abhinav Jain",
  signatoryDesignation: "Managing Director",
  certLogos: DEFAULT_CERTIFICATIONS,
};

const doc = {
  number: "TZ/QT/2026-27/0042",
  date: "2026-08-17", validUntil: "2026-09-16", revisionNo: 2,
  referenceNo: "PO/MITADT/2425/078", enquiryRef: "ENQ-2026-9XM4TQ",
  preparedBy: "Abhinav Jain",
  paymentTerms: "50% advance, balance on delivery", deliveryTerms: "4-6 weeks from confirmed order",
  billName: "MIT ADT University",
  billAddress: "Loni Kalbhor, Solapur Highway",
  billState: "Maharashtra", billCountry: "India",
  billGstin: "27AAAJM2218H1ZD", billContact: "Dr. Suresh Rao",
  billEmail: "itpurchase@example.edu.in", billPhone: "+91 70888 28088",
  shipSameAsBilling: false,
  shipName: "MIT ADT University", shipAddress: "Rajbaug Campus, Gate No. 2",
  shipState: "Maharashtra", shipContact: "Dr. Suresh Rao", shipPhone: "+91 70888 28088", shipEmail: "itpurchase@example.edu.in",
  taxType: "gst", currency: "INR",
  terms: [
    "Quotation is valid for 30 days from the date of issue unless otherwise specified.",
    "Prices are exclusive of applicable GST, taxes, duties, freight and other charges unless specifically stated otherwise.",
    "Product, service and availability are subject to confirmation at the time of order.",
    "Order confirmation is subject to receipt and acceptance of a valid Purchase Order and/or payment, as applicable.",
    "Delivery timelines are indicative and may vary depending on product availability, manufacturer/distributor schedules and logistics.",
    "Product specifications, models and availability may be subject to change by the respective manufacturer without prior notice.",
    "Hardware products are subject to the applicable manufacturer's warranty and support terms.",
    "All disputes shall be subject to the jurisdiction of the courts at New Delhi, India.",
  ],
  items: [
    { id: "1", desc: "Microsoft 365 Business Standard\nAnnual subscription - includes Office apps, Exchange, Teams, SharePoint", brand: "Microsoft", sku: "CFQ7TTC0LH18-01", hsn: "997331", qty: 60, unit: "Users", rate: 5600, disc: 5, gst: 18 },
    { id: "2", desc: "Microsoft 365 Business Premium\nAnnual subscription - advanced security, Intune device management", brand: "Microsoft", sku: "CFQ7TTC0LCHC-02", hsn: "997331", qty: 15, unit: "Users", rate: 8900, disc: 5, gst: 18 },
    { id: "3", desc: "Windows 11 Pro\nOEM licence, per device", brand: "Microsoft", sku: "FQC-10529-03", hsn: "997331", qty: 25, unit: "Nos", rate: 11500, disc: 0, gst: 18 },
    { id: "4", desc: "Kaspersky Endpoint Security for Business\nAdvanced tier, 1-year licence", brand: "Kaspersky", sku: "KL4867XAKFS-04", hsn: "997331", qty: 100, unit: "Nodes", rate: 1450, disc: 8, gst: 18 },
    { id: "5", desc: "Implementation and Migration Support\nTenant setup, mailbox migration, on-site handover and admin training", brand: "", sku: "SVC-IMPL-01-05", hsn: "998313", qty: 1, unit: "Project", rate: 85000, disc: 0, gst: 18 },
    // Reference PDF text-extraction was ambiguous for this row's unit price —
    // qty/discount/taxable below are the reference's, rate is approximated to
    // land close to the reference's taxable value for this row (1,71,246.00).
    { id: "6", desc: "HP ProBook 450 G10 Notebook\nCore i5-1335U, 16 GB, 512 GB SSD, Windows 11 Pro", brand: "HP", sku: "9X4M2PA-06", hsn: "847130", qty: 12, unit: "Nos", rate: 14734, disc: 3.15, gst: 18 },
  ],
};

const totals = computeDocument(doc, "Delhi");
const model = buildDocumentModel({
  doc, settings, totals, docType: "quotation",
  template: DEFAULT_DOC_TEMPLATE,
  bankAccount: {
    name: "Sample Bank, Pitampura", accountName: "TechZoid Technologies Private Limited",
    account: "000000000000", ifsc: "SMPL0000001",
  },
});
const pdf = renderDocumentPdf({ model, rows: totals.rows });
writeFileSync("tmp/reference-check.pdf", Buffer.from(pdf.output("arraybuffer")));
console.log(`tmp/reference-check.pdf — ${totals.rows.length} rows, ${model.money.grandValue}, ${pdf.getNumberOfPages()} page(s)`);
console.log("Taxable:", model.money.rows.find((r) => r.label === "Taxable Value")?.value, "expected 11,23,171.00-ish");
console.log("Grand:", model.money.grandValue, "expected ~13,25,341.78");
