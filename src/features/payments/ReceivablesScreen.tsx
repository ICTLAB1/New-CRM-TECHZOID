import { useMemo, useState } from "react";
import { Presence } from "../../components/Presence";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Field, Input, Select, StatTile, SummaryBar } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { computeDocument } from "../../domain/tax/compute";
import { sendThanksFor, thanksNote } from "../../data/paymentThanks";
import { computePaymentInfo, PAYMENT_METHODS, type PaymentEntry } from "../../domain/payments/ledger";
import { AGE_BUCKETS, buildReceivables, type AgeBucketId } from "../../domain/payments/receivables";
import { formatTotals, isMixed, moneyList, totalsByCurrency } from "../../domain/currency/format";
import { fmtDate, TODAY } from "../../domain/dates";
import type { SalesDocument } from "../../domain/documents/create";
import type { Tone } from "../../components/primitives";

/**
 * Who owes us money, and for how long.
 *
 * The one question this screen exists to answer is "what should I chase
 * today", so the oldest debt is at the top and the ageing buckets are the
 * first thing on the page. Nothing here is stored: every figure is derived
 * from each invoice's payment ledger on the way in, which is what stops a
 * "paid" flag someone set by hand from disagreeing with the money.
 */

export interface ReceivablesScreenProps {
  invoices: SalesDocument[];
  users: { id: string; name: string }[];
  currentUser: { id: string; name: string; role: string };
  settings: Record<string, unknown>;
  onChange: (invoices: SalesDocument[]) => void;
}

const BUCKET_TONE: Record<AgeBucketId, Tone> = {
  current: "neutral", d30: "accent", d60: "warn", d90: "warn", d90plus: "bad",
};

/** StatTile carries only the three alarm tones — a bucket that is merely
 *  ageing gets none rather than being forced into one that means something
 *  else. */
const TILE_TONE: Partial<Record<AgeBucketId, "good" | "warn" | "bad">> = {
  d60: "warn", d90: "warn", d90plus: "bad",
};

