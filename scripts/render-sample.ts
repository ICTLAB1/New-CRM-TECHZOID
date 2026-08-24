/**
 * Render sample quotations for visual inspection.
 *
 * The spec requires 1, 5, 10, 20 and 50+ line items to be checked, plus long
 * descriptions, long addresses, CGST/SGST, IGST, zero tax, discounts and
 * missing optional fields. The ONLY verification that works here: generate,
 * rasterise (pdftoppm), and LOOK.
 *
 *   npx tsx scripts/render-sample.ts
 *   pdftoppm -png -r 110 tmp/items-50.pdf tmp/items-50
 */
import { writeFileSync } from "node:fs";
import { computeDocument } from "../src/domain/tax/compute";
import { buildDocumentModel } from "../src/domain/documents/model";
import { DEFAULT_DOC_TEMPLATE } from "../src/domain/documents/template";
import { DOMESTIC_TERMS } from "../src/domain/documents/terms";
import { renderDocumentPdf } from "../src/documents/pdf/render";
import {
  DEFAULT_CERTIFICATIONS, DEFAULT_PARTNER_DESIGNATIONS, DEFAULT_TECHNOLOGY_PARTNERS,
} from "../src/domain/documents/brandDefaults";

const settings = {
  company: {
    name: "TechZoid Technologies Private Limited",
    address: "407, 4th Floor, Pearl Business Park, Netaji Subhash Place, Pitampura",
    city: "New Delhi", state: "Delhi", pincode: "110034", country: "India",
    gstin: "07AAGCT9158R1Z0", pan: "AAGCT9158R", cin: "U72900DL2016PTC302635",
    phone: "+91 97114 92098",
    email: "sales@techzoidtechnologies.com",
    website: "www.techzoidtechnologies.com",
  },
  signatoryName: "Abhinav Jain",
  signatoryDesignation: "Managing Director",
  partnerDesignations: DEFAULT_PARTNER_DESIGNATIONS,
  brandingLogos: DEFAULT_TECHNOLOGY_PARTNERS,
  certLogos: DEFAULT_CERTIFICATIONS,
};

const CATALOG = [
  { desc: "Microsoft 365 Business Premium\nAnnual Subscription\nFor 25 Users", brand: "Microsoft", sku: "CFQ7TTC0LH1Y", qty: 25, unit: "User", rate: 18900, disc: 25 },
  { desc: "HP EliteBook 840 G11\n14\" WUXGA Display\nIntel Core Ultra 7 155U\n16GB RAM | 512GB SSD\nWindows 11 Pro\n3 Yrs Onsite Warranty", brand: "HP", sku: "9G0K8PT", qty: 10, unit: "Nos.", rate: 112500, disc: 10 },
  { desc: "Adobe Acrobat Pro\nDC for Teams\nAnnual Subscription\nFor 10 Users", brand: "Adobe", sku: "65302526BA01A12", qty: 10, unit: "User", rate: 15600, disc: 10 },
  { desc: "Lenovo ThinkPad T14 Gen 5\n14\" WUXGA Display\nIntel Core Ultra 5 125U\n16GB RAM | 512GB SSD\nWindows 11 Pro", brand: "Lenovo", sku: "21MLCTO1WW", qty: 5, unit: "Nos.", rate: 105000, disc: 10 },
  { desc: "Kaspersky Endpoint Security Select\nAnnual Subscription\nFor 25 Devices", brand: "Kaspersky", sku: "KL1941XKRBFS", qty: 25, unit: "Device", rate: 1050, disc: 25 },
  { desc: "Dell PowerEdge R760 Rack Server\n2x Xeon Gold 6430, 256GB RAM\n4x 1.92TB NVMe", brand: "Dell", sku: "PER760-2X6430", qty: 3, unit: "Nos.", rate: 1287400, disc: 4.25 },
  { desc: "Autodesk AutoCAD LT 2026 — Single User", brand: "Autodesk", sku: "057N1-WW3740", qty: 12, unit: "License", rate: 42750, disc: 0 },
  { desc: "Implementation & Migration Services\nTenant migration, identity setup, knowledge transfer", brand: "TechZoid", sku: "SVC-PROJECT-01", qty: 1, unit: "Project", rate: 376656, disc: 0 },
];

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: String(i + 1), gst: 18, ...CATALOG[i % CATALOG.length]! }));

