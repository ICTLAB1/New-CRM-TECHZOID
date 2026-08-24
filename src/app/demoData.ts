import type { Customer } from "../domain/customers/customer";
import type { Workspace } from "../domain/customers/cascade";

/** Sample data for reviewing screens before the database layer is wired in.
 *  Not shipped: nothing imports this outside the demo app entry. */

export const USERS = [
  { id: "u-abhinav", name: "Abhinav Jain", email: "abhinav@example.com", role: "Admin" },
  { id: "u-priyanshi", name: "Priyanshi Sharma", email: "priyanshi@example.com", role: "Sales" },
  { id: "u-rashmi", name: "Rashmi Verma", email: "rashmi@example.com", role: "Sales" },
  { id: "u-kuldeep", name: "Kuldeep Kumar", email: "kuldeep@example.com", role: "Accounts" },
];

const day = (offset: number): string => {
  const d = new Date("2026-08-23T00:00:00");
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

export const CUSTOMERS: Customer[] = [
  { id: "c1", ownerId: "u-priyanshi", company: "Acme Manufacturing India Pvt Ltd", contact: "Rajesh Kumar", designation: "IT Head", email: "rajesh.kumar@acme-mfg.co.in", phone: "+91 98100 12345", gstin: "07AAPFU0939F1ZX", pan: "AAPFU0939F", city: "New Delhi", state: "Delhi", country: "India", segment: "Enterprise", source: "Referral", stage: "negotiation", value: 7178851, nextFollowUp: day(-2), currency: "INR", taxType: "gst" },
  { id: "c2", ownerId: "u-rashmi", company: "Northline Logistics", contact: "Meera Iyer", email: "meera@northline.in", gstin: "27AACCN1234M1ZG", pan: "AACCN1234M", city: "Pune", state: "Maharashtra", country: "India", segment: "Mid-Market", source: "Website", stage: "won", value: 412500, wonAt: Date.now(), currency: "INR", taxType: "gst" },
  { id: "c3", ownerId: "u-priyanshi", company: "Sunrise Education Trust", contact: "Fr. Thomas Mathew", email: "admin@sunrisetrust.org", city: "Kochi", state: "Kerala", country: "India", segment: "Education", source: "GeM Portal", stage: "quoted", value: 86400, nextFollowUp: day(-12), currency: "INR", taxType: "gst" },
  { id: "c4", ownerId: "u-rashmi", company: "Vertex Analytics Pvt Ltd", contact: "Sandeep Rao", email: "sandeep@vertexanalytics.com", city: "Bengaluru", state: "Karnataka", country: "India", segment: "SMB", source: "LinkedIn", stage: "lead", value: 1249000, currency: "INR", taxType: "gst" },
  { id: "c5", ownerId: "u-priyanshi", company: "Harbour Foods Pvt Ltd", contact: "Anita Desai", email: "anita@harbourfoods.in", city: "Mumbai", state: "Maharashtra", country: "India", segment: "Mid-Market", source: "Cold Outreach", stage: "quoted", value: 298750, nextFollowUp: day(1), currency: "INR", taxType: "gst" },
  { id: "c6", ownerId: "u-rashmi", company: "Gulf Marine Services FZ-LLC", contact: "Omar Al-Farsi", email: "omar@gulfmarine.ae", city: "Ajman", state: "", country: "United Arab Emirates", segment: "Enterprise", source: "Partner / OEM", stage: "contacted", value: 2140000, currency: "AED", taxType: "none" },
  { id: "c7", ownerId: "u-priyanshi", company: "Deccan Cements Limited", contact: "V. Prakash", email: "prakash@deccancem.in", gstin: "36AADCD8765P1ZU", pan: "AADCD8765P", city: "Hyderabad", state: "Telangana", country: "India", segment: "Enterprise", source: "Inbound Call", stage: "qualified", value: 3410000, nextFollowUp: day(4), currency: "INR", taxType: "gst" },
  { id: "c8", ownerId: "u-rashmi", company: "Meridian Health Systems", contact: "Dr. Kavita Nair", email: "kavita@meridianhealth.in", city: "Chennai", state: "Tamil Nadu", country: "India", segment: "Enterprise", source: "Existing Client", stage: "lost", value: 890000, lostReason: "Lost to competitor", lostCompetitor: "A rival GeM reseller", currency: "INR", taxType: "gst" },
  { id: "c9", ownerId: "u-priyanshi", company: "Bluepeak Interiors LLP", contact: "Nikhil Shah", email: "nikhil@bluepeak.co.in", city: "Ahmedabad", state: "Gujarat", country: "India", segment: "SMB", source: "Meta Ads", stage: "lead", value: 145000, currency: "INR", taxType: "gst" },
];

export const WORKSPACE: Workspace = {
  quotes: [
    { id: "q1", ownerId: "u-priyanshi", customerId: "c1" },
    { id: "q2", ownerId: "u-priyanshi", customerId: "c1" },
    { id: "q3", ownerId: "u-rashmi", customerId: "c4" },
  ],
  proformas: [{ id: "p1", ownerId: "u-priyanshi", customerId: "c1" }],
  orders: [{ id: "o1", ownerId: "u-priyanshi", customerId: "c1" }],
  challans: [{ id: "d1", ownerId: "u-priyanshi", orderId: "o1" }],
  subscriptions: [{ id: "s1", ownerId: "u-priyanshi", customerId: "c1" }],
};

import { DEFAULT_CERTIFICATIONS, DEFAULT_PARTNER_DESIGNATIONS, DEFAULT_TECHNOLOGY_PARTNERS } from "../domain/documents/brandDefaults";
import { BRAND_ASSETS } from "../assets/brandAssets";
import type { DocImages } from "../documents/pdf/render";
import { DOMESTIC_TERMS } from "../domain/documents/terms";
import type { SalesDocument } from "../domain/documents/create";
import type { CatalogProduct } from "../domain/catalog/types";

export const CATALOG: CatalogProduct[] = [
  { id: "p1", name: "Microsoft 365 Business Premium (Annual)", publisher: "Microsoft", licenseType: "NCE", productId: "CFQ7TTC0LCHC", skuId: "CFQ7TTC0LH1Y", termDuration: "1 Year", billingPlan: "Annual", segment: "Commercial", costPrice: 17200, sellPrice: 18900, hsn: "997331", unit: "User", active: true, createdAt: 0, updatedAt: 0 },
  { id: "p2", name: "HP EliteBook 840 G11", publisher: "HP", licenseType: "Hardware", productId: "", skuId: "9G0K8PT", termDuration: "", billingPlan: "", segment: "Commercial", costPrice: 104000, sellPrice: 112500, hsn: "84713010", unit: "Nos.", active: true, createdAt: 0, updatedAt: 0 },
  { id: "p3", name: "Adobe Acrobat Pro DC for Teams", publisher: "Adobe", licenseType: "Subscription", productId: "", skuId: "65302526BA01A12", termDuration: "1 Year", billingPlan: "Annual", segment: "Commercial", costPrice: 14200, sellPrice: 15600, hsn: "997331", unit: "User", active: true, createdAt: 0, updatedAt: 0 },
  { id: "p4", name: "Acer Veriton Desktop", publisher: "Acer", licenseType: "Hardware", productId: "", skuId: "DT.VT8SI.001", termDuration: "", billingPlan: "", segment: "Commercial", costPrice: 41000, sellPrice: 46500, hsn: "84714110", unit: "Nos.", active: true, createdAt: 0, updatedAt: 0 },
  { id: "p5", name: "Implementation & Migration Services", publisher: "TechZoid", licenseType: "Services", productId: "", skuId: "SVC-PROJECT-01", termDuration: "", billingPlan: "", segment: "Commercial", costPrice: 0, sellPrice: 376656, hsn: "998313", unit: "Project", active: true, createdAt: 0, updatedAt: 0 },
];

export const SETTINGS: Record<string, unknown> = {
  company: {
    name: "TechZoid Technologies Private Limited",
    tagline: "One procurement partner. Multiple technology brands.",
    address: "407, 4th Floor, Pearl Business Park, Netaji Subhash Place, Pitampura",
    city: "New Delhi", state: "Delhi", pincode: "110034", country: "India",
    gstin: "07AAGCT9158R1Z0", pan: "AAGCT9158R", cin: "U72900DL2016PTC302635",
    phone: "+91 97114 92098",
    email: "sales@techzoidtechnologies.com",
    website: "www.techzoidtechnologies.com",
  },
  uaeOffice: {
    address: "Office C1-1F-SF2571, Ajman Free Zone C1 Building, Ajman Free Zone, Ajman",
    phone: "+971 58 939 7239",
    businessLicense: "42287",
    taxRegistrationNumber: "105122230300001",
  },
  quotePrefix: "TZ/QT", quoteSeq: 118,
  proformaPrefix: "TZ/PI", proformaSeq: 43,
  defaultCurrency: "INR", defaultTaxType: "gst", defaultGst: 18, defaultValidityDays: 15,
  defaultTerms: DOMESTIC_TERMS,
  signatoryName: "Abhinav Jain", signatoryDesignation: "Managing Director",
  partnerDesignations: DEFAULT_PARTNER_DESIGNATIONS,
  brandingLogos: DEFAULT_TECHNOLOGY_PARTNERS,
  certLogos: DEFAULT_CERTIFICATIONS,
  bankAccounts: [{
    id: "hdfc", label: "HDFC Current", name: "HDFC Bank Ltd",
    accountName: "TechZoid Technologies Private Limited",
    account: "50200045678901", ifsc: "HDFC0000123", swift: "HDFCINBB",
    branch: "Netaji Subhash Place, New Delhi", accountType: "Current Account",
  }],

  /* Where "Send for invoicing" routes to. Kept in settings rather than in
     code so it can be changed without a deploy. */
  invoicingEmail: "accounts@techzoidtechnologies.com",
  invoicingCc: "",

  /* The catalog is configuration, not records — it lives in the settings
     row exactly as it did in v1, so the schema needs no new table. */
  productCatalog: CATALOG,

  /* One live scheme, so the Incentives screen has something to show. */
  incentiveSchemes: [{
    id: "sch-q", name: "Quarterly sales incentive",
    description: "Paid on business won in the quarter, plus a bonus for renewals kept.",
    period: "Quarterly", active: true,
    slabs: [
      { id: "sl-1", metric: "Revenue", minTarget: 2_000_000, maxTarget: 0, payoutType: "Percentage", payoutValue: 1.5, bonusFlat: 0 },
      { id: "sl-2", metric: "Deals Won", minTarget: 5, maxTarget: 0, payoutType: "Flat", payoutValue: 15_000, bonusFlat: 0 },
      { id: "sl-3", metric: "Renewals", minTarget: 3, maxTarget: 0, payoutType: "Flat", payoutValue: 0, bonusFlat: 10_000 },
    ],
  }],

  /* Extra fields on a customer record. They live in settings, not in code,
     so Settings → Custom fields is the only place that defines them. */
  customFields: [
    { id: "cf-po", label: "PO portal / vendor code" },
    { id: "cf-terms", label: "Agreed credit terms" },
  ],
};

/** Brand logos for the items table, keyed by the brand name on a line. */
export const BRAND_LOGOS: Record<string, { src: string }> = {
  hp: { src: BRAND_ASSETS.hp.src },
  acer: { src: BRAND_ASSETS.acer.src },
  cisco: { src: BRAND_ASSETS.ciscoPartner.src },
};

/** The same artwork for the PDF, which needs the pixel dimensions in order
 *  to place it without distorting the aspect ratio. The preview gets them
 *  from the image itself; jsPDF cannot. */
export const DOC_IMAGES: DocImages = {
  brands: {
    hp: BRAND_ASSETS.hp,
    acer: BRAND_ASSETS.acer,
    cisco: BRAND_ASSETS.ciscoPartner,
  },
};


const baseDoc = (over: Partial<SalesDocument>): SalesDocument => ({
  id: "d" + Math.random().toString(36).slice(2, 8),
  number: "TZ/QT/2627/0000", ownerId: "u-priyanshi", customerId: "c1",
  billName: "Acme Manufacturing India Pvt Ltd", billContact: "Rajesh Kumar",
  billAddress: "Plot 88, Sector 63, Industrial Area Phase III, New Delhi, 110034",
  billState: "Delhi", billCountry: "India",
  billGstin: "07AAPFU0939F1ZX", billPan: "AAPFU0939F",
  billEmail: "rajesh.kumar@acme-mfg.co.in", billPhone: "+91 98100 12345",
  shipSameAsBilling: true, shipName: "", shipAddress: "", shipState: "", shipCountry: "",
  shipGstin: "", shipPan: "", shipContact: "", shipPhone: "", shipEmail: "",
  currency: "INR", taxType: "gst",
  customerCode: "CUST-000123", referenceNo: "PO/ABC/2425/078", enquiryRef: "ENQ-150826-01",
  paymentTerms: "50% advance, balance on delivery", deliveryTerms: "Ex Works New Delhi",
  revisionNo: 0, subject: "Supply of Microsoft and HP products with implementation services",
  date: "2026-08-24", validUntil: "2026-09-08", status: "Draft",
  items: [
    { id: "i1", desc: "Microsoft 365 Business Premium", subDesc: "Annual Subscription\nFor 25 Users", brand: "Microsoft", sku: "CFQ7TTC0LH1Y", hsn: "997331", qty: 25, unit: "User", rate: 18900, disc: 5, gst: 18 },
    { id: "i2", desc: "HP EliteBook 840 G11", subDesc: "14\" WUXGA, Core Ultra 7, 16GB, 512GB SSD", brand: "HP", sku: "9G0K8PT", hsn: "84713010", qty: 10, unit: "Nos.", rate: 112500, disc: 8, gst: 18 },
  ],
  terms: [...DOMESTIC_TERMS],
  intro: "", footer: "", notes: "", roundOff: true,
  preparedBy: "Priyanshi Sharma", createdAt: Date.now(), updatedAt: Date.now(),
  ...over,
});

export const QUOTATIONS: SalesDocument[] = [
  baseDoc({ id: "q1", number: "TZ/QT/2627/0117", status: "Sent" }),
  baseDoc({ id: "q2", number: "TZ/QT/2627/0116", status: "Accepted", billName: "Northline Logistics", customerId: "c2", ownerId: "u-rashmi", billState: "Maharashtra" }),
  baseDoc({ id: "q3", number: "TZ/QT/2627/0114", status: "Sent", validUntil: "2026-08-11", billName: "Sunrise Education Trust", customerId: "c3" }),
  baseDoc({ id: "q4", number: "TZ/QT/2627/0111", status: "Draft", billName: "Vertex Analytics Pvt Ltd", customerId: "c4", ownerId: "u-rashmi" }),
];

export const PROFORMAS: SalesDocument[] = [
  baseDoc({ id: "pf1", number: "TZ/PI/2627/0042", status: "Sent", advancePercent: 50, paymentHistory: [] }),
];

import type { SalesOrder, DeliveryChallan } from "../domain/orders/create";
import type { Subscription } from "../domain/subscriptions/expiry";

export const ORDERS: SalesOrder[] = [
  { id: "o1", number: "TZ/SO/2627/0011", ownerId: "u-priyanshi", customerId: "c1", proformaId: "pf1", proformaNumber: "TZ/PI/2627/0042", poNumber: "PO/ABC/2425/078",
    billName: "Acme Manufacturing India Pvt Ltd", billAddress: "Plot 88, Sector 63, New Delhi", billState: "Delhi", billContact: "Rajesh Kumar", billPhone: "+91 98100 12345",
    shipName: "Acme Manufacturing India Pvt Ltd", shipAddress: "Plot 88, Sector 63, New Delhi", shipState: "Delhi", shipContact: "Rajesh Kumar", shipPhone: "+91 98100 12345",
    currency: "INR", taxType: "gst", stage: "procurement", date: "2026-08-20", roundOff: true,
    items: [
      { id: "oi1", desc: "Microsoft 365 Business Premium", qty: 25, unit: "User", rate: 18900, disc: 5, gst: 18 },
      { id: "oi2", desc: "HP EliteBook 840 G11", qty: 10, unit: "Nos.", rate: 112500, disc: 8, gst: 18 },
    ], createdAt: 0, updatedAt: 0 },
  { id: "o2", number: "TZ/SO/2627/0010", ownerId: "u-rashmi", customerId: "c2", poNumber: "PO/NL/551",
    billName: "Northline Logistics", billAddress: "Hinjewadi, Pune", billState: "Maharashtra", billContact: "Meera Iyer", billPhone: "+91 98220 11223",
    shipName: "Northline Logistics", shipAddress: "Hinjewadi, Pune", shipState: "Maharashtra", shipContact: "Meera Iyer", shipPhone: "+91 98220 11223",
    currency: "INR", taxType: "gst", stage: "dispatched", date: "2026-08-12", roundOff: true,
    items: [{ id: "oi3", desc: "Acer Veriton Desktop", qty: 8, unit: "Nos.", rate: 46500, disc: 0, gst: 18 }],
    createdAt: 0, updatedAt: 0 },
  { id: "o3", number: "TZ/SO/2627/0008", ownerId: "u-priyanshi", customerId: "c7", poNumber: "",
    billName: "Deccan Cements Limited", billAddress: "Banjara Hills, Hyderabad", billState: "Telangana", billContact: "V. Prakash", billPhone: "+91 90000 55555",
    shipName: "Deccan Cements Limited", shipAddress: "Banjara Hills, Hyderabad", shipState: "Telangana", shipContact: "V. Prakash", shipPhone: "+91 90000 55555",
    currency: "INR", taxType: "gst", stage: "delivered", date: "2026-07-28", roundOff: true,
    items: [{ id: "oi4", desc: "Implementation & Migration Services", qty: 1, unit: "Project", rate: 376656, disc: 0, gst: 18 }],
    createdAt: 0, updatedAt: 0 },
];

export const CHALLANS: DeliveryChallan[] = [
  { id: "d1", number: "TZ/DC/2627/0004", ownerId: "u-priyanshi", orderId: "o1", orderNumber: "TZ/SO/2627/0011", poNumber: "PO/ABC/2425/078",
    date: "2026-08-22", shipName: "Acme Manufacturing India Pvt Ltd", shipAddress: "Plot 88, Sector 63, New Delhi", shipState: "Delhi",
    shipContact: "Rajesh Kumar", shipPhone: "+91 98100 12345",
    items: [{ itemId: "oi1", qty: 25 }], courier: "Bluedart", trackingNo: "BD8829114411",
    status: "In Transit", dispatchDate: "2026-08-22", expectedDeliveryDate: "2026-08-25", createdAt: 0, updatedAt: 0 },
  { id: "d2", number: "TZ/DC/2627/0003", ownerId: "u-rashmi", orderId: "o2", orderNumber: "TZ/SO/2627/0010",
    date: "2026-08-14", shipName: "Northline Logistics", shipAddress: "Hinjewadi, Pune", shipState: "Maharashtra",
    shipContact: "Meera Iyer", shipPhone: "+91 98220 11223",
    items: [{ itemId: "oi3", qty: 8 }], courier: "Delhivery", trackingNo: "DL5512907733",
    status: "Delivered", dispatchDate: "2026-08-14", expectedDeliveryDate: "2026-08-18", deliveredDate: "2026-08-17", createdAt: 0, updatedAt: 0 },
];

export const SUBSCRIPTIONS: Subscription[] = [
  { id: "s1", ownerId: "u-priyanshi", customerId: "c1", customerName: "Acme Manufacturing India Pvt Ltd", vendor: "Microsoft", product: "Microsoft 365 E3 (250 seats)", type: "Subscription", billing: "Annual", startDate: "2025-09-01", expiryDate: "2026-08-31", seats: 250, sellPrice: 1875000, status: "Active", renewalStage: "Quotation Sent" },
  { id: "s2", ownerId: "u-rashmi", customerId: "c2", customerName: "Northline Logistics", vendor: "Kaspersky", product: "Endpoint Security Select (120 nodes)", type: "Subscription", billing: "Annual", startDate: "2025-08-28", expiryDate: "2026-08-27", seats: 120, sellPrice: 226800, status: "Active", renewalStage: "Reminder Sent" },
  { id: "s3", ownerId: "u-priyanshi", customerId: "c7", customerName: "Deccan Cements Limited", vendor: "Autodesk", product: "AutoCAD LT (12 users)", type: "Subscription", billing: "3-Year", startDate: "2024-09-15", expiryDate: "2026-09-14", seats: 12, sellPrice: 513000, status: "Active", renewalStage: "Upcoming" },
  { id: "s4", ownerId: "u-rashmi", customerId: "c4", customerName: "Vertex Analytics Pvt Ltd", vendor: "Adobe", product: "Creative Cloud for Teams (8 seats)", type: "Subscription", billing: "Annual", startDate: "2025-06-01", expiryDate: "2026-08-18", seats: 8, sellPrice: 448000, status: "Active", renewalStage: "Customer Contacted" },
  { id: "s5", ownerId: "u-priyanshi", customerId: "c5", customerName: "Harbour Foods Pvt Ltd", vendor: "Microsoft", product: "Windows Server 2022 Standard", type: "Perpetual", startDate: "2024-03-11", sellPrice: 285000, status: "Perpetual License", renewalStage: "Upcoming" },
  { id: "s6", ownerId: "u-rashmi", customerId: "c8", customerName: "Meridian Health Systems", vendor: "VMware", product: "vSphere Standard (4 hosts)", type: "Support Contract", billing: "Annual", startDate: "2025-11-02", expiryDate: "2026-11-01", seats: 4, sellPrice: 690000, status: "Active", renewalStage: "Upcoming" },
  { id: "s7", ownerId: "u-priyanshi", customerId: "c3", customerName: "Sunrise Education Trust", vendor: "Microsoft", product: "M365 A3 for Faculty (60 seats)", type: "Subscription", billing: "Annual", startDate: "2025-07-01", expiryDate: "2026-06-30", seats: 60, sellPrice: 324000, status: "Expired", renewalStage: "Lost" },
];