export function ReceivablesScreen({ invoices, users, currentUser, settings, onChange }: ReceivablesScreenProps) {
  const [bucket, setBucket] = useState<AgeBucketId | "all" | "settled">("all");
  const [owner, setOwner] = useState("all");
  const [query, setQuery] = useState("");
  /**
   * The invoice whose payments are open, BY ID rather than by value.
   *
   * The panel stays open while payments are corrected and removed, so
   * it has to be looking at the invoice as it is now. Held as a copy it
   * showed the ledger as it was when the panel opened, which on a panel
   * whose whole job is correcting that ledger is the one thing it must
   * not do.
   */
  const [payingId, setPayingId] = useState<string | null>(null);
  const payingDoc = payingId ? invoices.find((i) => i.id === payingId) ?? null : null;
  const toast = useToast();

  const sellerState = ((settings["company"] as { state?: string })?.state) ?? "Delhi";
  const today = TODAY();

  /* The grand total comes from computeDocument, the same function the
     invoice itself prints from — a receivables screen with its own idea of
     what an invoice is worth is the first place the two could diverge. */
  const report = useMemo(
    () => buildReceivables(invoices, (inv) => computeDocument(inv as never, sellerState).grand, today),
    [invoices, sellerState, today],
  );

  const nameOf = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  /**
   * INVOICES THAT OWE NOTHING, which this screen could not reach at all.
   *
   * buildReceivables answers "who owes us money", so an invoice with no
   * balance left drops out of it — correctly. But a payment entered
   * twice SETTLES an invoice, and the invoice then vanished from the one
   * screen where its payments can be corrected. The mistake that most
   * needs fixing was the one that hid the invoice.
   *
   * Over-payments come first: an invoice showing more received than
   * invoiced is not a tidy record, it is an error waiting to be found.
   */
  const settled = useMemo(() => {
    const out = invoices
      .filter((i) => i.status !== "Cancelled" && i.status !== "Draft")
      .map((invoice) => {
        const grand = computeDocument(invoice as never, sellerState).grand;
        const info = computePaymentInfo(invoice, grand, today);
        return { invoice, grand, ...info, daysOverdue: 0, bucket: "current" as AgeBucketId };
      })
      .filter((row) => row.outstanding <= 0 && (row.invoice.paymentHistory?.length ?? 0) > 0);
    return out.sort((a, b) => (b.amountPaid - b.grand) - (a.amountPaid - a.grand));
  }, [invoices, sellerState, today]);

  const overpaid = settled.filter((r) => r.amountPaid > r.grand + 0.005);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = bucket === "settled" ? settled : report.open;
    return rows.filter((row) => {
      if (bucket !== "all" && bucket !== "settled" && row.bucket !== bucket) return false;
      if (owner !== "all" && row.invoice.ownerId !== owner) return false;
      if (!q) return true;
      return [row.invoice.number, row.invoice.billName].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [report, settled, bucket, owner, query]);

  /* PER CURRENCY, NOT ONE FIGURE. An outstanding balance in dollars and one
     in rupees are two different debts; adding them produced a total that
     was wrong by the whole of the foreign one and looked authoritative
     doing it. No conversion here on purpose — that needs a rate source and
     a decision about which rate, and a made-up rate is worse than two
     honest numbers. */
  const baseCurrency = String(settings?.["defaultCurrency"] ?? "INR");
  const totalsOf = (rows: typeof shown) =>
    totalsByCurrency(rows, (r) => r.outstanding, (r) => r.invoice.currency, baseCurrency);

  const shownTotals = totalsOf(shown);
  const outstandingTotals = totalsOf(report.open);
  const overdueTotals = totalsOf(report.open.filter((r) => r.daysOverdue > 0));
  const bucketTotals = (bucket: string) => totalsOf(report.open.filter((r) => r.bucket === bucket));

  /** Every write to one invoice's ledger goes through here. */
  const putPayments = (invoice: SalesDocument, history: PaymentEntry[]) => {
    onChange(invoices.map((i) =>
      i.id === invoice.id ? { ...i, paymentHistory: history, updatedAt: Date.now() } : i));
  };

  const updatePayment = (invoice: SalesDocument, id: string, entry: PaymentFields) => {
    putPayments(invoice, (invoice.paymentHistory ?? []).map((p) => (p.id === id ? { id, ...entry } : p)));
    toast(`Payment corrected on ${invoice.number}`, "good");
  };

  const removePayment = (invoice: SalesDocument, id: string) => {
    putPayments(invoice, (invoice.paymentHistory ?? []).filter((p) => p.id !== id));
    toast(`Payment removed from ${invoice.number}`, "good");
  };

  const recordPayment = (invoice: SalesDocument, entry: PaymentFields) => {
    const paymentId = Math.random().toString(36).slice(2, 10);
    putPayments(invoice, [...(invoice.paymentHistory ?? []), { id: paymentId, ...entry }]);

    /* THE CUSTOMER IS THANKED, and the save does not wait for it. The
       payment is the thing being recorded; the email is a consequence.
       A slow mail server, a mailbox whose consent has lapsed, a customer
       with no address on file — none of those may hold up entering a
       payment or leave anyone wondering whether it went in. The server
       sends it once per payment however many times this is pressed. */
    void sendThanksFor({
      source: "invoice",
      refId: invoice.id,
      paymentId,
      invoiceAmount: computeDocument(invoice as never, sellerState).grand,
    }).then((outcome) => {
      const note = thanksNote(outcome, invoice.billEmail || invoice.billName);
      if (note) toast(note, outcome.state === "failed" ? "warn" : "good");
    });
  };

  return (
    <main className="page">
      <PageHead
        title="Receivables"
        sub={
          report.totalOutstanding > 0
            ? `${formatTotals(outstandingTotals)} outstanding, of which ${formatTotals(overdueTotals) || "nothing"} is overdue.`
            : "Nothing outstanding. Every issued invoice has been paid."
        }
      />

      <SummaryBar columns={5}>
        {AGE_BUCKETS.map((b) => (
          <StatTile
            key={b.id}
            label={b.label}
            value={formatTotals(bucketTotals(b.id)) || moneyList(0, baseCurrency)}
            tone={report.byBucket[b.id] > 0 ? TILE_TONE[b.id] : undefined}
            meta={report.open.filter((r) => r.bucket === b.id).length + " invoice(s)"}
            onClick={() => setBucket((cur) => (cur === b.id ? "all" : b.id))}
          />
        ))}
      </SummaryBar>

      {/* AN ERROR, NOT A TIDY RECORD. More received than invoiced is
          almost always the same payment entered twice — and because the
          invoice then owes nothing, it leaves this list and takes the
          mistake with it. Said out loud, with the way to it. */}
      {overpaid.length && bucket !== "settled" ? (
        <p className="field-hint" style={{ color: "var(--warn)", margin: "0 0 var(--gap)" }}>
          {overpaid.length === 1
            ? `${overpaid[0]!.invoice.number} shows more received than invoiced.`
            : `${overpaid.length} invoices show more received than invoiced.`}
          {" "}
          <Button size="sm" tone="quiet" onClick={() => setBucket("settled")}>Show settled</Button>
        </p>
      ) : null}

      <Card padded={false} className="stack" >
        <div className="row wrap" style={{ padding: "var(--gap) var(--gap-wide)" }}>
          <Input
            style={{ maxWidth: 260 }}
            placeholder="Search invoice or customer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select style={{ maxWidth: 180 }} value={bucket} onChange={(e) => setBucket(e.target.value as AgeBucketId | "all" | "settled")}>
            <option value="all">Any age</option>
            {AGE_BUCKETS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            {/* The way back to an invoice that owes nothing — which is
                where a payment entered twice puts it. */}
            <option value="settled">Settled ({settled.length})</option>
          </Select>
          <Select style={{ maxWidth: 180 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">Anyone's</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <span className="grow" />
          <span className="field-hint">
            {shown.length} shown · {formatTotals(shownTotals)}
            {isMixed(shownTotals) ? " — kept apart, not added together" : ""}
          </span>
        </div>

        {shown.length === 0 ? (
          <Empty
            title={bucket === "settled" ? "Nothing settled yet" : report.open.length === 0 ? "Nothing outstanding" : "Nothing matches"}
            body={
              bucket === "settled"
                ? "An invoice appears here once its payments cover it in full."
                : report.open.length === 0
                  ? "Every issued invoice has been paid in full."
                  : "No invoice matches those filters."
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 4 }} />
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Due</th>
                  <th>Age</th>
                  <th className="num">Invoiced</th>
                  <th className="num">Paid</th>
                  <th className="num">Outstanding</th>
                  <th>Owner</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const overdue = row.daysOverdue > 0;
                  return (
                    <tr key={row.invoice.id} className={row.daysOverdue > 60 ? "needs-warn" : undefined}>
                      <td className="edge-cell" />
                      <td data-head className="mono strong">{row.invoice.number}</td>
                      <td data-label="Customer" className="strong">{row.invoice.billName || "—"}</td>
                      <td data-label="Due" className={overdue ? "" : "muted"} style={overdue ? { color: "var(--warn)" } : undefined}>
                        {fmtDate(row.invoice.validUntil ?? "")}
                      </td>
                      <td data-label="Age">
                        <Chip tone={BUCKET_TONE[row.bucket]}>
                          {row.daysOverdue > 0 ? `${row.daysOverdue}d overdue` : "Not due"}
                        </Chip>
                      </td>
                      <td data-label="Invoiced" className="num muted">{moneyList(row.grand, row.invoice.currency)}</td>
                      <td data-label="Paid" className="num muted">{row.amountPaid > 0 ? moneyList(row.amountPaid, row.invoice.currency) : "—"}</td>
                      <td data-label="Outstanding" className="num strong">{moneyList(row.outstanding, row.invoice.currency)}</td>
                      <td data-label="Owner" className="muted">{nameOf.get(row.invoice.ownerId ?? "") ?? "—"}</td>
                      <td data-actions>
                        <Button size="sm" tone="primary" onClick={() => setPayingId(row.invoice.id)}>
                          {(row.invoice.paymentHistory?.length ?? 0) > 0 ? "Payments" : "Record payment"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Presence value={payingDoc}>
        {(invoice, open) => (
          <PaymentsPanel
            open={open}
            invoice={invoice}
            total={computeDocument(invoice as never, sellerState).grand}
            today={today}
            onAdd={(entry) => recordPayment(invoice, entry)}
            onUpdate={(id, entry) => updatePayment(invoice, id, entry)}
            onRemove={(id) => removePayment(invoice, id)}
            onClose={() => setPayingId(null)}
          />
        )}
      </Presence>

      {currentUser.role === "Sales" ? (
        <div className="field-hint" style={{ marginTop: 12 }}>
          You are seeing your own invoices. Admins and managers see the whole book.
        </div>
      ) : null}
    </main>
  );
}

/** What the form collects; the id is this screen's to give. */
type PaymentFields = { amount: number; date: string; method: string; reference: string };

/* ── the payments on one invoice ───────────────────────────────────── */

/**
 * Everything recorded against one invoice, and the form that changes it.
 *
 * IT WAS A FORM AND NOTHING ELSE. You could add a payment to an invoice
 * and never see what was already there — so a payment entered twice, or
 * entered for the wrong amount, could not be found, let alone fixed.
 * The Payment Tracker had the same gap on its bills; this is the same
 * list, from the same stylesheet, so the two read alike.
 *
 * NOTHING HERE WRITES A STATUS. An invoice's paid-or-not is derived
 * from this ledger every time it is asked for, never stored, which is
 * what stops a flag somebody set by hand disagreeing with the money.
 * Correcting an entry simply changes what the derivation sees.
 */
function PaymentsPanel({
  invoice, total, today, open = true, onAdd, onUpdate, onRemove, onClose,
}: {
  invoice: SalesDocument;
  total: number;
  today: string;
  open?: boolean;
  onAdd: (entry: PaymentFields) => void;
  onUpdate: (id: string, entry: PaymentFields) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const history = invoice.paymentHistory ?? [];
  const info = computePaymentInfo(invoice, total, today);
  const outstanding = info.outstanding;

  /* null while adding — which is what this panel opens for — or the id
     of the entry being corrected. */
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  /* Prefilled with what is actually left, because settling the balance is
     the common case and typing it again is a chance to fat-finger it. */
  const [amount, setAmount] = useState(String(outstanding));
  const [date, setDate] = useState(TODAY());
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [reference, setReference] = useState("");

  const value = Number(amount) || 0;
  /* Against the balance when adding; against the balance this entry is
     not already part of when correcting one. */
  const room = editing
    ? outstanding + (Number(history.find((p) => p.id === editing)?.amount) || 0)
    : outstanding;
  const over = value > room;

  const startEdit = (p: PaymentEntry) => {
    setEditing(String(p.id));
    setRemoving(null);
    setAmount(String(p.amount ?? 0));
    setDate(String(p.date ?? TODAY()));
    setMethod(String(p.method || PAYMENT_METHODS[0]));
    setReference(String(p.reference ?? ""));
  };

  const startAdd = () => {
    setEditing(null);
    setAmount(String(outstanding));
    setDate(TODAY());
    setMethod(PAYMENT_METHODS[0]);
    setReference("");
  };

  const save = () => {
    const entry = { amount: value, date, method, reference: reference.trim() };
    if (editing) {
      onUpdate(editing, entry);
      startAdd();
      return;
    }
    onAdd(entry);
    onClose();
  };

  const received = info.amountPaid;
  const overpaid = received > total + 0.005;

  return (
    <Modal
      open={open}
      title={`Payments — ${invoice.number}`}
      description={
        outstanding > 0
          ? `${invoice.billName || "This customer"} owes ${moneyList(outstanding, invoice.currency)} on this invoice.`
          : `Settled — ${moneyList(received, invoice.currency)} received against ${moneyList(total, invoice.currency)}.`
      }
      unsavedChanges={value > 0}
      onClose={onClose}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Close</Button>
          <Button tone="primary" disabled={value <= 0} onClick={save}>
            {editing ? "Save correction" : "Record payment"}
          </Button>
        </>
      }
    >
      <div className="stack">
        {history.length ? (
          <>
            <div className="field-label">Recorded against this invoice</div>
            <ul className="pay-list">
              {history.map((p) => (
                <li key={String(p.id)} className={editing === p.id ? "is-editing" : undefined}>
                  <span className="pay-when">
                    {fmtDate(String(p.date ?? ""))} · {String(p.method ?? "")}
                    {p.reference ? ` · ${String(p.reference)}` : ""}
                  </span>
                  <span className="pay-sum">{moneyList(Number(p.amount) || 0, invoice.currency)}</span>
                  {removing === p.id ? (
                    <span className="row-tight" style={{ gap: 6 }}>
                      <span className="field-hint">Remove it?</span>
                      <Button size="sm" tone="danger" onClick={() => { onRemove(String(p.id)); setRemoving(null); }}>
                        Remove
                      </Button>
                      <Button size="sm" tone="quiet" onClick={() => setRemoving(null)}>Keep</Button>
                    </span>
                  ) : (
                    <span className="row-tight" style={{ gap: 6 }}>
                      <Button size="sm" tone="quiet" onClick={() => startEdit(p)}>Edit</Button>
                      <Button size="sm" tone="quiet" onClick={() => setRemoving(String(p.id))}>Remove</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {overpaid ? (
              <p className="field-hint" style={{ color: "var(--warn)" }}>
                {moneyList(received - total, invoice.currency)} more than the invoice — check for a payment
                entered twice.
              </p>
            ) : null}
            <p className="field-hint">
              Correcting a payment does not email the customer again; they were thanked when it was first
              entered.
            </p>
          </>
        ) : null}

        <div className="field-label">
          {editing ? "Correct this payment" : history.length ? "Record another payment" : "Record a payment"}
        </div>
        <div className="grid grid-2">
          <Field
            label="Amount received"
            /* A warning, not a block: an overpayment is a real thing that
               happens, and refusing to record it would leave the ledger
               disagreeing with the bank. */
            hint={over ? `That is more than the ${moneyList(room, invoice.currency)} outstanding.` : undefined}
          >
            <Input numeric value={amount} invalid={over} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date received">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Reference" hint="UTR, cheque number, or however you will find this again on a statement.">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        {editing ? (
          <div className="row-tight">
            <Button size="sm" tone="quiet" onClick={startAdd}>Cancel the correction</Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
