import { computeDocument } from "../tax/compute";
import { moneyShort } from "../currency/format";
import { seesEverything } from "../analytics/scope";
import type { Workspace } from "../analytics/dashboard";
import type { Challan } from "../orders/fulfilment";

/** What a challan carries in practice, beyond the two linking fields the
 *  workspace type guarantees. */
type ChallanLike = Challan & { number?: string; status?: string; createdAt?: number };

/**
 * One stream of everything that happened.
 *
 * Notes a person typed and records the app created are merged into a single
 * time-ordered list, because "what happened with this customer" is one
 * question and answering it from four screens is how a follow-up gets missed.
 *
 * A note carries its own author. A generated event carries the owner of the
 * record it came from, which is also what scopes it: a Sales user sees their
 * own stream and no one else's.
 */

export type ActivityKind =
  | "Note" | "Call" | "Email" | "Meeting" | "WhatsApp" | "Site Visit" | "Demo"
  | "quotation" | "proforma" | "invoice" | "order" | "challan" | "subscription";

/** The kinds a person can log by hand. The rest are generated. */
export const LOGGED_KINDS: readonly ActivityKind[] = [
  "Note", "Call", "Email", "Meeting", "WhatsApp", "Site Visit", "Demo",
];

export interface ActivityEvent {
  id: string;
  ts: number;
  kind: ActivityKind;
  title: string;
  detail?: string;
  /** Only on a logged note: what came of it, and what happens next. */
  outcome?: string;
  nextAction?: string;
  who?: string;
  ownerId?: string;
  customerId?: string;
  customerName?: string;
  status?: string;
  /** true when a person typed it, false when the app recorded it. */
  logged: boolean;
}

const isLogged = (kind: string): kind is ActivityKind =>
  (LOGGED_KINDS as readonly string[]).includes(kind);

/** Everything, newest first. */
export function buildTimeline(ws: Workspace, sellerState: string): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const nameOf = new Map(ws.customers.map((c) => [c.id, c.company]));

  for (const customer of ws.customers) {
    for (const note of customer.notes ?? []) {
      const kind = isLogged(String(note.type)) ? (note.type as ActivityKind) : "Note";
      events.push({
        id: `note-${note.id}`,
        ts: note.ts ?? 0,
        kind,
        title: `${kind} — ${customer.company}`,
        detail: note.text,
        outcome: note.outcome,
        nextAction: note.nextAction,
        who: note.user,
        ownerId: note.userId ?? customer.ownerId,
        customerId: customer.id,
        customerName: customer.company,
        logged: true,
      });
    }
  }

  const docEvents = (docs: typeof ws.quotations, kind: "quotation" | "proforma" | "invoice", label: string) => {
    for (const doc of docs) {
      events.push({
        id: `${kind}-${doc.id}`,
        ts: doc.createdAt ?? 0,
        kind,
        title: `${label} ${doc.number} raised`,
        detail: [doc.billName, doc.subject].filter(Boolean).join(" · "),
        status: doc.status,
        ownerId: doc.ownerId,
        customerId: doc.customerId,
        customerName: doc.billName || nameOf.get(doc.customerId),
        logged: false,
      });
    }
  };
  docEvents(ws.quotations, "quotation", "Quotation");
  docEvents(ws.proformas, "proforma", "Proforma");
  /* Invoices were added to the CRM after this file and never added here, so
     raising a tax invoice — the moment the money is actually asked for —
     left no trace on the one screen that claims to show everything that
     happened. */
  docEvents(ws.invoices ?? [], "invoice", "Tax invoice");

  for (const order of ws.orders) {
    events.push({
      id: `order-${order.id}`,
      ts: order.createdAt ?? 0,
      kind: "order",
      title: `Order ${order.number} confirmed`,
      detail: [order.billName, moneyShort(computeDocument(order, sellerState).grand, order.currency)].filter(Boolean).join(" · "),
      status: order.stage,
      ownerId: order.ownerId,
      customerId: order.customerId,
      customerName: order.billName || nameOf.get(order.customerId),
      logged: false,
    });
  }

  /* A challan has no owner of its own — it follows its order, which is also
     where its customer comes from. The workspace type only guarantees the
     linking fields, so the rest are read defensively. */
  const orderById = new Map(ws.orders.map((o) => [o.id, o]));
  for (const challan of ws.challans as ChallanLike[]) {
    const order = orderById.get(challan.orderId);
    events.push({
      id: `challan-${challan.id}`,
      ts: challan.createdAt ?? 0,
      kind: "challan",
      title: challan.number ? `Challan ${challan.number} dispatched` : "Dispatch recorded",
      detail: order ? `Against order ${order.number}` : undefined,
      status: challan.status,
      ownerId: order?.ownerId,
      customerId: order?.customerId,
      customerName: order?.billName,
      logged: false,
    });
  }

  for (const sub of ws.subscriptions) {
    events.push({
      id: `subscription-${sub.id}`,
      ts: sub.createdAt ?? 0,
      kind: "subscription",
      title: `${sub.product ?? "Subscription"} started`,
      detail: [sub.vendor, sub.seats ? `${sub.seats} seats` : ""].filter(Boolean).join(" · "),
      status: sub.status,
      ownerId: sub.ownerId,
      customerId: sub.customerId,
      customerName: sub.customerName || (sub.customerId ? nameOf.get(sub.customerId) : undefined),
      logged: false,
    });
  }

  /* Anything with no timestamp sorts last rather than jumping to 1970. */
  return events.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export interface TimelineFilter {
  search?: string;
  kind?: string;
  customerId?: string;
  ownerId?: string;
  /** Days back. 0 or undefined means everything. */
  withinDays?: number;
}

export function filterTimeline(
  events: readonly ActivityEvent[],
  filter: TimelineFilter,
  user: { id: string; role: string },
  now: Date = new Date(),
): ActivityEvent[] {
  const cutoff = filter.withinDays ? now.getTime() - filter.withinDays * 86_400_000 : null;
  const q = (filter.search ?? "").trim().toLowerCase();

  return events.filter((ev) => {
    /* The same rule as everywhere else: a Sales user's own work only. An
       event with no owner — a challan follows its order — is shown, because
       hiding it would leave a gap nobody could explain. */
    if (!seesEverything(user.role) && ev.ownerId && ev.ownerId !== user.id) return false;
    if (filter.ownerId && filter.ownerId !== "all" && ev.ownerId !== filter.ownerId) return false;
    if (filter.kind && filter.kind !== "all" && ev.kind !== filter.kind) return false;
    if (filter.customerId && filter.customerId !== "all" && ev.customerId !== filter.customerId) return false;
    if (cutoff !== null && ev.ts < cutoff) return false;
    if (q) {
      const haystack = [ev.title, ev.detail, ev.customerName, ev.who].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export interface TimelineDay {
  label: string;
  /** ISO date, for a stable React key. */
  key: string;
  events: ActivityEvent[];
}

/** Grouped by the day it happened, newest day first. */
export function groupByDay(events: readonly ActivityEvent[]): TimelineDay[] {
  const days: TimelineDay[] = [];
  for (const ev of events) {
    const date = new Date(ev.ts);
    /* A missing timestamp is 0, which is a perfectly valid date in 1970 and
       exactly the wrong thing to show. Undated is the honest label. */
    const key = !ev.ts || isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
    const last = days[days.length - 1];
    if (last?.key === key) {
      last.events.push(ev);
      continue;
    }
    days.push({
      key,
      label: key === "unknown"
        ? "Undated"
        : date.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }),
      events: [ev],
    });
  }
  return days;
}
