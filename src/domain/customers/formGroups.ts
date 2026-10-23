import { currencyForCountry } from "../geo/currencyForCountry";
import { DEFAULT_SEGMENT, DEFAULT_SOURCE, type Customer } from "./customer";

/**
 * Has anybody actually chosen the commercial settings on this customer?
 *
 * The customer sheet folds currency, tax regime, segment and source away
 * until wanted, and must unfold them on a record where they were set — the
 * rule in domain/forms/disclosure.ts. But none of these four is ever empty:
 * currency and tax regime follow the country, segment starts at SMB and
 * source at Inbound Call. Asking "is it filled in" of a field that is never
 * blank answers yes forever, which is how the group opened itself on every
 * brand-new customer and folded nothing away at all.
 *
 * So the question is whether the value differs from what the record would
 * have been given on its own.
 */
export function billingChosen(c: Pick<Customer,
  "country" | "currency" | "taxType" | "segment" | "source">): boolean {
  const isIndia = !c.country || c.country === "India";
  return (c.currency ?? "INR") !== currencyForCountry(c.country ?? "India")
    /* applyCountry moves a GST customer to "none" on leaving India, so the
       expected regime depends on where they are. */
    || (c.taxType ?? "gst") !== (isIndia ? "gst" : "none")
    || (c.segment ?? DEFAULT_SEGMENT) !== DEFAULT_SEGMENT
    || (c.source ?? DEFAULT_SOURCE) !== DEFAULT_SOURCE;
}
