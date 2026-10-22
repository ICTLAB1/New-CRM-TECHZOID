import { applyGstin, blankCustomer, type Customer } from "./customer";

/** The customer fields a dictated sentence can carry. */
export interface ExtractedCustomer {
  company?: string;
  contact?: string;
  designation?: string;
  email?: string;
  phone?: string;
  altPhone?: string;
  website?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  segment?: string;
  source?: string;
  notes?: string;
}

const text = (v: unknown): string => String(v ?? "").trim();

/**
 * A customer record from dictated details.
 *
 * THE GSTIN DECIDES THE STATE, not the sentence. Both the state code and the
 * PAN live inside a GSTIN — first two digits, characters three to twelve —
 * so `applyGstin` reads them off it and they are applied last, over anything
 * that was said. A customer whose state disagrees with their GSTIN is
 * charged CGST+SGST where IGST was due, or the reverse, on every invoice
 * they are ever sent; it is not a field worth taking anybody's word for.
 *
 * Everything else is taken as given. A field nobody mentioned keeps the
 * workspace default from `blankCustomer`, which is the right answer — an
 * empty field is honest, and a guessed one is wrong on every document.
 */
export function customerFromText(
  extracted: ExtractedCustomer,
  ownerId: string,
  id: string,
): Customer {
  const base = blankCustomer(ownerId, id);

  const said: Partial<Customer> = {};
  const copy = (key: keyof Customer & keyof ExtractedCustomer) => {
    const v = text(extracted[key]);
    if (v) (said as Record<string, unknown>)[key] = v;
  };
  (["company", "contact", "designation", "email", "phone", "altPhone", "website",
    "pan", "address", "city", "state", "country", "pincode", "segment", "source"] as const)
    .forEach(copy);

  let customer: Customer = { ...base, ...said, updatedAt: Date.now() };

  /* Last, and over the top of any state that was dictated. */
  const gstin = text(extracted.gstin);
  if (gstin) customer = applyGstin(customer, gstin);

  return customer;
}
