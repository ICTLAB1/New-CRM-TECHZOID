import { computeDocument } from "../tax/compute";
import { computePaymentInfo } from "../payments/ledger";
import { effectiveStatus } from "../documents/create";
import { STAGES, countsAsWon, stageOf, wonAmount } from "../pipeline/stages";
import { orderStageOf } from "../orders/stages";
import { orderFulfilment } from "../orders/fulfilment";
import { daysLeft, expiryLabel, isPerpetual } from "../subscriptions/expiry";
import { trailingRevenue, type Workspace } from "../analytics/dashboard";
import { fmtDate } from "../dates";

/**
 * The report definitions.
 *
 * One shape for all of them: columns, rows and an optional total. The table
 * renders from `columns` and the CSV is built from the same list, so a report
 * cannot export a different set of fields from the one it shows — which three
 * of v1's ten did.
 */

export interface ReportColumn {
  key: string;
  label: string;
  money?: boolean;
  number?: boolean;
}

export interface Report {
  id: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null | undefined>[];
  total?: Record<string, number>;
}

const sum = (rows: Record<string, unknown>[], key: string): number =>
  rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

export function buildReports(
  ws: Workspace,
  users: { id: string; name: string }[],
  sellerState: string,
  months = 6,
  now: Date = new Date(),
): Report[] {
  const today = now.toISOString().slice(0, 10);
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1).getTime();
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "Unassigned";
  const grand = (d: Parameters<typeof computeDocument>[0]) => computeDocument(d, sellerState).grand;

  const reports: Report[] = [];

  /* ── revenue by month ── */
  const revenueRows = trailingRevenue(ws, months, now).map((p) => ({
    month: p.label, period: p.key, deals: p.count, revenue: p.value,
  }));
  reports.push({
    id: "revenue", title: "Revenue", description: `Won deals by month, from the date each was won. Last ${months} months.`,
    columns: [
      { key: "month", label: "Month" }, { key: "period", label: "Period" },
      { key: "deals", label: "Deals", number: true }, { key: "revenue", label: "Revenue", money: true },
    ],
    rows: revenueRows,
    total: { deals: sum(revenueRows, "deals"), revenue: sum(revenueRows, "revenue") },
  });

  /* ── by salesperson ── */
  const bySales = users.map((u) => {
    const mine = ws.customers.filter((c) => c.ownerId === u.id);
    const won = mine.filter((c) => countsAsWon(c) && (c.wonAt ?? 0) >= from);
    const open = mine.filter((c) => c.stage !== "won" && c.stage !== "lost");
    const lost = mine.filter((c) => c.stage === "lost");
    return {
      person: u.name, accounts: mine.length, open: open.length,
      openValue: open.reduce((a, c) => a + (Number(c.value) || 0), 0),
      wonDeals: won.length, wonValue: won.reduce((a, c) => a + wonAmount(c), 0),
      lostDeals: lost.length,
      quotations: ws.quotations.filter((q) => q.ownerId === u.id).length,
    };
  }).filter((r) => r.accounts || r.quotations);
  reports.push({
    id: "salespeople", title: "By salesperson", description: "Accounts, pipeline and closed business per person.",
    columns: [
      { key: "person", label: "Person" }, { key: "accounts", label: "Accounts", number: true },
      { key: "open", label: "Open", number: true }, { key: "openValue", label: "Open value", money: true },
      { key: "wonDeals", label: "Won", number: true }, { key: "wonValue", label: "Won value", money: true },
      { key: "lostDeals", label: "Lost", number: true }, { key: "quotations", label: "Quotations", number: true },
    ],
    rows: bySales,
    total: {
      accounts: sum(bySales, "accounts"), open: sum(bySales, "open"), openValue: sum(bySales, "openValue"),
      wonDeals: sum(bySales, "wonDeals"), wonValue: sum(bySales, "wonValue"),
      lostDeals: sum(bySales, "lostDeals"), quotations: sum(bySales, "quotations"),
    },
  });

  /* ── sales drill-down ── */
  const drill = ws.quotations.map((q) => ({
    number: q.number, customer: q.billName, owner: nameOf(q.ownerId),
    date: fmtDate(q.date), status: effectiveStatus(q, today), value: grand(q),
  }));
  reports.push({
    id: "drilldown", title: "Sales drill-down", description: "Every quotation raised, with its live status.",
    columns: [
      { key: "number", label: "Number" }, { key: "customer", label: "Customer" },
      { key: "owner", label: "Owner" }, { key: "date", label: "Date" },
      { key: "status", label: "Status" }, { key: "value", label: "Value", money: true },
    ],
    rows: drill, total: { value: sum(drill, "value") },
  });

  /* ── quotation analysis ── */
  const statuses = ["Draft", "Sent", "Accepted", "Rejected", "Expired"];
  const analysis = statuses.map((s) => {
    const inStatus = ws.quotations.filter((q) => effectiveStatus(q, today) === s);
    return {
      status: s, count: inStatus.length,
      value: inStatus.reduce((a, q) => a + grand(q), 0),
      share: ws.quotations.length ? Math.round((inStatus.length / ws.quotations.length) * 100) + "%" : "0%",
    };
  });
  reports.push({
    id: "quotations", title: "Quotation analysis", description: "Where quotations end up.",
    columns: [
      { key: "status", label: "Status" }, { key: "count", label: "Count", number: true },
      { key: "value", label: "Value", money: true }, { key: "share", label: "Share" },
    ],
    rows: analysis, total: { count: sum(analysis, "count"), value: sum(analysis, "value") },
  });

  /* ── pipeline funnel ── */
  const funnel = STAGES.map((s) => {
    const inStage = ws.customers.filter((c) => (c.stage ?? "lead") === s.id);
    return { stage: s.label, count: inStage.length, value: inStage.reduce((a, c) => a + (Number(c.value) || 0), 0) };
  });
  reports.push({
    id: "funnel", title: "Pipeline funnel", description: "Deals and value at each stage.",
    columns: [{ key: "stage", label: "Stage" }, { key: "count", label: "Deals", number: true }, { key: "value", label: "Value", money: true }],
    rows: funnel, total: { count: sum(funnel, "count"), value: sum(funnel, "value") },
  });

  /* ── lost deals ── */
  const lost = ws.customers.filter((c) => c.stage === "lost").map((c) => ({
    customer: c.company, owner: nameOf(c.ownerId), value: Number(c.value) || 0,
    reason: c.lostReason || "Not recorded", competitor: c.lostCompetitor || "—", notes: c.lostNotes || "",
  }));
  reports.push({
    id: "lost", title: "Lost deals", description: "Why deals did not close. Blank reasons are the ones worth chasing.",
    columns: [
      { key: "customer", label: "Customer" }, { key: "owner", label: "Owner" },
      { key: "value", label: "Value", money: true }, { key: "reason", label: "Reason" },
      { key: "competitor", label: "Competitor" }, { key: "notes", label: "Notes" },
    ],
    rows: lost, total: { value: sum(lost, "value") },
  });

  /* ── by segment ── */
  const segments = [...new Set(ws.customers.map((c) => c.segment || "Unspecified"))].map((seg) => {
    const inSeg = ws.customers.filter((c) => (c.segment || "Unspecified") === seg);
    const won = inSeg.filter((c) => countsAsWon(c));
    return {
      segment: seg, accounts: inSeg.length,
      pipeline: inSeg.filter((c) => c.stage !== "won" && c.stage !== "lost").reduce((a, c) => a + (Number(c.value) || 0), 0),
      won: won.reduce((a, c) => a + wonAmount(c), 0),
    };
  });
  reports.push({
    id: "segments", title: "By segment", description: "Where the business comes from.",
    columns: [
      { key: "segment", label: "Segment" }, { key: "accounts", label: "Accounts", number: true },
      { key: "pipeline", label: "Pipeline", money: true }, { key: "won", label: "Won", money: true },
    ],
    rows: segments, total: { accounts: sum(segments, "accounts"), pipeline: sum(segments, "pipeline"), won: sum(segments, "won") },
  });

  /* ── by vendor ── */
  const vendors = [...new Set(ws.subscriptions.map((s) => s.vendor || "Unspecified"))].map((v) => {
    const mine = ws.subscriptions.filter((s) => (s.vendor || "Unspecified") === v);
    return { vendor: v, subscriptions: mine.length, value: mine.reduce((a, s) => a + (Number(s.sellPrice) || 0), 0) };
  });
  reports.push({
    id: "vendors", title: "By vendor", description: "Subscriptions under management, by vendor.",
    columns: [{ key: "vendor", label: "Vendor" }, { key: "subscriptions", label: "Subscriptions", number: true }, { key: "value", label: "Annual value", money: true }],
    rows: vendors, total: { subscriptions: sum(vendors, "subscriptions"), value: sum(vendors, "value") },
  });

  /* ── subscription expiry ── */
  const expiry = [...ws.subscriptions]
    /* A perpetual licence has no expiry to report, even where an old row
       still carries a date. Listing one here would put a renewal in front of
       a salesperson that is never going to happen. */
    .filter((s) => !isPerpetual(s) && s.expiryDate)
    .sort((a, b) => daysLeft(a, now) - daysLeft(b, now))
    .map((s) => ({
      customer: s.customerName, product: s.product, vendor: s.vendor,
      expires: fmtDate(s.expiryDate), countdown: expiryLabel(s, now),
      stage: s.renewalStage || "—", value: Number(s.sellPrice) || 0,
    }));
  reports.push({
    id: "expiry", title: "Subscription expiry", description: "Everything with an expiry date, soonest first.",
    columns: [
      { key: "customer", label: "Customer" }, { key: "product", label: "Product" },
      { key: "vendor", label: "Vendor" }, { key: "expires", label: "Expires" },
      { key: "countdown", label: "Countdown" }, { key: "stage", label: "Renewal stage" },
      { key: "value", label: "Value", money: true },
    ],
    rows: expiry, total: { value: sum(expiry, "value") },
  });

  /* ── payments ── */
  /* Proformas AND tax invoices: both ask a customer for money, and a
     payments report that shows only one of them is not a payments report. */
  const payments = [...ws.proformas, ...(ws.invoices ?? [])]
    .filter((p) => p.status !== "Draft")
    .map((p) => {
      const total = grand(p);
      const info = computePaymentInfo(p, total, today);
      return {
        number: p.number, customer: p.billName, owner: nameOf(p.ownerId),
        validUntil: fmtDate(p.validUntil), total,
        collected: info.amountPaid, outstanding: info.outstanding,
        status: info.overdue ? "Overdue" : info.paymentStatus === "paid" ? "Paid" : info.paymentStatus === "partial" ? "Part paid" : "Unpaid",
      };
    })
    .sort((a, b) => b.outstanding - a.outstanding);
  reports.push({
    id: "payments", title: "Payments", description: "What has been invoiced, collected and is still owed.",
    columns: [
      { key: "number", label: "Proforma" }, { key: "customer", label: "Customer" },
      { key: "owner", label: "Owner" }, { key: "validUntil", label: "Due" },
      { key: "total", label: "Invoiced", money: true }, { key: "collected", label: "Collected", money: true },
      { key: "outstanding", label: "Outstanding", money: true }, { key: "status", label: "Status" },
    ],
    rows: payments,
    total: { total: sum(payments, "total"), collected: sum(payments, "collected"), outstanding: sum(payments, "outstanding") },
  });

  /* ── orders and delivery ── */
  const orders = ws.orders.map((o) => {
    const f = orderFulfilment(o, ws.challans);
    return {
      number: o.number, customer: o.billName, owner: nameOf(o.ownerId),
      date: fmtDate(o.date), stage: orderStageOf(o.stage).label,
      dispatched: `${f.dispatched} / ${f.ordered}`, pct: f.pct, value: grand(o),
    };
  });
  reports.push({
    id: "orders", title: "Orders & delivery", description: "Every sales order and how much of it has shipped.",
    columns: [
      { key: "number", label: "Order" }, { key: "customer", label: "Customer" },
      { key: "owner", label: "Owner" }, { key: "date", label: "Date" },
      { key: "stage", label: "Stage" }, { key: "dispatched", label: "Dispatched" },
      { key: "pct", label: "%", number: true }, { key: "value", label: "Value", money: true },
    ],
    rows: orders, total: { value: sum(orders, "value") },
  });

  /* ── activity ── */
  const activity = ws.customers.map((c) => ({
    customer: c.company, owner: nameOf(c.ownerId), stage: stageOf(c.stage).label,
    notes: (c.notes ?? []).length,
    lastTouch: (c.notes ?? []).length ? fmtDate(new Date((c.notes ?? [])[0]?.ts ?? 0).toISOString().slice(0, 10)) : "Never",
    nextFollowUp: c.nextFollowUp ? fmtDate(c.nextFollowUp) : "None set",
  })).sort((a, b) => a.notes - b.notes);
  reports.push({
    id: "activity", title: "Sales activity", description: "Accounts with the least recorded contact first.",
    columns: [
      { key: "customer", label: "Customer" }, { key: "owner", label: "Owner" },
      { key: "stage", label: "Stage" }, { key: "notes", label: "Interactions", number: true },
      { key: "lastTouch", label: "Last recorded" }, { key: "nextFollowUp", label: "Next follow-up" },
    ],
    rows: activity, total: { notes: sum(activity, "notes") },
  });

  return reports;
}
