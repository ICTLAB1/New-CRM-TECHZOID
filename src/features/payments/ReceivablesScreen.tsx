import { useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Field, Input, Select, StatTile, SummaryBar } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { computeDocument } from "../../domain/tax/compute";
import { computePaymentInfo, PAYMENT_METHODS } from "../../domain/payments/ledger";
import { AGE_BUCKETS, buildReceivables, type AgeBucketId } from "../../domain/payments/receivables";
import { inrList } from "../../domain/currency/format";
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
  const [bucket, setBucket] = useState<AgeBucketId | "all">("all");
  const [owner, setOwner] = useState("all");
  const [query, setQuery] = useState("");
  const [paying, setPaying] = useState<SalesDocument | null>(null);

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return report.open.filter((row) => {
      if (bucket !== "all" && row.bucket !== bucket) return false;
      if (owner !== "all" && row.invoice.ownerId !== owner) return false;
      if (!q) return true;
      return [row.invoice.number, row.invoice.billName].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [report, bucket, owner, query]);

  const shownTotal = shown.reduce((a, r) => a + r.outstanding, 0);

  const recordPayment = (invoice: SalesDocument, entry: { amount: number; date: string; method: string; reference: string }) => {
    const next = invoices.map((i) =>
      i.id === invoice.id
        ? {
            ...i,
            paymentHistory: [
              ...(i.paymentHistory ?? []),
              { id: Math.random().toString(36).slice(2, 10), ...entry },
            ],
            updatedAt: Date.now(),
          }
        : i,
    );
    onChange(next);
    setPaying(null);
  };

  return (
    <main className="page">
      <PageHead
        title="Receivables"
        sub={
          report.totalOutstanding > 0
            ? `${inrList(report.totalOutstanding)} outstanding, of which ${inrList(report.overdueOutstanding)} is overdue.`
            : "Nothing outstanding. Every issued invoice has been paid."
        }
      />

      <SummaryBar columns={5}>
        {AGE_BUCKETS.map((b) => (
          <StatTile
            key={b.id}
            label={b.label}
            value={inrList(report.byBucket[b.id])}
            tone={report.byBucket[b.id] > 0 ? TILE_TONE[b.id] : undefined}
            meta={report.open.filter((r) => r.bucket === b.id).length + " invoice(s)"}
            onClick={() => setBucket((cur) => (cur === b.id ? "all" : b.id))}
          />
        ))}
      </SummaryBar>

      <Card padded={false} className="stack" >
        <div className="row wrap" style={{ padding: "var(--gap) var(--gap-wide)" }}>
          <Input
            style={{ maxWidth: 260 }}
            placeholder="Search invoice or customer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select style={{ maxWidth: 180 }} value={bucket} onChange={(e) => setBucket(e.target.value as AgeBucketId | "all")}>
            <option value="all">Any age</option>
            {AGE_BUCKETS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </Select>
          <Select style={{ maxWidth: 180 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">Anyone's</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <span className="grow" />
          <span className="field-hint">{shown.length} shown · {inrList(shownTotal)}</span>
        </div>

        {shown.length === 0 ? (
          <Empty
            title={report.open.length === 0 ? "Nothing outstanding" : "Nothing matches"}
            body={
              report.open.length === 0
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
                      <td className="mono strong">{row.invoice.number}</td>
                      <td className="strong">{row.invoice.billName || "—"}</td>
                      <td className={overdue ? "" : "muted"} style={overdue ? { color: "var(--warn)" } : undefined}>
                        {fmtDate(row.invoice.validUntil ?? "")}
                      </td>
                      <td>
                        <Chip tone={BUCKET_TONE[row.bucket]}>
                          {row.daysOverdue > 0 ? `${row.daysOverdue}d overdue` : "Not due"}
                        </Chip>
                      </td>
                      <td className="num muted">{inrList(row.grand)}</td>
                      <td className="num muted">{row.amountPaid > 0 ? inrList(row.amountPaid) : "—"}</td>
                      <td className="num strong">{inrList(row.outstanding)}</td>
                      <td className="muted">{nameOf.get(row.invoice.ownerId ?? "") ?? "—"}</td>
                      <td>
                        <Button size="sm" tone="primary" onClick={() => setPaying(row.invoice as SalesDocument)}>
                          Record payment
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

      {paying ? (
        <RecordPayment
          invoice={paying}
          outstanding={
            computePaymentInfo(paying, computeDocument(paying as never, sellerState).grand, today).outstanding
          }
          onSave={(entry) => recordPayment(paying, entry)}
          onClose={() => setPaying(null)}
        />
      ) : null}

      {currentUser.role === "Sales" ? (
        <div className="field-hint" style={{ marginTop: 12 }}>
          You are seeing your own invoices. Admins and managers see the whole book.
        </div>
      ) : null}
    </main>
  );
}

/* ── recording a payment ───────────────────────────────────────────── */

function RecordPayment({
  invoice, outstanding, onSave, onClose,
}: {
  invoice: SalesDocument;
  outstanding: number;
  onSave: (entry: { amount: number; date: string; method: string; reference: string }) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  /* Prefilled with what is actually left, because settling the balance is
     the common case and typing it again is a chance to fat-finger it. */
  const [amount, setAmount] = useState(String(outstanding));
  const [date, setDate] = useState(TODAY());
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [reference, setReference] = useState("");

  const value = Number(amount) || 0;
  const over = value > outstanding;

  const save = () => {
    onSave({ amount: value, date, method, reference: reference.trim() });
    toast(`Payment of ${inrList(value)} recorded against ${invoice.number}`, "good");
  };

  return (
    <Modal
      open
      title={`Record a payment — ${invoice.number}`}
      description={`${invoice.billName || "This customer"} owes ${inrList(outstanding)} on this invoice.`}
      unsavedChanges={value > 0}
      onClose={onClose}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Cancel</Button>
          <Button tone="primary" disabled={value <= 0} onClick={save}>Record payment</Button>
        </>
      }
    >
      <div className="stack">
        <div className="grid grid-2">
          <Field
            label="Amount received"
            /* A warning, not a block: an overpayment is a real thing that
               happens, and refusing to record it would leave the ledger
               disagreeing with the bank. */
            hint={over ? `That is more than the ${inrList(outstanding)} outstanding.` : undefined}
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
      </div>
    </Modal>
  );
}
