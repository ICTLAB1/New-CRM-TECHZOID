import type { Customer } from "../customers/customer";
import type { GstinVerification } from "./gstin";
import type { PanVerification } from "./pan";
import { panWithinGstin } from "./pan";

/**
 * What a verification changes on the customer record.
 *
 * THE RULE THROUGHOUT: what the register said is recorded; what a person
 * typed is not overwritten. The same principle applyGstin() already follows
 * for the PAN it decodes out of a GSTIN — "someone who has entered a PAN by
 * hand has a reason, possibly that the GSTIN is the one that is wrong".
 *
 * So the registered name lands in `legalName`, beside `company`, and never
 * on top of it. Plenty of customers are known internally by a name that is
 * not on their registration — a division, a brand, a short form somebody
 * has typed into forty quotations — and silently replacing it would rewrite
 * how they appear everywhere with no way to notice it happened. Applying it
 * to `company` is offered in the sheet as a button the person presses.
 *
 * The address is the exception in one direction only: it fills fields that
 * are EMPTY. A blank city on a record that now has an authoritative one is
 * a gap, not a decision, and leaving it blank helps nobody.
 */

export function applyGstinVerification(
  customer: Customer,
  v: GstinVerification,
  now: number = Date.now(),
): Customer {
  const fillIfBlank = (current: string | undefined, value: string): string =>
    (current ?? "").trim() ? (current as string) : value;

  return {
    ...customer,
    /* The number as the register spells it, which settles case and stray
       spaces without anybody retyping it. */
    gstin: v.gstin || customer.gstin,
    legalName: v.legalName || customer.legalName,
    tradeName: v.tradeName || customer.tradeName,
    gstinStatus: v.status,
    gstinTaxpayerType: v.taxpayerType,
    gstinRegisteredOn: v.registeredOn,
    gstinVerifiedAt: now,

    /* The PAN inside the GSTIN is the registered one, so it is worth having
       — but still only where none has been typed. */
    pan: fillIfBlank(customer.pan, panWithinGstin(v.gstin)),

    address: fillIfBlank(customer.address, v.address.line),
    city: fillIfBlank(customer.city, v.address.city),
    state: fillIfBlank(customer.state, v.address.state),
    pincode: fillIfBlank(customer.pincode, v.address.pincode),
  };
}

/** Put the registered name into `company`. Separate from the above because
 *  it is a decision somebody makes, not something a verification does. */
export function useLegalName(customer: Customer): Customer {
  const legal = (customer.legalName ?? "").trim();
  return legal ? { ...customer, company: legal } : customer;
}

export function applyPanVerification(
  customer: Customer,
  v: PanVerification,
  now: number = Date.now(),
): Customer {
  return {
    ...customer,
    pan: v.pan || customer.pan,
    panVerified: v.valid,
    panVerifiedAt: now,
    panName: v.name || customer.panName,
  };
}

/**
 * How stale a verification is, in whole days. Null when never verified.
 *
 * A registration active in March can be cancelled by September, so the
 * answer is only ever as good as its date — and the sheet shows that date
 * rather than a tick that implies the check happened just now.
 */
export function verificationAgeDays(at: number | undefined, now: number = Date.now()): number | null {
  if (!at) return null;
  return Math.max(0, Math.floor((now - at) / 86_400_000));
}

/** Registrations are worth re-checking about twice a year. */
export const STALE_AFTER_DAYS = 180;

export const verificationIsStale = (at: number | undefined, now: number = Date.now()): boolean => {
  const age = verificationAgeDays(at, now);
  return age !== null && age >= STALE_AFTER_DAYS;
};

/**
 * Whether a PAN typed by hand disagrees with the one inside the GSTIN.
 *
 * Both are on the same record and they are supposed to be the same ten
 * characters. When they are not, one of them is a typo — and the invoice
 * will carry whichever one somebody happens to look at.
 */
export function panContradictsGstin(customer: Pick<Customer, "pan" | "gstin">): boolean {
  const typed = (customer.pan ?? "").trim().toUpperCase();
  const inside = panWithinGstin(customer.gstin ?? "");
  return !!typed && !!inside && typed !== inside;
}
