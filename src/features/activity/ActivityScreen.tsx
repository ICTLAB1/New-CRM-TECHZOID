import { useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Card, Chip, Empty, Input, Select } from "../../components/primitives";
import {
  buildTimeline, filterTimeline, groupByDay, LOGGED_KINDS,
  type ActivityEvent,
} from "../../domain/activity/timeline";
import { seesEverything } from "../../domain/analytics/scope";
import type { Workspace } from "../../domain/analytics/dashboard";

/**
 * Everything that happened, newest first.
 *
 * One stream rather than four screens: a call logged against a customer, the
 * quotation it produced, the order that followed and the dispatch that closed
 * it all belong to the same story, and reading it in one column is the point.
 */

export interface ActivityScreenProps {
  workspace: Workspace;
  users: { id: string; name: string; role: string }[];
  currentUser: { id: string; name: string; role: string };
  settings: Record<string, unknown>;
}

const KIND_LABEL: Record<string, string> = {
  quotation: "Quotation", proforma: "Proforma", order: "Sales order",
  challan: "Dispatch", subscription: "Subscription",
};

const KIND_TONE: Record<string, "neutral" | "accent" | "good" | "warn"> = {
  Call: "accent", Email: "accent", Meeting: "accent", WhatsApp: "accent",
  "Site Visit": "accent", Demo: "accent", Note: "neutral",
  quotation: "warn", proforma: "warn", order: "good", challan: "good",
  subscription: "warn",
};

const RANGES = [
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "0", label: "Everything" },
];

export function ActivityScreen({ workspace, users, currentUser, settings }: ActivityScreenProps) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [customerId, setCustomerId] = useState("all");
  const [ownerId, setOwnerId] = useState("all");
  const [range, setRange] = useState("30");

  const sellerState = ((settings["company"] as { state?: string } | undefined)?.state) ?? "Delhi";
  const events = useMemo(() => buildTimeline(workspace, sellerState), [workspace, sellerState]);

  const shown = useMemo(
    () => filterTimeline(events, { search, kind, customerId, ownerId, withinDays: Number(range) }, currentUser),
    [events, search, kind, customerId, ownerId, range, currentUser],
  );
  const days = useMemo(() => groupByDay(shown), [shown]);

  /* Only customers that actually appear in the stream — a picker listing
     every customer, most of which filter to nothing, is a picker nobody
     uses twice. */
  const customers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const ev of events) {
      if (ev.customerId && ev.customerName) seen.set(ev.customerId, ev.customerName);
    }
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);

  return (
    <main className="page">
      <PageHead
        title="Activity"
        sub={seesEverything(currentUser.role)
          ? "Every call, email, quotation, order and dispatch, in the order it happened."
          : "Your calls, emails, quotations, orders and dispatches, in the order they happened."}
      />

      <Card padded={false}>
        <div className="card-pad">
          {/* The search takes the room; the pickers stay narrow and wrap
              together. Without a basis every select claims a full row. */}
          <div className="filter-row">
            <Input
              placeholder="Search what was said, who said it, which customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: "3 1 240px" }}
            />
            <Select value={range} aria-label="How far back" onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
            <Select value={kind} aria-label="Kind of activity" onChange={(e) => setKind(e.target.value)}>
              <option value="all">Everything</option>
              <optgroup label="Logged by someone">
                {LOGGED_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </optgroup>
              <optgroup label="Recorded by the CRM">
                {Object.entries(KIND_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </optgroup>
            </Select>
            <Select value={customerId} aria-label="Customer" onChange={(e) => setCustomerId(e.target.value)}>
              <option value="all">Every customer</option>
              {customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
            {seesEverything(currentUser.role) && users.length > 1 ? (
              <Select value={ownerId} aria-label="Person" onChange={(e) => setOwnerId(e.target.value)}>
                <option value="all">Everyone</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            ) : null}
          </div>
        </div>

        <div className="card-pad" style={{ paddingTop: 0 }}>
          {days.length === 0 ? (
            <Empty
              title="Nothing in this window"
              body="Try a longer range, or clear the filters."
            />
          ) : (
            <div className="timeline">
              {days.map((day) => (
                <section key={day.key}>
                  <h2 className="timeline-day">{day.label}</h2>
                  {day.events.map((ev) => <Entry key={ev.id} event={ev} />)}
                </section>
              ))}
            </div>
          )}
        </div>
      </Card>
    </main>
  );
}

function Entry({ event }: { event: ActivityEvent }) {
  const time = event.ts
    ? new Date(event.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <article className="timeline-row">
      <div className="timeline-time mono">{time}</div>
      <div className="timeline-mark" aria-hidden="true" />
      <div className="timeline-body">
        <div className="row-tight wrap">
          <Chip tone={KIND_TONE[event.kind] ?? "neutral"}>{KIND_LABEL[event.kind] ?? event.kind}</Chip>
          <strong>{event.title}</strong>
          {event.status ? <span className="muted">{event.status}</span> : null}
        </div>
        {event.detail ? <div className="timeline-detail">{event.detail}</div> : null}
        {event.outcome || event.nextAction ? (
          <div className="timeline-detail">
            {event.outcome ? <span><strong>Outcome:</strong> {event.outcome}. </span> : null}
            {event.nextAction ? <span><strong>Next:</strong> {event.nextAction}</span> : null}
          </div>
        ) : null}
        {event.who ? <div className="field-hint">Logged by {event.who}</div> : null}
      </div>
    </article>
  );
}
