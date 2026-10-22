import { moneyList } from "../../domain/currency/format";
import { fmtDate } from "../../domain/dates";
import { DocumentsPanel } from "./DocumentsPanel";
import type { CustomerProfile } from "../../domain/customers/profile";

/**
 * Everything known about one customer, on one screen.
 *
 * Sections appear only when they hold something — an empty "Opportunities"
 * heading tells you nothing and costs a scroll. The exception is anything
 * that could not be READ, which is said out loud: a section missing because
 * a query failed looks exactly like a section missing because there is
 * nothing in it, and those are opposite facts.
 */
export function Customer360Panel({ profile, unavailable = [] }: {
  profile: CustomerProfile;
  unavailable?: string[];
}) {
  const { contacts, documents, activities, licences, renewals, outstanding, deals, lost, notes } = profile;
  const seats = licences.reduce((n, l) => n + (Number(l.seats) || 0), 0);

  return (
    <div className="stack">
      {unavailable.length > 0 ? (
        <p className="field-msg">
          Could not read: {unavailable.join(", ")}. Those sections are missing rather than empty.
        </p>
      ) : null}

      {/* WHAT IS OWED COMES FIRST. It is the one thing on this record that
          changes what you say when they pick up the phone. */}
      {outstanding.bills.length > 0 ? (
        <div className="stack">
          <div className="pt-section-title">
            Outstanding
            {outstanding.currency
              ? <span className="muted"> · {moneyList(outstanding.total, outstanding.currency)}</span>
              : <span className="muted"> · more than one currency, not added together</span>}
          </div>
          <ul className="plain-list">
            {outstanding.bills.map((b) => (
              <li key={b.id}>
                <strong>{b.invoiceNo}</strong> · {moneyList(b.balance, b.currency)} · due {fmtDate(b.dueOn)}
                {b.daysOverdue > 0 ? <span className="bad"> · {b.daysOverdue}d overdue</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {contacts.length > 0 ? (
        <div className="stack">
          <div className="pt-section-title">People<span className="muted"> · {contacts.length}</span></div>
          <ul className="plain-list">
            {contacts.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {c.role ? <span className="muted"> — {c.role}</span> : null}
                {c.isPrimary ? <span className="chip accent"> primary</span> : null}
                {c.email || c.phone
                  ? <div className="muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</div>
                  : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DocumentsPanel documents={documents} />

      {licences.length > 0 ? (
        <div className="stack">
          <div className="pt-section-title">
            Products held
            <span className="muted"> · {licences.length} line{licences.length === 1 ? "" : "s"}{seats > 0 ? `, ${seats} seats` : ""}</span>
          </div>
          <ul className="plain-list">
            {licences.map((l) => (
              <li key={l.id}>
                <strong>{l.product}</strong>
                {l.vendor ? <span className="muted"> — {l.vendor}</span> : null}
                {l.seats ? <> · {l.seats} seats</> : null}
                {l.expiryDate ? <span className="muted"> · to {fmtDate(l.expiryDate)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {renewals.length > 0 ? (
        <div className="stack">
          <div className="pt-section-title">Renewals<span className="muted"> · soonest first</span></div>
          <ul className="plain-list">
            {renewals.map((r) => (
              <li key={`r:${r.id}`}>
                {fmtDate(r.expiryDate ?? "")} — <strong>{r.product}</strong>
                {r.renewalStage ? <span className="muted"> · {r.renewalStage}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {deals.length > 0 ? (
        <div className="stack">
          <div className="pt-section-title">Opportunities<span className="muted"> · {deals.length}</span></div>
          <ul className="plain-list">
            {deals.map((d) => (
              <li key={d.id}>
                <strong>{d.title || "(untitled)"}</strong> · {d.stage}
                {Number(d.value) > 0 ? <> · {moneyList(d.value, d.currency)}</> : null}
                {d.expectedClose ? <span className="muted"> · expected {fmtDate(d.expectedClose)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {lost ? (
        <div className="stack">
          <div className="pt-section-title">Why this was lost</div>
          <p style={{ margin: 0 }}>
            {lost.reason || "No reason recorded"}
            {lost.competitor ? <> — to <strong>{lost.competitor}</strong></> : null}
          </p>
          {lost.notes ? <p className="muted" style={{ margin: 0 }}>{lost.notes}</p> : null}
        </div>
      ) : null}

      {activities.length > 0 ? (
        <div className="stack">
          <div className="pt-section-title">Calls, emails and meetings<span className="muted"> · {activities.length}</span></div>
          <ul className="plain-list">
            {activities.slice(0, 20).map((a) => (
              <li key={a.id}>
                <span className="muted">{fmtDate(a.at)}</span> · {a.kind}
                {a.summary ? <> — {a.summary}</> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <div className="stack">
          <div className="pt-section-title">Notes<span className="muted"> · {notes.length}</span></div>
          <ul className="plain-list">
            {notes.slice(0, 10).map((n) => (
              <li key={n.id}>
                <span className="muted">{fmtDate(new Date(Number(n.ts ?? 0)).toISOString().slice(0, 10))}</span>
                {" — "}{n.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
