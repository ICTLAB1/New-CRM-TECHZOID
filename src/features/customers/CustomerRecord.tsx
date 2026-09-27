import { useState } from "react";
import { Button, Card, Chip, Empty, Field, Select, Textarea } from "../../components/primitives";
import { stageOf, STAGES } from "../../domain/pipeline/stages";
import { Path } from "../../components/Path";
import { groupEntriesByDay, recordTimeline, type RecordDocument, type RecordEntry } from "../../domain/customers/record";
import { blankNote, NOTE_OUTCOMES, NOTE_TYPES, noteIsEmpty, type NoteDraft } from "../../domain/customers/notes";
import { likelihood, weightedValue, type Deal } from "../../domain/deals/deal";
import { fmtDate } from "../../domain/dates";
import { moneyList } from "../../domain/currency/format";
import type { Customer } from "../../domain/customers/customer";

/**
 * Everything about one customer, on one page.
 *
 * WHAT THIS REPLACES. A customer lived in a modal form — a stack of
 * fields, and nothing else. To find out what had actually happened with
 * them you opened the form, closed it, went to Quotations, filtered,
 * went to Invoices, filtered again, and held the order of events in your
 * head. The record is the answer to "where are we with these people",
 * and that question was not answerable on any one screen.
 *
 * THE THREE COLUMNS EACH ANSWER A DIFFERENT QUESTION, which is why they
 * are three and not one long page:
 *
 *   left    who they are        — facts that rarely change
 *   middle  what has happened   — the story, newest first
 *   right   what is open        — deals and documents, the things with money on them
 *
 * The middle is the widest because it is the one you read. The left is
 * reference you glance at; the right is a list you scan. A layout that
 * gave all three equal weight would be three panels of equal importance,
 * and they are not equally important.
 */

export interface CustomerRecordProps {
  customer: Customer;
  /** Open and concluded deals for this customer. */
  deals?: Deal[];
  documents?: RecordDocument[];
  /** Who owns the record, resolved to a name. */
  ownerName?: string;
  currentUser: { id: string; name: string };
  onAddNote?: (draft: NoteDraft) => void;
  onEdit?: () => void;
  onNewDeal?: () => void;
  onOpenDocument?: (id: string) => void;
  onBack?: () => void;
}

/** A labelled fact in the left rail. Renders nothing at all when there is
 *  no value — an empty row reads as a missing answer rather than as an
 *  unasked question. */
