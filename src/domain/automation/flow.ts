import type { Customer } from "../customers/customer";
import type { SalesDocument } from "../documents/create";
import type { SalesOrder } from "../orders/create";
import type { Subscription } from "../subscriptions/expiry";
import { dueForRenewal } from "../subscriptions/expiry";
import { computePaymentInfo } from "../payments/ledger";
import { stageAfterQuotation, concludedAt } from "../pipeline/advance";
import type { StageId } from "../pipeline/stages";
import { addDays } from "../dates";

/**
 * The CRM running its own process.
 *
 * Three things happen here without anybody clicking:
 *
 *   STAGES   a quotation or proforma that goes out moves the customer to
 *            Quotation Sent; one that is accepted (or a proforma that is
 *            paid) marks the deal Won.
 *   CHAIN    an accepted quotation, or a paid proforma, becomes a sales
 *            order; a delivered sales order gets its tax invoice drafted.
 *   TASKS    a follow-up lands on the owner's list three days after a
 *            quotation goes out, the day an invoice falls overdue, and
 *            thirty days before a subscription expires.
 *
 * THIS MODULE ONLY DECIDES. It returns a list of steps; the runner
 * (src/app/useAutomations.ts) carries them out with the same functions a
 * person's click would use, so an automatic sales order is numbered and
 * shaped exactly like a hand-made one.
 *
 * EVERY STEP HAPPENS ONCE. Each source record is stamped (`auto`) when it
 * has been acted on, and the chain also checks for a child that already
 * exists — so an order somebody raised by hand is never doubled, and a
 * second browser refreshing the same data finds the stamp and does nothing.
 *
 * NOTHING IN THE PAST IS REPLAYED. Only records changed after the
 * automations were switched on are considered; a quotation accepted in
 * August does not grow a sales order today.
 */

/** When automations were switched on. Records last changed before this are
 *  history and are left exactly as they are. */
export const AUTOMATION_START = Date.parse("2026-10-11T17:00:00Z");

/** Days after a quotation goes out that its follow-up is due. */
export const FOLLOW_UP_DAYS = 3;
/** How far ahead of an expiry the renewal task appears. */
export const RENEWAL_NOTICE_DAYS = 30;
/** How long a record waits for its own owner before an admin's browser
 *  picks it up instead — so automations still run for a salesperson who is
 *  not signed in today. */
export const ADMIN_GRACE_MS = 15 * 60_000;

/** What has already been done for a record. Stored on the record itself. */
export interface AutoStamp {
  won?: number;
  orderId?: string;
  invoiceId?: string;
  followUp?: number;
  /** The due date the overdue task was raised for, so a new due date gets
   *  a new task and the same one never gets two. */
  overdueFor?: string;
  /** The expiry date the renewal task was raised for. */
  renewalFor?: string;
}

type Stamped = { auto?: AutoStamp };

export interface FlowInput {
  customers: readonly Customer[];
  quotations: readonly (SalesDocument & Stamped)[];
  proformas: readonly (SalesDocument & Stamped)[];
  invoices: readonly (SalesDocument & Stamped)[];
  orders: readonly (SalesOrder & Stamped)[];
  subscriptions: readonly (Subscription & Stamped)[];
  me: { id: string; role?: string };
  today: string;
  now: number;
  /** Grand total of a document, for "is this invoice paid". */
  grandOf: (doc: SalesDocument) => number;
}

export type FlowStep =
  | { kind: "stage"; customerId: string; stage: StageId; requote: boolean; reason: string;
      /** For a win: what the accepted document was worth. */
      value?: number;
      stamp?: { list: "quotations" | "proformas"; id: string; patch: AutoStamp } }
  | { kind: "order"; source: SalesDocument; from: "quotation" | "proforma" }
  | { kind: "invoice"; order: SalesOrder; source: SalesDocument }
  | { kind: "task"; customerId: string; due: string; text: string;
      stamp: { list: "quotations" | "proformas" | "invoices" | "subscriptions"; id: string; patch: AutoStamp } };

/** Is this browser the one that should act on this record? Its owner, or
 *  an admin once the owner has had a fair chance. */
export function isMine(
  rec: { ownerId?: string; updatedAt?: number },
  me: { id: string; role?: string },
  now: number,
): boolean {
  if (rec.ownerId && rec.ownerId === me.id) return true;
  return me.role === "Admin" && now - (rec.updatedAt ?? 0) > ADMIN_GRACE_MS;
}

const fresh = (rec: { updatedAt?: number }): boolean => (rec.updatedAt ?? 0) >= AUTOMATION_START;

const accepted = (doc: SalesDocument, from: "quotation" | "proforma"): boolean =>
  from === "quotation" ? doc.status === "Accepted" : doc.status === "Paid";

