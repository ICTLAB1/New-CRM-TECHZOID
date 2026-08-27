import type { Customer } from "../customers/customer";
import type { SalesDocument } from "../documents/create";
import { stageOf } from "../pipeline/stages";

/**
 * What changed in the workspace while somebody was looking at it.
 *
 * DERIVED FROM A DIFF, NOT FROM THE REALTIME PAYLOAD, and that is a
 * deliberate choice with two payoffs.
 *
 * Postgres only sends the OLD row on a change when the table is set to
 * REPLICA IDENTITY FULL; by default it sends the primary key. So a realtime
 * event can say "this quotation changed" but not "its status went from Draft
 * to Sent" — and "changed" is not worth telling anyone about. Diffing what
 * the app already held against what it just refetched gives the before and
 * the after without touching the database's replication settings.
 *
 * It also solves echoing for free. When the person at this screen makes the
 * change, their own optimistic update has already put it into the data, so
 * the refetch diffs to nothing and nobody is told about their own click.
 *
 * WHAT IT CANNOT LEAK. The two sides of the diff are both the workspace as
 * this user is allowed to see it — RLS filtered the rows on the way out of
 * the database. A customer another salesperson owns is absent from both
 * sides, so no event can be generated about one.
 */

export type EventKind =
  | "customer.created"
  | "customer.assigned"
  | "customer.stage"
  | "quotation.created"
  | "quotation.status";

export interface CrmEvent {
  /** Stable for the same change, so a re-render cannot duplicate a row. */
  id: string;
  kind: EventKind;
  text: string;
  at: number;
  /** Whether this one is worth interrupting for with a toast, as opposed to
   *  only appearing in the bell. */
  loud: boolean;
}

/** Only these tables produce events; everything else changes too often or
 *  means nothing to a person. */
export interface EventSources {
  customers: readonly Customer[];
  quotations: readonly SalesDocument[];
}

const label = (c: Pick<Customer, "company" | "contact">): string =>
  (c.company ?? "").trim() || (c.contact ?? "").trim() || "a customer";

/**
 * @param me the signed-in user's id, so "assigned to you" can be said only
 * when it is true.
 */
export function detectEvents(
  prev: EventSources,
  next: EventSources,
  me: string,
  now: number = Date.now(),
): CrmEvent[] {
  /* An empty previous side is a first load, not a hundred things happening
     at once. Announcing the whole workspace as news is how a notification
     centre becomes something people close without reading. */
  if (!prev.customers.length && !prev.quotations.length) return [];

  const events: CrmEvent[] = [];
  const beforeCustomers = new Map(prev.customers.map((c) => [c.id, c]));
  const beforeQuotes = new Map(prev.quotations.map((q) => [q.id, q]));

  for (const c of next.customers) {
    const before = beforeCustomers.get(c.id);

    if (!before) {
      events.push({
        id: `customer.created:${c.id}`,
        kind: "customer.created",
        text: c.ownerId === me
          ? `${label(c)} was added to your customers`
          : `New customer — ${label(c)}`,
        at: now,
        loud: c.ownerId === me,
      });
      continue;
    }

    /* Reassignment, said from the reader's side: being given a customer is
       news, somebody else's reshuffle is not. */
    if (before.ownerId !== c.ownerId && c.ownerId === me) {
      events.push({
        id: `customer.assigned:${c.id}:${c.ownerId}`,
        kind: "customer.assigned",
        text: `${label(c)} was assigned to you`,
        at: now,
        loud: true,
      });
    }

    const from = before.stage ?? "lead";
    const to = c.stage ?? "lead";
    if (from !== to) {
      events.push({
        id: `customer.stage:${c.id}:${to}`,
        kind: "customer.stage",
        text: `${label(c)} moved to ${stageOf(to).label}`,
        at: now,
        /* Won and Lost are the two a room wants to hear about. */
        loud: to === "won" || to === "lost",
      });
    }
  }

  for (const q of next.quotations) {
    const before = beforeQuotes.get(q.id);
    const who = (q.billName ?? "").trim() || "a customer";

    if (!before) {
      events.push({
        id: `quotation.created:${q.id}`,
        kind: "quotation.created",
        text: `New quotation ${q.number} for ${who}`,
        at: now,
        loud: false,
      });
      continue;
    }

    if ((before.status ?? "") !== (q.status ?? "")) {
      events.push({
        id: `quotation.status:${q.id}:${q.status}`,
        kind: "quotation.status",
        text: `Quotation ${q.number} for ${who} is now ${q.status}`,
        at: now,
        loud: q.status === "Accepted" || q.status === "Rejected",
      });
    }
  }

  return events;
}

/**
 * A burst is one line, not twenty.
 *
 * An import, a reassignment cascade, or somebody pasting a spreadsheet can
 * change fifty rows in one go. Fifty toasts is a wall; fifty bell entries is
 * a list nobody scrolls. Past a handful they collapse into a count.
 */
export function summarize(events: readonly CrmEvent[]): CrmEvent[] {
  if (events.length <= 4) return [...events];
  const first = events[0]!;
  return [{
    id: `bulk:${first.id}:${events.length}`,
    kind: first.kind,
    text: `${events.length} records changed just now`,
    at: first.at,
    loud: false,
  }];
}
