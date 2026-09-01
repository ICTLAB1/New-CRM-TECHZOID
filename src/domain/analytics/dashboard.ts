import { computeDocument } from "../tax/compute";
import { computePaymentInfo } from "../payments/ledger";
import { effectiveStatus, type SalesDocument } from "../documents/create";
import { orderStageOf } from "../orders/stages";
import { orderFulfilment, type Challan } from "../orders/fulfilment";
import type { SalesOrder } from "../orders/create";
import { daysLeft, dueForRenewal, valueAtRisk, type Subscription } from "../subscriptions/expiry";
import type { Customer } from "../customers/customer";
import { totalsByCurrency, type CurrencyTotal } from "../currency/format";
import { countsAsWon, isOpenStage, wonAmount } from "../pipeline/stages";
import { scopeTo, type Owned } from "./scope";
import { TODAY } from "../dates";

export interface Workspace {
  customers: Customer[];
  quotations: SalesDocument[];
  proformas: SalesDocument[];
  /** Tax invoices. Optional because this shape predates them, and every
   *  caller that does not need them still type-checks — but the incentive
   *  calculation DOES need them, and not passing them is why a ₹22 lakh
   *  invoice counted for nothing there. */
  invoices?: SalesDocument[];
  orders: SalesOrder[];
  challans: Challan[];
  subscriptions: Subscription[];
}

export interface DashboardUser {
  id: string;
  role: string;
}

/** Everything the dashboard reads, already narrowed to what this user sees. */
export function scopeWorkspace(ws: Workspace, user: DashboardUser): Workspace {
  const scope = <T extends Owned>(rows: T[]) => scopeTo(rows, user);
  const orders = scope(ws.orders);
  const orderIds = new Set(orders.map((o) => o.id));
  return {
    customers: scope(ws.customers),
    quotations: scope(ws.quotations),
    proformas: scope(ws.proformas),
    invoices: scope(ws.invoices ?? []),
    orders,
    /* Challans have no owner of their own — they follow their order. */
    challans: ws.challans.filter((c) => orderIds.has(c.orderId)),
    subscriptions: scope(ws.subscriptions),
  };
}

const grandOf = (doc: { items?: unknown; taxType?: string | null }, sellerState: string): number =>
  computeDocument(doc as Parameters<typeof computeDocument>[0], sellerState).grand;

export interface Kpis {
  /* PER CURRENCY, like the team table below them. These two tiles and that
     table read the same customer.value, so a single rupee figure here beside
     a split one there would have the screen disagreeing with itself — and the
     rupee figure was the wrong one. */
  openPipeline: CurrencyTotal[];
  openDeals: number;
  wonThisMonth: CurrencyTotal[];
  wonThisMonthCount: number;
  quotesPending: number;
  quotesStale: number;
  paymentsDue: number;
  paymentsOverdue: number;
  renewalsDue: number;
  renewalsValue: number;
}