export function planAutomations(input: FlowInput): FlowStep[] {
  const { customers, quotations, proformas, invoices, orders, subscriptions, me, today, now } = input;
  const steps: FlowStep[] = [];
  const customer = (id?: string | null) => customers.find((c) => c.id === id);
  /* A customer moved by one step is moved once per run, by the first
     (most decisive) reason — Won beats Quotation Sent. */
  const stagedThisRun = new Set<string>();

  const sources: { list: "quotations" | "proformas"; from: "quotation" | "proforma"; docs: FlowInput["quotations"] }[] = [
    { list: "quotations", from: "quotation", docs: quotations },
    { list: "proformas", from: "proforma", docs: proformas },
  ];

  /* ── stages: Won first ─────────────────────────────────────────────── */
  for (const { list, from, docs } of sources) {
    for (const doc of docs) {
      if (!fresh(doc) || !isMine(doc, me, now) || !doc.customerId) continue;
      if (!accepted(doc, from) || doc.auto?.won) continue;
      const c = customer(doc.customerId);
      if (!c) continue;
      const alreadyWonForThis = c.stage === "won" && (c.wonAt ?? 0) >= (doc.createdAt ?? 0);
      /* Already Won for this deal (somebody dragged the card): only stamp
         the document, so it is not looked at again. An empty reason tells
         the runner there is nothing to move. */
      steps.push({
        kind: "stage",
        customerId: c.id,
        stage: "won",
        requote: false,
        reason: alreadyWonForThis ? ""
          : `${from === "quotation" ? "Quotation" : "Proforma"} ${doc.number} ${from === "quotation" ? "accepted" : "paid"}`,
        value: input.grandOf(doc) || undefined,
        stamp: { list, id: doc.id, patch: { won: now } },
      });
      stagedThisRun.add(c.id);
    }
  }

  /* ── stages: Quotation Sent ────────────────────────────────────────── */
  for (const { from, docs } of sources) {
    for (const doc of docs) {
      if (!fresh(doc) || !isMine(doc, me, now) || !doc.customerId) continue;
      if (doc.status !== "Sent" || stagedThisRun.has(doc.customerId)) continue;
      const c = customer(doc.customerId);
      if (!c) continue;
      const stage = stageAfterQuotation(c.stage, { concludedAt: concludedAt(c), quotedAt: doc.createdAt });
      if (!stage) continue;
      steps.push({
        kind: "stage", customerId: c.id, stage, requote: c.stage === "won" || c.stage === "lost",
        reason: `${from === "quotation" ? "Quotation" : "Proforma"} ${doc.number} sent`,
      });
      stagedThisRun.add(c.id);
    }
  }

  /* ── chain: accepted quotation / paid proforma → sales order ──────── */
  for (const { from, docs } of sources) {
    for (const doc of docs) {
      if (!fresh(doc) || !isMine(doc, me, now) || !accepted(doc, from)) continue;
      if (doc.auto?.orderId) continue;
      const linked = orders.some((o) =>
        o.proformaId === doc.id || o.quoteId === doc.id
        /* A paid proforma whose quotation already became an order is the
           same deal; it must not become a second one. */
        || (from === "proforma" && !!doc.quoteId && o.quoteId === doc.quoteId));
      if (linked) continue;
      steps.push({ kind: "order", source: doc, from });
    }
  }

  /* ── chain: delivered order → draft tax invoice ───────────────────── */
  for (const order of orders) {
    if (!fresh(order) || !isMine(order, me, now)) continue;
    if (order.stage !== "delivered" || order.auto?.invoiceId) continue;
    const invoiced = invoices.some((inv) =>
      (inv as SalesDocument & { orderId?: string }).orderId === order.id
      || (!!order.proformaId && inv.quoteId === order.proformaId)
      || (!!order.quoteId && inv.quoteId === order.quoteId));
    if (invoiced) continue;
    const source = proformas.find((p) => p.id === order.proformaId)
      ?? quotations.find((q) => q.id === order.quoteId)
      ?? quotations.find((q) => q.id === order.proformaId);
    if (!source) continue;
    steps.push({ kind: "invoice", order, source });
  }

  /* ── tasks: follow up a quotation that went out ───────────────────── */
  for (const { list, docs } of sources) {
    for (const doc of docs) {
      if (!fresh(doc) || !isMine(doc, me, now) || !doc.customerId) continue;
      if (doc.status !== "Sent" || doc.auto?.followUp) continue;
      const due = addDays(today, FOLLOW_UP_DAYS);
      steps.push({
        kind: "task", customerId: doc.customerId, due,
        text: `Follow up on ${list === "quotations" ? "quotation" : "proforma"} ${doc.number} — did it reach the right person, any questions on price?`,
        stamp: { list, id: doc.id, patch: { followUp: now } },
      });
    }
  }

  /* ── tasks: an invoice has fallen overdue ─────────────────────────── */
  for (const inv of invoices) {
    if (inv.status !== "Issued" || !inv.customerId || !inv.validUntil) continue;
    if (!isMine(inv, me, now) || inv.auto?.overdueFor === inv.validUntil) continue;
    const pay = computePaymentInfo(inv, input.grandOf(inv), today);
    if (!pay.overdue) continue;
    steps.push({
      kind: "task", customerId: inv.customerId, due: today,
      text: `Collect payment: invoice ${inv.number} was due ${inv.validUntil}, ${pay.outstanding.toLocaleString("en-IN")} outstanding.`,
      stamp: { list: "invoices", id: inv.id, patch: { overdueFor: inv.validUntil } },
    });
  }

  /* ── tasks: a subscription is coming up for renewal ───────────────── */
  for (const sub of dueForRenewal(subscriptions, RENEWAL_NOTICE_DAYS, new Date(now))) {
    const s = sub as Subscription & Stamped;
    if (!s.customerId || !s.expiryDate || !isMine(s, me, now)) continue;
    /* Coming up, not already lapsed: a subscription that ran out months
       ago is history, and raising a task for every one of them on the day
       this was switched on would bury the list. */
    if (s.expiryDate < today) continue;
    if (s.auto?.renewalFor === s.expiryDate) continue;
    steps.push({
      kind: "task", customerId: s.customerId, due: today,
      text: `Renewal: ${[s.vendor, s.product].filter(Boolean).join(" ") || "subscription"} expires ${s.expiryDate} — send the renewal quotation.`,
      stamp: { list: "subscriptions", id: s.id, patch: { renewalFor: s.expiryDate } },
    });
  }

  return steps;
}

/** The earlier of two follow-up dates, ignoring one already in the past
 *  (a stale date is replaced, not kept). */
export function nextFollowUpDate(current: string | undefined, proposed: string, today: string): string {
  if (!current || current < today) return proposed;
  return current < proposed ? current : proposed;
}
