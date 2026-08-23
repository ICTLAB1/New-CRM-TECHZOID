import type { Tone } from "../../components/primitives";

/**
 * Subscription expiry.
 *
 * The renewal business runs on this number, so it is computed from the
 * expiry date every time rather than stored — a stored "days left" is wrong
 * by definition the next morning.
 */

export const SUB_STATUSES = [
  "Active", "Upcoming Renewal", "Renewed", "Expired", "Cancelled", "Perpetual License",
] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];

export const SUB_TYPES = ["Subscription", "Perpetual", "AMC", "Support Contract", "Software Assurance"] as const;

export const SUB_VENDORS = [
  "Microsoft", "Adobe", "Autodesk", "VMware", "Kaspersky", "Dell", "HP", "Lenovo", "Sophos", "Fortinet", "Other",
] as const;

export const SUB_BILLING = ["Monthly", "Annual", "3-Year", "One-time"] as const;

export const RENEWAL_STAGES = [
  "Upcoming", "Reminder Sent", "Customer Contacted", "Quotation Sent",
  "Negotiation", "PO Received", "Invoice Generated", "Renewed", "Expired", "Lost",
] as const;
export type RenewalStage = (typeof RENEWAL_STAGES)[number];

export interface Subscription {
  id: string;
  ownerId: string;
  customerId?: string;
  customerName?: string;
  vendor?: string;
  product?: string;
  type?: string;
  billing?: string;
  startDate?: string;
  expiryDate?: string;
  seats?: number | string;
  sellPrice?: number | string;
  status?: string;
  renewalStage?: string;
  notes?: string;
  createdAt?: number;
  /* When the row last changed. Incentive schemes date a renewal by this,
     which is the only thing in the record that says WHEN it was renewed. */
  updatedAt?: number;
}

/**
 * Days until expiry, counted in CALENDAR days. Today is 0; yesterday is -1.
 *
 * DEVIATION FROM v1 (deliberate): v1 measured to 23:59:59 on the expiry date
 * from the current clock time, so a subscription expiring today reported
 * "1 day left" for most of the working day — read by a salesperson as a day
 * of runway that does not exist. Counting whole calendar days makes the
 * number mean what its label says.
 *
 * A subscription with no expiry date never expires; a perpetual licence is
 * the usual case and must not read as overdue.
 */
export function daysLeft(sub: Pick<Subscription, "expiryDate">, now: Date = new Date()): number {
  if (!sub.expiryDate) return Infinity;
  const end = new Date(sub.expiryDate + "T00:00:00");
  if (isNaN(end.getTime())) return Infinity;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}

/**
 * How urgent this renewal is.
 *
 * Explicit statuses win: a cancelled or already-renewed subscription is not
 * "expiring in 4 days", however its date reads.
 */
export function expiryTone(sub: Subscription, now: Date = new Date()): Tone {
  if (sub.status === "Cancelled") return "neutral";
  if (sub.status === "Perpetual License") return "accent";
  if (sub.status === "Renewed") return "good";
  const d = daysLeft(sub, now);
  /* DEVIATION FROM v1: v1 greyed an expired subscription out. A lapsed
     licence the customer has not renewed is the most urgent row on the
     screen — they are unlicensed today — and red means overdue everywhere
     else in this product. Fading it contradicted the sort, which puts it
     first. */
  if (d < 0) return "bad";
  if (d < 7) return "bad";
  if (d < 30) return "warn";
  return "good";
}

/** Human phrasing for the same thing. */
export function expiryLabel(sub: Subscription, now: Date = new Date()): string {
  if (sub.status === "Cancelled" || sub.status === "Perpetual License" || sub.status === "Renewed") {
    return sub.status;
  }
  const d = daysLeft(sub, now);
  if (d === Infinity) return "No expiry date";
  if (d < 0) return `Expired ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ago`;
  if (d === 0) return "Expires today";
  return `${d} day${d === 1 ? "" : "s"} left`;
}

/** Renewals worth acting on now, soonest first. */
export function dueForRenewal(
  subs: readonly Subscription[],
  withinDays = 30,
  now: Date = new Date(),
): Subscription[] {
  return subs
    .filter((s) => s.status !== "Cancelled" && s.status !== "Renewed" && s.status !== "Perpetual License")
    /* Someone has explicitly given up on a Lost renewal; leaving it on the
       due list means the list stops being a to-do. */
    .filter((s) => s.renewalStage !== "Lost")
    .filter((s) => {
      const d = daysLeft(s, now);
      return d !== Infinity && d <= withinDays;
    })
    .sort((a, b) => daysLeft(a, now) - daysLeft(b, now));
}

/** Value at risk in the window — the number that makes a renewal list matter. */
export function valueAtRisk(subs: readonly Subscription[], withinDays = 30, now: Date = new Date()): number {
  return dueForRenewal(subs, withinDays, now).reduce((a, s) => a + (Number(s.sellPrice) || 0), 0);
}