function render(name: string, overrides: Record<string, unknown> = {}, docType: "quotation" | "proforma" = "quotation") {
  const doc = {
    number: docType === "proforma" ? "TZ/PI/2627/0042" : "TZ/QT/2627/0001",
    date: "2026-08-24", validUntil: "2026-09-23",
    referenceNo: "PO/ABC/2425/078",
    enquiryRef: "ENQ-150826-01",
    customerCode: "CUST-000123",
    preparedBy: "Abhinav / Sales Team",
    paymentTerms: "As specified", deliveryTerms: "As specified",
    billName: "ABC Private Limited",
    billAddress: "123, Business Park,\nSector 62, Noida\nUttar Pradesh - 201309",
    billState: "Uttar Pradesh", billCountry: "India",
    billGstin: "09AABCA1234A1Z5", billContact: "Mr. Rajesh Sharma",
    billEmail: "purchase@abcpl.com", billPhone: "+91 98765 43210",
    shipSameAsBilling: false,
    shipName: "ABC Private Limited", shipAddress: "IT Department\nPlot No. 45, Industrial Area\nPhase 2, Gurugram\nHaryana - 122002",
    shipState: "Haryana", shipContact: "Mr. Amit Verma", shipPhone: "+91 87654 32109",
    taxType: "gst", currency: "INR",
    terms: [...DOMESTIC_TERMS],
    items: items(5),
    ...overrides,
  };

  const totals = computeDocument(doc, "Delhi");
  const model = buildDocumentModel({
    doc, settings, totals, docType,
    template: DEFAULT_DOC_TEMPLATE,
    bankAccount: {
      name: "HDFC Bank Ltd", accountName: "TechZoid Technologies Private Limited",
      account: "50200045678901", ifsc: "HDFC0000123", swift: "HDFCINBB",
      branch: "Netaji Subhash Place, New Delhi", accountType: "Current Account",
    },
  });
  const pdf = renderDocumentPdf({ model, rows: totals.rows });
  writeFileSync(`tmp/${name}.pdf`, Buffer.from(pdf.output("arraybuffer")));
  console.log(`tmp/${name}.pdf — ${totals.rows.length} rows, ${model.money.grandValue}, ${pdf.getNumberOfPages()} page(s)`);
}

for (const n of [1, 5, 10, 20, 50]) render(`items-${n}`, { items: items(n) });
render("interstate-igst", { billState: "Maharashtra" });
render("zero-tax", { taxType: "none" });
render("export-aed", { taxType: "none", currency: "AED", billCountry: "United Arab Emirates", billState: "", billGstin: "" });
/* The client's real closing line: a full disclaimer paragraph. It shares a
   baseline with the page number, so this is the case that used to collide. */
render("long-closing", {
  footer: "This quotation is valid for 7 days from the date of issue. Prices, taxes, product availability, and promotional offers are subject to change without prior notice. Purchase Orders are subject to acceptance by TechZoid Technologies Private Limited.",
});
render("long-closing-50", {
  items: items(50),
  footer: "This quotation is valid for 7 days from the date of issue. Prices, taxes, product availability, and promotional offers are subject to change without prior notice. Purchase Orders are subject to acceptance by TechZoid Technologies Private Limited.",
});
render("minimal", { items: items(1), referenceNo: "", enquiryRef: "", customerCode: "", billGstin: "", billPhone: "", shipSameAsBilling: true });
render("proforma", { advancePercent: 50 }, "proforma");