function Fact({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  const text = (value ?? "").trim();
  if (!text) return null;
  return (
    <div className="fact">
      <div className="fact-label">{label}</div>
      <div className="fact-value">{href ? <a href={href}>{text}</a> : text}</div>
    </div>
  );
}

function DealRow({ deal }: { deal: Deal }) {
  const stage = stageOf(deal.stage);
  return (
    /* The NAME gets the full width. Set beside a money column it wrapped
       to three lines in a 300px rail, and the one thing you are scanning
       for — which deal this is — was the hardest thing to read. */
    <div className="deal-row">
      <div className="deal-name">{deal.name || "Untitled deal"}</div>
      <div className="deal-line">
        <Chip tone={stage.tone} solid>{stage.label}</Chip>
        <span className="deal-value">{moneyList(deal.value, deal.currency)}</span>
      </div>
      <div className="deal-meta">
        {fmtDate(deal.expectedClose)} · {likelihood(deal)}% likely
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: RecordEntry }) {
  return (
    <li className={"entry entry-" + entry.kind}>
      <span className={"entry-pip is-" + (entry.tone ?? "neutral")} aria-hidden="true" />
      <div className="entry-body">
        <div className="entry-head">
          <span className="entry-label">{entry.label}</span>
          {entry.amount ? <span className="entry-amount">{entry.amount}</span> : null}
        </div>
        {entry.body ? <div className="entry-text">{entry.body}</div> : null}
        {entry.by ? <div className="entry-by">{entry.by}</div> : null}
      </div>
    </li>
  );
}

/** The ladder plus the conclusion this record actually reached. Showing
 *  both Won and Lost on every path would put a step on it that can never
 *  be taken, and draw the eye to the one nobody wants. */
const PATH_STEPS = (stage: string | undefined) => {
  const ladder = STAGES.filter((s) => s.id !== "won" && s.id !== "lost");
  const end = STAGES.find((s) => s.id === (stage === "lost" ? "lost" : "won"));
  return [...ladder, ...(end ? [end] : [])].map((s) => ({ id: s.id, label: s.label }));
};

export function CustomerRecord({
  customer, deals = [], documents = [], ownerName, onAddNote,
  onEdit, onNewDeal, onOpenDocument, onBack,
}: CustomerRecordProps) {
  const [draft, setDraft] = useState<NoteDraft>(blankNote());
  const days = groupEntriesByDay(recordTimeline(customer, documents));
  const open = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");

  const set = <K extends keyof NoteDraft>(k: K) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const log = () => {
    if (noteIsEmpty(draft)) return;
    onAddNote?.(draft);
    /* The type is kept: somebody logging calls logs several in a row. */
    setDraft({ ...blankNote(), type: draft.type });
  };

  const address = [customer.address, customer.city, customer.state, customer.pincode]
    .map((s) => (s ?? "").trim()).filter(Boolean).join(", ");

  return (
    <main className="page record">
      <header className="record-head">
        <div className="record-id">
          {onBack ? <Button tone="quiet" size="sm" onClick={onBack}>← Customers</Button> : null}
          <h1 className="record-name">{customer.company || "Unnamed customer"}</h1>
          <div className="record-sub">
            {customer.code ? <span className="record-code">{customer.code}</span> : null}
            {ownerName ? <span className="record-owner">Owned by {ownerName}</span> : null}
          </div>
        </div>
        <div className="row-tight wrap">
          {onNewDeal ? <Button tone="primary" onClick={onNewDeal}>New deal</Button> : null}
          {onEdit ? <Button tone="default" onClick={onEdit}>Edit details</Button> : null}
        </div>
      </header>

      {/* The path, not a chip. A chip says where they are; this says what
          came before, what is next, and how far along — which is what
          somebody opening a record actually wants to know. Read-only
          here: a stage belongs to a DEAL, and this is the account's
          roll-up of them. */}
      <div className="record-path">
        <Path
          steps={PATH_STEPS(customer.stage)}
          current={customer.stage ?? "lead"}
          tone={customer.stage === "won" ? "good" : customer.stage === "lost" ? "bad" : "accent"}
        />
      </div>

      <div className="record-grid">
        {/* ── who they are ─────────────────────────────────────────── */}
        <aside className="record-rail">
          <Card title="About">
            <Fact label="Contact" value={[customer.contact, customer.designation].filter(Boolean).join(" · ")} />
            <Fact label="Email" value={customer.email} href={customer.email ? "mailto:" + customer.email : undefined} />
            <Fact label="Phone" value={customer.phone} href={customer.phone ? "tel:" + customer.phone : undefined} />
            <Fact label="Website" value={customer.website} />
            <Fact label="GSTIN" value={customer.gstin} />
            <Fact label="PAN" value={customer.pan} />
            <Fact label="Address" value={address} />
            <Fact label="Country" value={customer.country} />
            <Fact label="Segment" value={customer.segment} />
            <Fact label="Source" value={customer.source} />
            <Fact label="Customer since" value={customer.createdAt ? fmtDate(new Date(customer.createdAt).toISOString().slice(0, 10)) : ""} />
          </Card>
        </aside>

        {/* ── what has happened ────────────────────────────────────── */}
        <section className="record-stream">
          <Card title="Log an activity">
            <div className="grid grid-2">
              <Field label="What happened">
                <Select value={draft.type} onChange={set("type")}>
                  {NOTE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Outcome" hint="Optional. Colours the entry in the history.">
                <Select value={draft.outcome} onChange={set("outcome")}>
                  <option value="">—</option>
                  {NOTE_OUTCOMES.map((o) => <option key={o}>{o}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Notes">
              <Textarea rows={2} value={draft.text} onChange={set("text")} placeholder="What was said, and what you agreed." />
            </Field>
            <div className="row-tight" style={{ justifyContent: "flex-end" }}>
              <Button tone="primary" size="sm" disabled={noteIsEmpty(draft)} onClick={log}>Log it</Button>
            </div>
          </Card>

          <Card title="History" padded={false}>
            {days.length === 0 ? (
              <div className="card-pad">
                <Empty
                  title="Nothing logged yet"
                  body="Calls, meetings and every document raised for this customer appear here, newest first."
                />
              </div>
            ) : (
              <div className="card-pad">
                {days.map((day) => (
                  <section className="entry-day" key={day.date}>
                    <div className="entry-date">{fmtDate(day.date)}</div>
                    <ul className="entry-list">
                      {day.entries.map((e) => <Entry entry={e} key={e.id} />)}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </Card>
        </section>

        {/* ── what is open ─────────────────────────────────────────── */}
        <aside className="record-side">
          <Card
            title={"Deals" + (open.length ? " · " + open.length + " open" : "")}
            actions={onNewDeal ? <Button size="sm" tone="quiet" onClick={onNewDeal}>+ New</Button> : null}
          >
            {deals.length === 0 ? (
              <Empty title="No deals yet" body="A deal is one thing you are selling them. A customer can have several at once." />
            ) : (
              <>
                {deals.map((d) => <DealRow deal={d} key={d.id} />)}
                {open.length ? (
                  <div className="deal-total">
                    Weighted pipeline
                    <strong>
                      {moneyList(open.reduce((n, d) => n + weightedValue(d), 0), open[0]?.currency ?? "INR")}
                    </strong>
                  </div>
                ) : null}
              </>
            )}
          </Card>

          <Card title="Documents">
            {documents.length === 0 ? (
              <Empty title="Nothing raised yet" body="Quotations, proformas and invoices for this customer collect here." />
            ) : (
              documents.slice(0, 8).map((d) => (
                <button className="doc-row" key={d.id} onClick={() => onOpenDocument?.(d.id)}>
                  <span className="doc-row-main">
                    <span className="doc-number">{d.number}</span>
                    <span className="doc-meta">{d.kind} · {fmtDate(d.date)}</span>
                  </span>
                  <span className="doc-row-side">
                    {d.amount ? <span className="doc-amount">{d.amount}</span> : null}
                    {d.status ? <span className="doc-status">{d.status}</span> : null}
                  </span>
                </button>
              ))
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}
