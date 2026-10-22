import { documentsForCustomer, type DocumentRow } from "./documents";
import type { SalesDocument } from "../documents/create";
import type { Customer, CustomerNote } from "./customer";
import type { Subscription } from "../subscriptions/expiry";

/**
 * One customer, whole.
 *
 * The record a salesperson needs before picking up the phone is spread
 * across eight tables, because that is how the data is correctly shaped and
 * emphatically not how the question is asked. "What is going on with
 * Trident Realty" previously meant opening the quotations screen, the
 * proformas screen, the invoices screen, the renewals screen, the pipeline
 * and the payment tracker, filtering each by name, and holding the answer
 * in your head.
 *
 * This assembles it. It is pure: the fetching happens in data/customer360,
 * the arranging happens here where it can be tested, and every section is
 * independently empty-able — a customer with no subscriptions is not an
 * error, it is a customer who has not bought a subscription.
 */

export interface ProfileContact {
  id: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export interface ProfileActivity {
  id: string;
  kind: string;
  at: string;
  summary: string;
  by?: string;
}

export interface ProfileDeal {
  id: string;
  title?: string;
  stage: string;
  value?: number | string;
  currency?: string;
  expectedClose?: string;
}

export interface ProfileBill {
  id: string;
  invoiceNo: string;
  dueOn: string;
  balance: number;
  currency?: string;
  daysOverdue: number;
}

/** A product this customer holds, and how many of it. */
export interface ProfileLicence {
  id: string;
  product: string;
  vendor?: string;
  seats?: number | string;
  expiryDate?: string;
  status?: string;
  renewalStage?: string;
}

export interface CustomerProfile {
  contacts: ProfileContact[];
  documents: DocumentRow[];
  activities: ProfileActivity[];
  licences: ProfileLicence[];
  /** Subscriptions whose term ends, soonest first. */
  renewals: ProfileLicence[];
  outstanding: { bills: ProfileBill[]; total: number; currency: string };
  deals: ProfileDeal[];
  lost: { reason?: string; competitor?: string; notes?: string } | null;
  notes: CustomerNote[];
}

export interface ProfileSources {
  documents?: { quotations?: SalesDocument[]; proformas?: SalesDocument[]; invoices?: SalesDocument[] };
  contacts?: ProfileContact[];
  activities?: ProfileActivity[];
  subscriptions?: Subscription[];
  bills?: ProfileBill[];
  deals?: ProfileDeal[];
  sellerState?: string;
}

/**
 * THE PRIMARY CONTACT COMES FIRST, and the customer's own contact field is
 * one of the contacts. A record whose `contact` was filled in before the
 * contacts table existed would otherwise show no decision-makers at all,
 * which reads as "nobody here" rather than "this was typed the old way".
 */
function contactsOf(customer: Customer, extra: readonly ProfileContact[]): ProfileContact[] {
  const own: ProfileContact[] = customer.contact
    ? [{
        id: `customer:${customer.id}`,
        name: customer.contact,
        role: customer.designation,
        email: customer.email,
        phone: customer.phone,
        isPrimary: !extra.some((c) => c.isPrimary),
      }]
    : [];
  const seen = new Set<string>();
  return [...own, ...extra]
    .filter((c) => {
      const key = (c.email || c.name || "").toLowerCase().trim();
      if (!key || seen.has(key)) return key ? false : true;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary));
}

export function buildCustomerProfile(
  customer: Customer,
  sources: ProfileSources = {},
): CustomerProfile {
  const subs = (sources.subscriptions ?? []).filter((s) => s.customerId === customer.id);
  const licences: ProfileLicence[] = subs.map((s) => ({
    id: s.id,
    product: s.product || "(unnamed)",
    vendor: s.vendor,
    seats: s.seats,
    expiryDate: s.expiryDate,
    status: s.status,
    renewalStage: s.renewalStage,
  }));

  /* A term that has already ended still needs renewing — more urgently, not
     less — so an expired one is not filtered out, only sorted first. */
  const renewals = licences
    .filter((l) => !!l.expiryDate)
    .sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));

  const bills = (sources.bills ?? []).filter((b) => b.balance > 0);
  const currencies = new Set(bills.map((b) => b.currency || "INR"));

  return {
    contacts: contactsOf(customer, sources.contacts ?? []),
    documents: documentsForCustomer(customer.id, sources.documents ?? {}, sources.sellerState),
    activities: [...(sources.activities ?? [])].sort((a, b) => String(b.at).localeCompare(String(a.at))),
    licences,
    renewals,
    outstanding: {
      bills: [...bills].sort((a, b) => b.daysOverdue - a.daysOverdue),
      /* Summed only when there is one currency. Adding rupees to dollars
         produces a number that is wrong in both. */
      total: currencies.size === 1 ? bills.reduce((sum, b) => sum + b.balance, 0) : 0,
      currency: currencies.size === 1 ? [...currencies][0]! : "",
    },
    deals: [...(sources.deals ?? [])].sort((a, b) =>
      String(a.expectedClose ?? "").localeCompare(String(b.expectedClose ?? ""))),
    lost: customer.stage === "lost"
      ? {
          reason: (customer as { lostReason?: string }).lostReason,
          competitor: (customer as { lostCompetitor?: string }).lostCompetitor,
          notes: (customer as { lostNotes?: string }).lostNotes,
        }
      : null,
    notes: [...(customer.notes ?? [])].sort((a, b) => Number(b.ts ?? 0) - Number(a.ts ?? 0)),
  };
}
