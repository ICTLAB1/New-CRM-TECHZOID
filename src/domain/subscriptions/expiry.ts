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
 * A licence bought outright, with no term to run out.
 *
 * TWO FIELDS CAN SAY THIS AND BOTH ARE HONOURED. `type` is what a
 * salesperson picks when they enter the record; `status` carried the same
 * meaning in v1 and in every row already stored. Reading only one of them is
 * how a perpetual licence ended up reporting "340 days left" from a stray
 * expiry date nobody could see was being used.
 *
 * A perpetual licence has no expiry, so it has no countdown, no renewal and
 * no place in a renewal window — whatever date is sitting in the row.
 */
export function isPerpetual(sub: Pick<Subscription, "type" | "status">): boolean {
  return sub.type === "Perpetual" || sub.status === "Perpetual License";
}

/** Statuses that only mean anything against a term: each one is a statement
 *  about where the record sits between its start and its expiry. */
const TERM_STATUSES: readonly string[] = ["Upcoming Renewal", "Renewed", "Expired"];

/**
 * Strip the term off a licence that has none.
 *
 * Applied on save rather than on read so the stored row means what it says:
 * a record that reaches the database with both "Perpetual" and an expiry
 * date is a contradiction waiting to be read by something that only checks
 * one of them — a report, an export, the next feature.
 *
 * "Expired" goes with the date. A licence bought outright cannot have run
 * out, and leaving that word on the row would put the contradiction straight
 * back on screen in a field nothing else looks at.
 */
export function normalizeSubscription(sub: Subscription): Subscription {
  if (!isPerpetual(sub)) return sub;
  return {
    ...sub,
    expiryDate: "",
    renewalStage: "",
    /* Active and Cancelled both stay true of a perpetual licence and are
       left exactly as someone set them. */
    status: TERM_STATUSES.includes(sub.status ?? "") ? "Perpetual License" : sub.status,
  };
}

/**
 * Change the licence type, and take the rest of the record with it.
 *
 * Both directions, because a field that greys itself out and cannot be
 * ungreyed is a worse bug than the one it fixes: picking Perpetual drops the
 * term, and picking anything else drops the status that said there was none.
 */
export function setSubscriptionType(sub: Subscription, type: string): Subscription {
  if (type === "Perpetual") return normalizeSubscription({ ...sub, type });
  const next = { ...sub, type };
  /* Naming a type with a term overrules a status left saying otherwise —
     that status is the only thing that could hold the record perpetual, and
     it is what someone has just contradicted. Clearing the type to "—" says
     nothing either way, so it changes nothing. */
  return type && next.status === "Perpetual License" ? { ...next, status: "Active" } : next;
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
export function daysLeft(
  sub: Pick<Subscription, "expiryDate" | "type" | "status">,
  now: Date = new Date(),
): number {
  /* Before the date is even looked at: a perpetual licence does not expire,
     and a date left behind on one is stale data, not a deadline. */
  if (isPerpetual(sub)) return Infinity;
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
  if (isPerpetual(sub)) return "accent";
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
  if (sub.status === "Cancelled" || sub.status === "Renewed") return sub.status;
  if (isPerpetual(sub)) return "Perpetual licence";
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
    .filter((s) => s.status !== "Cancelled" && s.status !== "Renewed")
    .filter((s) => !isPerpetual(s))
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
