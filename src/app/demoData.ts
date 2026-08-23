import type { Customer } from "../domain/customers/customer";
import type { Workspace } from "../domain/customers/cascade";

/** Sample data for reviewing screens before the database layer is wired in.
 *  Not shipped: nothing imports this outside the demo app entry. */

export const USERS = [
  { id: "u-abhinav", name: "Abhinav Jain", role: "Admin" },
  { id: "u-priyanshi", name: "Priyanshi Sharma", role: "Sales" },
  { id: "u-rashmi", name: "Rashmi Verma", role: "Sales" },
  { id: "u-kuldeep", name: "Kuldeep Kumar", role: "Accounts" },
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

export const CUSTOM_FIELDS = [
  { id: "cf-po", label: "PO portal / vendor code" },
  { id: "cf-terms", label: "Agreed credit terms" },
];