export function kpis(ws: Workspace, sellerState: string, now: Date = new Date()): Kpis {
  const today = now.toISOString().slice(0, 10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const open = ws.customers.filter((c) => isOpenStage(c.stage));
  const won = ws.customers.filter((c) => countsAsWon(c) && (c.wonAt ?? 0) >= monthStart);

  const pending = ws.quotations.filter((q) => effectiveStatus(q, today) === "Sent");
  const stale = ws.quotations.filter((q) => q.status === "Sent" && effectiveStatus(q, today) === "Expired");

  /* PROFORMAS AND TAX INVOICES BOTH. Invoices were added to the CRM after
     this tile was written and never wired into it, so an overdue invoice
     showed on Receivables and nowhere on the dashboard — the screen people
     actually look at first. Money owed is money owed whichever document
     asked for it. */
  let paymentsDue = 0;
  let paymentsOverdue = 0;
  for (const doc of [...ws.proformas, ...(ws.invoices ?? [])]) {
    if (doc.status === "Draft") continue;
    const info = computePaymentInfo(doc, grandOf(doc, sellerState), today);
    if (info.paymentStatus === "paid") continue;
    paymentsDue += info.outstanding;
    if (info.overdue) paymentsOverdue++;
  }

  return {
    openPipeline: totalsByCurrency(open, (c) => Number(c.value) || 0, (c) => c.currency),
    openDeals: open.length,
    wonThisMonth: totalsByCurrency(won, wonAmount, (c) => c.currency),
    wonThisMonthCount: won.length,
    quotesPending: pending.length,
    quotesStale: stale.length,
    paymentsDue,
    paymentsOverdue,
    renewalsDue: dueForRenewal(ws.subscriptions, 30, now).length,
    renewalsValue: valueAtRisk(ws.subscriptions, 30, now),
  };
}

export type AttentionKind = "overdue-proforma" | "follow-up" | "stale-quotation" | "renewal";

export interface AttentionRow {
  kind: AttentionKind;
  id: string;
  title: string;
  detail: string;
  /** Sorted by this: bigger is more urgent. */
  urgency: number;
  value?: number;
  /** The currency `value` is in. A proforma in dollars and a deal in rupees
   *  sit in the same list, and a row that shows the wrong symbol is telling
   *  somebody the wrong thing about money they are chasing. */
  currency?: string;
  tone: "bad" | "warn";
  /** Where clicking this row should go. */
  view: string;
}

/**
 * The needs-attention list.
 *
 * Everything on it is something a person has to act on today, with the screen
 * it belongs to attached — a list of problems with no way through to them is
 * a list people stop reading.
 */
export function needsAttention(ws: Workspace, sellerState: string, now: Date = new Date()): AttentionRow[] {
  const today = now.toISOString().slice(0, 10);
  const rows: AttentionRow[] = [];

  for (const pf of [...ws.proformas, ...(ws.invoices ?? [])]) {
    if (pf.status === "Draft") continue;
    const info = computePaymentInfo(pf, grandOf(pf, sellerState), today);
    if (!info.overdue) continue;
    const daysLate = Math.round((Date.parse(today) - Date.parse(pf.validUntil)) / 86_400_000);
    rows.push({
      kind: "overdue-proforma", id: pf.id,
      title: `${pf.number} — ${pf.billName}`,
      detail: `${daysLate} day${daysLate === 1 ? "" : "s"} past due · ${info.pct}% collected`,
      urgency: 1000 + daysLate, value: info.outstanding, currency: pf.currency, tone: "bad", view: "proformas",
    });
  }

  for (const c of ws.customers) {
    if (!c.nextFollowUp || !isOpenStage(c.stage)) continue;
    if (c.nextFollowUp > today) continue;
    const daysLate = Math.round((Date.parse(today) - Date.parse(c.nextFollowUp)) / 86_400_000);
    rows.push({
      kind: "follow-up", id: c.id,
      title: c.company ?? "Untitled customer",
      detail: daysLate === 0 ? "Follow-up due today" : `Follow-up ${daysLate} day${daysLate === 1 ? "" : "s"} overdue`,
      urgency: 500 + daysLate, value: Number(c.value) || 0, currency: c.currency,
      tone: daysLate > 0 ? "bad" : "warn", view: "customers",
    });
  }

  for (const q of ws.quotations) {
    if (q.status !== "Sent" || effectiveStatus(q, today) !== "Expired") continue;
    const daysLate = Math.round((Date.parse(today) - Date.parse(q.validUntil)) / 86_400_000);
    rows.push({
      kind: "stale-quotation", id: q.id,
      title: `${q.number} — ${q.billName}`,
      detail: `Sent, past validity by ${daysLate} day${daysLate === 1 ? "" : "s"}`,
      urgency: 300 + daysLate, value: grandOf(q, sellerState), currency: q.currency, tone: "warn", view: "quotations",
    });
  }

  for (const sub of dueForRenewal(ws.subscriptions, 30, now)) {
    const left = daysLeft(sub, now);
    rows.push({
      kind: "renewal", id: sub.id,
      title: `${sub.customerName ?? "Customer"} — ${sub.product ?? "Subscription"}`,
      detail: left < 0 ? `Lapsed ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"} ago` : `Expires in ${left} day${left === 1 ? "" : "s"}`,
      urgency: left < 0 ? 900 + Math.abs(left) : 200 + (30 - left),
      value: Number(sub.sellPrice) || 0,
      tone: left < 7 ? "bad" : "warn", view: "renewals",
    });
  }

  return rows.sort((a, b) => b.urgency - a.urgency);
}

export interface MonthPoint {
  key: string;
  label: string;
  value: number;
  count: number;
}

/**
 * Trailing revenue, from the timestamp a deal was actually won.
 *
 * Not from createdAt, not from the current stage — `wonAt` is stamped once
 * when a deal first moves to Won and never re-stamped, which is what makes a
 * trailing chart mean anything.
 */
export function trailingRevenue(ws: Workspace, months = 6, now: Date = new Date()): MonthPoint[] {
  const points: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const won = ws.customers.filter(
      (c) => countsAsWon(c) && (c.wonAt ?? 0) >= start.getTime() && (c.wonAt ?? 0) < end.getTime(),
    );
    points.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: start.toLocaleDateString("en-IN", { month: "short" }),
      value: won.reduce((a, c) => a + wonAmount(c), 0),
      count: won.length,
    });
  }
  return points;
}

