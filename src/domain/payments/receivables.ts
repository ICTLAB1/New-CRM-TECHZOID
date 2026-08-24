import { round2 } from "../money";
import { computePaymentInfo, type PaymentEntry } from "./ledger";

/**
 * What customers owe, and for how long.
 *
 * Pure: no clock of its own, no I/O. `today` is always passed in, so an
 * ageing report can be reproduced for any date and tested without mocking
 * time — which matters, because every number here is a function of the date
 * it was asked on.
 *
 * NOTHING HERE IS STORED. Outstanding and age are derived from the invoice's
 * payment ledger and its due date on every read, so a stale "paid" flag set
 * by hand can never disagree with the money actually recorded.
 */

/** The narrow shape ageing needs. Deliberately not SalesDocument: this must
 *  work for any document that can be owed, and must not tempt anyone into
 *  reading a status field to decide whether it is paid. */
export interface AgeableInvoice {
  id: string;
  number: string;
  ownerId?: string;
  customerId?: string;
  billName?: string;
  /** The date payment falls due. Age is measured from here, not the
   *  invoice date — an invoice on 30-day terms is not overdue on day one. */
  validUntil?: string | null;
  date?: string;
  status?: string;
  currency?: string;
  paymentHistory?: PaymentEntry[] | null;
}

export type AgeBucketId = "current" | "d30" | "d60" | "d90" | "d90plus";

export interface AgeBucket {
  id: AgeBucketId;
  label: string;
  /** Inclusive lower bound in days past due; null upper bound = open-ended. */
  from: number;
  to: number | null;
}

/** The standard four-way split, plus everything not yet due. */
export const AGE_BUCKETS: readonly AgeBucket[] = [
  { id: "current", label: "Not yet due", from: -Infinity, to: 0 },
  { id: "d30", label: "1–30 days", from: 1, to: 30 },
  { id: "d60", label: "31–60 days", from: 31, to: 60 },
  { id: "d90", label: "61–90 days", from: 61, to: 90 },
  { id: "d90plus", label: "Over 90 days", from: 91, to: null },
];

export interface OpenInvoice {
  invoice: AgeableInvoice;
  grand: number;
  amountPaid: number;
  outstanding: number;
  /** Days past the due date. Negative means not yet due. */
  daysOverdue: number;
  bucket: AgeBucketId;
}

export interface Receivables {
  open: OpenInvoice[];
  totalOutstanding: number;
  overdueOutstanding: number;
  byBucket: Record<AgeBucketId, number>;
  /** Outstanding per owner id, for a per-salesperson view. */
  byOwner: Record<string, number>;
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two ISO dates. Calendar days, not elapsed hours: an
 *  invoice due yesterday is one day overdue all of today, whatever the
 *  clock says. */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + "T00:00:00");
  const b = Date.parse(toISO + "T00:00:00");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

export function bucketFor(daysOverdue: number): AgeBucketId {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d30";
  if (daysOverdue <= 60) return "d60";
  if (daysOverdue <= 90) return "d90";
  return "d90plus";
}

/**
 * Build the ageing report.
 *
 * `grandOf` is passed in rather than computed here, so the figure owed is
 * the SAME figure the invoice itself prints — every total in this product
 * comes from computeDocument, and a receivables screen quietly re-deriving
 * one would be the first place the two could disagree.
 */
export function buildReceivables(
  invoices: readonly AgeableInvoice[],
  grandOf: (invoice: AgeableInvoice) => number,
  today: string,
): Receivables {
  const open: OpenInvoice[] = [];

  for (const invoice of invoices) {
    /* A cancelled invoice is not money anyone owes. A draft has not been
       issued, so it is not owed either — issuing it is what creates the
       debt, and counting drafts would overstate the book. */
    if (invoice.status === "Cancelled" || invoice.status === "Draft") continue;

    const grand = grandOf(invoice);
    const { amountPaid, outstanding } = computePaymentInfo(invoice, grand, today);
    if (outstanding <= 0) continue;

    const daysOverdue = invoice.validUntil ? daysBetween(invoice.validUntil, today) : 0;
    open.push({ invoice, grand, amountPaid, outstanding, daysOverdue, bucket: bucketFor(daysOverdue) });
  }

  /* Oldest debt first: the list is a to-do, and the thing most at risk of
     never being collected belongs at the top. */
  open.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const byBucket = {
    current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0,
  } as Record<AgeBucketId, number>;
  const byOwner: Record<string, number> = {};

  for (const row of open) {
    byBucket[row.bucket] = round2(byBucket[row.bucket] + row.outstanding);
    const owner = row.invoice.ownerId || "";
    byOwner[owner] = round2((byOwner[owner] ?? 0) + row.outstanding);
  }

  const totalOutstanding = round2(open.reduce((a, r) => a + r.outstanding, 0));
  const overdueOutstanding = round2(
    open.filter((r) => r.daysOverdue > 0).reduce((a, r) => a + r.outstanding, 0),
  );

  return { open, totalOutstanding, overdueOutstanding, byBucket, byOwner };
}
