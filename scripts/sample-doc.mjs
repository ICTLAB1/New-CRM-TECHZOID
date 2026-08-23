/* One document definition, shared by the v1 and v2 render scripts so the
   comparison is genuinely like-for-like. */
export const SAMPLE = {
  settings: {
    company: {
      name: "TechZoid Technologies Private Limited",
      address: "Plot 14, Netaji Subhash Place, Pitampura",
      city: "New Delhi", state: "Delhi", pincode: "110034",
      gstin: "07AAXCT2727Q1ZX", pan: "AAXCT2727Q", cin: "U72900DL2015PTC281234",
      phone: "+91 11 4567 8900",
      email: "sales@techzoidtechnologies.com",
      website: "www.techzoidtechnologies.com",
    },
    uaeOffice: { name: "TechZoid Technologies FZ-LLC", city: "Ajman Free Zone", country: "United Arab Emirates" },
    isoCertText: "ISO 9001:2015 — Quality Management System\nISO/IEC 27001:2022 — Information Security Management System\nISO/IEC 20000-1:2018 — IT Service Management System",
    signatoryName: "Abhinav Jain",
    signatoryDesignation: "Managing Director",
  },
  doc: {
    number: "TZ/QT/2627/0117",
    date: "2026-08-23", validUntil: "2026-09-07",
    referenceNo: "RFQ/ACME/2026/88", revisionNo: 1,
    preparedBy: "Priyanshi Sharma",
    paymentTerms: "50% advance, balance on delivery",
    subject: "Supply of Microsoft, Autodesk and Kaspersky licences with implementation services",
    billName: "Acme Manufacturing India Private Limited",
    billAddress: "Plot 88, Sector 63, Industrial Area Phase III",
    billState: "Delhi", billCountry: "India",
    billGstin: "07AAPFU0939F1ZV", billPan: "AAPFU0939F",
    billContact: "Rajesh Kumar", billPhone: "+91 98100 12345", billEmail: "rajesh.kumar@acme-mfg.co.in",
    taxType: "gst", currency: "INR", roundOff: true,
    items: [
      { id: "1", desc: "Microsoft 365 E5 (Annual, Commercial)", subDesc: "Includes Teams Phone, Power BI Pro and Defender for Office 365 Plan 2", brand: "Microsoft", sku: "CFQ7TTC0LFLZ", hsn: "997331", qty: 250, unit: "License", rate: 2899.5, disc: 7.5, gst: 18 },
      { id: "2", desc: "Autodesk AutoCAD LT 2026 — Single User", subDesc: "3-year term, includes technical support", brand: "Autodesk", sku: "057N1-WW3740", hsn: "997331", qty: 12, unit: "License", rate: 42750, disc: 0, gst: 18 },
      { id: "3", desc: "Kaspersky Endpoint Security for Business Advanced", subDesc: "Cross-platform, 1 year", brand: "Kaspersky", sku: "KL4867XAKFS", hsn: "997331", qty: 500, unit: "Node", rate: 1876.25, disc: 12, gst: 18 },
      { id: "4", desc: "Implementation & Migration Services", subDesc: "Tenant migration, identity setup, knowledge transfer", brand: "TechZoid", sku: "SVC-PROJECT-01", hsn: "998313", qty: 1, unit: "Project", rate: 376656, disc: 0, gst: 18 },
      { id: "5", desc: "Dell PowerEdge R760 Rack Server", subDesc: "2x Xeon Gold 6430, 256GB RAM, 4x 1.92TB NVMe", brand: "Dell", sku: "PER760-2X6430", hsn: "84714900", qty: 3, unit: "Nos", rate: 1287400, disc: 4.25, gst: 18 },
    ],
    terms: [
      "All prices quoted are in Indian Rupees (INR) and are exclusive of applicable GST unless explicitly stated otherwise.",
      "Payment terms: 50% advance along with the confirmed purchase order, balance on delivery.",
      "Licence keys, activation codes, and subscription plans, once delivered and activated, are strictly non-returnable and non-refundable as per the respective OEM's licensing policy.",
      "Delivery of digital licences within 1–3 working days of payment realisation.",
      "This quotation is valid for the period stated above and supersedes all previous quotations for the same requirement.",
    ],
  },
};