export interface FunnelStep {
  id: string;
  label: string;
  count: number;
  totals: CurrencyTotal[];
}

export function pipelineFunnel(ws: Workspace, stages: readonly { id: string; label: string }[]): FunnelStep[] {
  return stages.map((s) => {
    const inStage = ws.customers.filter((c) => (c.stage ?? "lead") === s.id);
    return {
      id: s.id,
      label: s.label,
      count: inStage.length,
      /* Same field, same treatment. A stage holding one AED deal and one
         rupee deal has no single total, and inventing one by addition is how
         the number stopped meaning anything. */
      totals: totalsByCurrency(inStage, (c) => Number(c.value) || 0, (c) => c.currency),
    };
  });
}

export interface TeamRow {
  ownerId: string;
  name: string;
  openDeals: number;
  /** Open pipeline, KEPT APART BY CURRENCY. Not one number: adding a dollar
   *  deal to a rupee one produces a figure in no unit at all, and printing it
   *  with a ₹ in front makes it a wrong figure rather than a meaningless one.
   *  Same treatment the proforma and invoice lists already got. */
  openTotals: CurrencyTotal[];
  wonDeals: number;
  wonTotals: CurrencyTotal[];
  quotations: number;
}

/** What a row sorts on. The house currency, because a table has to be in some
 *  order and comparing a dollar total against a rupee one to decide who goes
 *  first is the very thing this change exists to stop. */
const inHouseCurrency = (totals: readonly CurrencyTotal[]): number =>
  totals.find((t) => t.code === "INR")?.total ?? 0;

export function teamPerformance(
  ws: Workspace,
  users: { id: string; name: string }[],
  now: Date = new Date(),
): TeamRow[] {
  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime();
  return users
    .map((u) => {
      const mine = ws.customers.filter((c) => c.ownerId === u.id);
      const open = mine.filter((c) => isOpenStage(c.stage));
      const won = mine.filter((c) => countsAsWon(c) && (c.wonAt ?? 0) >= from);
      return {
        ownerId: u.id, name: u.name,
        openDeals: open.length,
        openTotals: totalsByCurrency(open, (c) => Number(c.value) || 0, (c) => c.currency),
        wonDeals: won.length,
        wonTotals: totalsByCurrency(won, wonAmount, (c) => c.currency),
        quotations: ws.quotations.filter((q) => q.ownerId === u.id).length,
      };
    })
    /* A person with open deals belongs here even when every one of them has a
       blank value — that is a row worth seeing, and the deal count beside the
       money is what says so. Filtering on the money alone hid them. */
    .filter((r) => r.openDeals || r.wonDeals || r.quotations)
    .sort((a, b) =>
      inHouseCurrency(b.wonTotals) - inHouseCurrency(a.wonTotals)
      || inHouseCurrency(b.openTotals) - inHouseCurrency(a.openTotals)
      || a.name.localeCompare(b.name));
}

export interface DeliveryRow {
  id: string;
  number: string;
  customer: string;
  stage: string;
  pct: number;
}

export function deliveriesInProgress(ws: Workspace): DeliveryRow[] {
  return ws.orders
    .filter((o) => orderStageOf(o.stage).open)
    .map((o) => ({
      id: o.id, number: o.number, customer: o.billName,
      stage: orderStageOf(o.stage).label,
      pct: orderFulfilment(o, ws.challans).pct,
    }))
    .sort((a, b) => b.pct - a.pct);
}

export { TODAY };
