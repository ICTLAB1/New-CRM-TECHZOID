import { validateGSTIN } from "../gstin/validate";
import type { StageId } from "../pipeline/stages";

/** Every field the customer record carries. Legacy rows may have almost
 *  none of them, so nothing here beyond `id` is required. */
export interface Customer {
  id: string;
  ownerId: string;
  /** The customer ID a person reads — CUST-000124 — as opposed to `id`,
   *  which is a database key nobody should ever be shown. Allocated once
   *  when the record is created and never reused; it prints on every
   *  document raised for this customer. */
  code?: string;
  company?: string;
  contact?: string;
  designation?: string;
  email?: string;
  phone?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  /** A second number, for when the first one does not answer. */
  altPhone?: string;
  /** Consent to be messaged on WhatsApp. Meta requires opt-in before a
   *  business writes first, so this is a hard gate on the automated
   *  channel — an unticked box is not consent, and neither is a legacy
   *  record that predates the question. */
  whatsappOptIn?: boolean;
  website?: string;

  /* WHERE THE GOODS GO, which is not always where the invoice goes: a head
     office in Delhi buying for a plant in Bhiwadi is the ordinary case, not
     the exception. Held on the customer so it is asked once and carried onto
     every document, rather than typed again on each one — which is how a
     delivery ends up at the billing address. */
  shipSame?: boolean;
  shipAddress?: string;
  shipCity?: string;
  shipState?: string;
  shipPincode?: string;
  shipContact?: string;
  shipPhone?: string;
  segment?: string;
  source?: string;
  stage?: StageId;
  value?: number | string;
  nextFollowUp?: string;
  currency?: string;
  taxType?: string;
  notes?: CustomerNote[];
  customFields?: Record<string, string>;
  wonAt?: number;
  lostReason?: string;
  lostCompetitor?: string;
  lostNotes?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface CustomerNote {
  id: string;
  ts: number;
  user: string;
  userId: string;
  text: string;
  type: string;
  outcome?: string;
  nextAction?: string;
}

/** `code` is deliberately absent: it is allocated when the record is first
 *  SAVED, not when a blank form is opened, so cancelling out of "New
 *  customer" does not burn a number and leave a gap in the sequence. */
export function blankCustomer(ownerId: string, id: string): Customer {
  return {
    id, ownerId,
    company: "", contact: "", designation: "", email: "", phone: "",
    gstin: "", pan: "", address: "", city: "", state: "Delhi",
    country: "India", pincode: "", altPhone: "", website: "", whatsappOptIn: false,
    shipSame: true, shipAddress: "", shipCity: "", shipState: "",
    shipPincode: "", shipContact: "", shipPhone: "",
    segment: "SMB", source: "Inbound Call", stage: "lead",
    value: "", nextFollowUp: "",
    currency: "INR", taxType: "gst",
    notes: [], customFields: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/**
 * A GSTIN carries two pieces of real data: the state code (first two digits)
 * and the holder's PAN (characters 3–12). A valid one fills both in.
 *
 * It NEVER overwrites a PAN already typed. Someone who has entered a PAN by
 * hand has a reason — possibly the GSTIN is the one that is wrong — and
 * silently replacing it loses their input with no way to notice.
 */
export function applyGstin(customer: Customer, raw: string): Customer {
  const next: Customer = { ...customer, gstin: raw };
  const result = validateGSTIN(raw);
  if (!result.valid) return next;
  return {
    ...next,
    gstin: result.clean,
    state: result.stateName || customer.state,
    pan: customer.pan || result.pan,
    /* A GSTIN only exists for an Indian registration. */
    country: "India",
  };
}

/**
 * Changing the country clears the state.
 *
 * Leaving "Delhi" selected on a customer in the UAE put an Indian state onto
 * export documents and, worse, made the tax engine treat the sale as
 * intra-state. The state field means something different outside India, so
 * carrying the old value over is never right.
 *
 * Moving off India also drops GST, since GST cannot apply to an export.
 */
export function applyCountry(customer: Customer, country: string): Customer {
  const isIndia = country === "India";
  return {
    ...customer,
    country,
    state: isIndia ? "Delhi" : "",
    taxType: !isIndia && customer.taxType === "gst" ? "none" : customer.taxType,
  };
}

/** Display name for a customer with nothing filled in yet. */
export const customerLabel = (c: Customer): string => c.company?.trim() || "Untitled customer";
