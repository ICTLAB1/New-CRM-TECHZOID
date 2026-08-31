import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Card, Chip, Empty, Field, Input, Textarea } from "../../components/primitives";
import { computeDocument } from "../../domain/tax/compute";
import { money } from "../../domain/currency/format";
import { readPortalToken } from "../../domain/portal/token";
import type { LineItem } from "../../domain/tax/types";

/**
 * What the customer sees.
 *
 * Reached at `?portal=<token>`, outside the CRM shell entirely — no sign-in,
 * no navigation, nothing of the application around it. The person reading
 * this has never seen the CRM, is probably on a phone, and came here from a
 * link in an email to answer one question: is this the price, and do I say
 * yes.
 *
 * THE DATA HERE IS ALREADY REDACTED. Everything on this page came out of
 * /.netlify/functions/portal, which builds its response from an allowlist
 * (netlify/lib/portalView.mjs). This component cannot show what it was not
 * sent, and it must not start fetching anything else — the redaction lives on
 * the server precisely so that a mistake in a component cannot leak.
 */

export interface PortalDocument {
  id: string;
  kind: "quotation" | "proforma" | "invoice";
  number: string;
  status: string;
  date: string;
  validUntil: string;
  subject: string;
  currency: string;
  taxType: string;
  referenceNo: string;
  paymentTerms: string;
  deliveryTerms: string;
  preparedBy: string;
  intro: string;
  footer: string;
  terms: string[];
  items: LineItem[];
  roundOff: boolean;
  advancePercent: number;
  payments: { date: string; amount: number; mode: string; reference: string }[];
}

export interface PortalData {
  valid: boolean;
  customer?: { code: string; company: string; contact: string; email: string; phone: string; gstin: string; state: string };
  company?: { name: string; tagline: string; website: string; logo: string | null; accentColor: string };
  documents?: PortalDocument[];
}

const KIND_LABEL: Record<string, string> = {
  quotation: "Quotation",
  proforma: "Proforma invoice",
  invoice: "Invoice",
};

/* How each status reads to somebody outside the company. "Sent" is our word
   for it, not theirs — from their side it is waiting for them. */
const STATUS_LABEL: Record<string, string> = {
  sent: "Awaiting your response",
  accepted: "Accepted",
  rejected: "Declined",
  expired: "Expired",
  paid: "Paid",
  issued: "Issued",
  cancelled: "Cancelled",
};

export const statusTone = (status: string): "good" | "warn" | "bad" | "neutral" => {
  const s = String(status ?? "").toLowerCase();
  if (s === "accepted" || s === "paid") return "good";
  if (s === "sent") return "warn";
  if (s === "rejected" || s === "cancelled" || s === "expired") return "bad";
  return "neutral";
};

const readableDate = (value: string): string => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

/** Totals from the same module the PDF uses, so the figure on this page and
 *  the figure on the document they were emailed cannot disagree.
 *
 *  The seller's state is deliberately not sent to the portal. It decides
 *  CGST+SGST versus IGST, which changes how the tax is LABELLED and never what
 *  it comes to — and it is a fact about us, not about them. */
export function portalTotals(doc: PortalDocument, customerState: string) {
  return computeDocument(
    {
      items: doc.items,
      taxType: doc.taxType,
      billState: customerState,
      shipState: customerState,
      roundOff: doc.roundOff,
    } as never,
    customerState,
  );
}

export function CustomerPortal({ token = readPortalToken(window.location) }: { token?: string } = {}) {
  const [state, setState] = useState<"loading" | "invalid" | "ready" | "failed">("loading");
  const [data, setData] = useState<PortalData | null>(null);
  const [openId, setOpenId] = useState("");

  const load = useCallback(async () => {
    /* A token that is not even the right shape is answered here rather than
       sent to the server. Nothing is gained by asking, and a truncated link
       gets the same honest answer a revoked one does. */
    if (!token) { setState("invalid"); return; }
    try {
      const res = await fetch("/.netlify/functions/portal?t=" + encodeURIComponent(token));
      const body = (await res.json()) as PortalData;
      if (!body.valid) { setState("invalid"); return; }
      setData(body);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (state === "loading") {
    return (
      <Frame>
        <Card title="One moment">
          <p className="muted" style={{ margin: 0 }}>Fetching your documents…</p>
        </Card>
      </Frame>
    );
  }

  if (state === "failed") {
    return (
      <Frame>
        <Card title="We couldn't load this just now">
          <div className="stack">
            <p style={{ margin: 0 }}>Something went wrong at our end, not yours.</p>
            <div>
              <Button tone="primary" onClick={() => { setState("loading"); void load(); }}>Try again</Button>
            </div>
          </div>
        </Card>
      </Frame>
    );
  }

  /* ONE MESSAGE for every reason a link does not work — expired, withdrawn,
     mistyped, never existed. Not to be coy: what to do about it is genuinely
     the same in all four cases, and a page that distinguishes them lets
     somebody working through guesses learn which ones were real. */
  if (state === "invalid") {
    return (
      <Frame>
        <Card title="This link isn't active">
          <div className="stack">
            <p style={{ margin: 0 }}>
              Links expire after a while, and can be withdrawn. This one is no longer working.
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Reply to the email it came in and ask for a fresh one — it takes a moment to send.
            </p>
          </div>
        </Card>
      </Frame>
    );
  }

  const open = data?.documents?.find((d) => d.id === openId) ?? null;

  return (
    <Frame company={data?.company}>
      {open ? (
        <DocumentView
          doc={open}
          customerState={data?.customer?.state ?? ""}
          token={token}
          onBack={() => setOpenId("")}
          onAnswered={() => { setOpenId(""); void load(); }}
        />
      ) : (
        <DocumentList data={data} onOpen={setOpenId} />
      )}
    </Frame>
  );
}

/* ── the list ───────────────────────────────────────────────────────── */

function DocumentList({ data, onOpen }: { data: PortalData | null; onOpen: (id: string) => void }) {
  const documents = data?.documents ?? [];
  const customerState = data?.customer?.state ?? "";
  const waiting = documents.filter((d) => d.kind === "quotation" && d.status.toLowerCase() === "sent");

  return (
    <div className="stack">
      <Card title={data?.customer?.company || "Your documents"}>
        <p className="muted" style={{ marginTop: 0 }}>
          Everything we've sent you, in one place.
          {data?.customer?.code ? ` Your account number is ${data.customer.code}.` : ""}
        </p>
        {waiting.length > 0 ? (
          <p style={{ margin: "10px 0 0" }}>
            {waiting.length === 1
              ? "One quotation is waiting for your response."
              : `${waiting.length} quotations are waiting for your response.`}
          </p>
        ) : null}
      </Card>

      <Card title="Documents" padded={false}>
        {documents.length === 0 ? (
          <div style={{ padding: 18 }}>
            <Empty
              title="Nothing here yet"
              body="When we send you a quotation or an invoice, it will appear here."
            />
          </div>
        ) : (
          <div className="portal-list">
            {documents.map((doc) => (
              <button key={doc.id} type="button" className="portal-row" onClick={() => onOpen(doc.id)}>
                <span className="portal-row-main">
                  <span className="portal-row-title">
                    {KIND_LABEL[doc.kind] ?? doc.kind} {doc.number}
                  </span>
                  <span className="muted">{doc.subject || readableDate(doc.date)}</span>
                </span>
                <span className="portal-row-side">
                  <span className="portal-row-amount num">
                    {money(portalTotals(doc, customerState).grand, doc.currency)}
                  </span>
                  <Chip tone={statusTone(doc.status)}>
                    {STATUS_LABEL[doc.status.toLowerCase()] ?? doc.status}
                  </Chip>
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── one document ───────────────────────────────────────────────────── */

function DocumentView({
  doc, customerState, token, onBack, onAnswered,
}: {
  doc: PortalDocument;
  customerState: string;
  token: string;
  onBack: () => void;
  onAnswered: () => void;
}) {
  const totals = useMemo(() => portalTotals(doc, customerState), [doc, customerState]);
  const paid = doc.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const canAnswer = doc.kind === "quotation" && doc.status.toLowerCase() === "sent";

  return (
    <div className="stack">
      <div>
        <Button onClick={onBack}>← All documents</Button>
      </div>

      <Card
        title={`${KIND_LABEL[doc.kind] ?? doc.kind} ${doc.number}`}
        actions={<Chip tone={statusTone(doc.status)}>{STATUS_LABEL[doc.status.toLowerCase()] ?? doc.status}</Chip>}
      >
        <div className="stack">
          <div className="portal-meta">
            {doc.date ? <div><span className="muted">Dated</span><div>{readableDate(doc.date)}</div></div> : null}
            {doc.validUntil ? <div><span className="muted">Valid until</span><div>{readableDate(doc.validUntil)}</div></div> : null}
            {doc.referenceNo ? <div><span className="muted">Your reference</span><div>{doc.referenceNo}</div></div> : null}
            {doc.preparedBy ? <div><span className="muted">Prepared by</span><div>{doc.preparedBy}</div></div> : null}
          </div>
          {doc.subject ? <p style={{ margin: 0, fontWeight: 600 }}>{doc.subject}</p> : null}
          {doc.intro ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{doc.intro}</p> : null}
        </div>
      </Card>

      <Card title="What's on it" padded={false}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Tax</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {totals.rows.map((row, i) => {
                const item = doc.items[i];
                return (
                  <tr key={item?.id ?? i}>
                    <td>
                      <div>{item?.desc || "—"}</div>
                      {item?.subDesc ? <div className="muted">{item.subDesc}</div> : null}
                      {item?.sku ? <div className="muted">{item.sku}</div> : null}
                    </td>
                    <td className="num">
                      {Number(item?.qty) || 0}{item?.unit ? ` ${item.unit}` : ""}
                    </td>
                    <td className="num">{money(item?.rate, doc.currency)}</td>
                    <td className="num">{Number(item?.gst) || 0}%</td>
                    <td className="num">{money(row.total, doc.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="portal-totals">
          <TotalRow label="Subtotal" value={money(totals.taxable, doc.currency)} />
          {totals.discount > 0 ? <TotalRow label="Discount" value={`− ${money(totals.discount, doc.currency)}`} /> : null}
          {totals.taxTotal > 0 ? <TotalRow label="Tax" value={money(totals.taxTotal, doc.currency)} /> : null}
          <TotalRow label="Total" value={money(totals.grand, doc.currency)} strong />
          {paid > 0 ? (
            <>
              <TotalRow label="Received" value={`− ${money(paid, doc.currency)}`} />
              <TotalRow label="Balance" value={money(Math.max(0, totals.grand - paid), doc.currency)} strong />
            </>
          ) : null}
        </div>
      </Card>

      {doc.payments.length > 0 ? (
        <Card title="Payments we've received">
          <div className="stack">
            {doc.payments.map((p, i) => (
              <div key={i} className="portal-payment">
                <span>
                  {readableDate(p.date)}
                  {p.mode ? ` · ${p.mode}` : ""}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span className="num">{money(p.amount, doc.currency)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {doc.terms.length > 0 || doc.paymentTerms || doc.deliveryTerms ? (
        <Card title="Terms">
          <div className="stack">
            {doc.paymentTerms ? <div><span className="muted">Payment</span><div>{doc.paymentTerms}</div></div> : null}
            {doc.deliveryTerms ? <div><span className="muted">Delivery</span><div>{doc.deliveryTerms}</div></div> : null}
            {doc.terms.length > 0 ? (
              <ul className="portal-terms">
                {doc.terms.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            ) : null}
          </div>
        </Card>
      ) : null}

      {doc.footer ? (
        <Card title="Notes">
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{doc.footer}</p>
        </Card>
      ) : null}

      {canAnswer ? <RespondCard doc={doc} token={token} onAnswered={onAnswered} /> : null}
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="portal-total-row" style={strong ? { fontWeight: 700 } : undefined}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

/* ── accepting or declining ─────────────────────────────────────────── */

function RespondCard({ doc, token, onAnswered }: { doc: PortalDocument; token: string; onAnswered: () => void }) {
  const [answer, setAnswer] = useState<"" | "accept" | "decline">("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!answer || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/.netlify/functions/portal-respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, documentId: doc.id, answer, signedBy: name.trim(), note: note.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "We couldn't record that. Please try again.");
        return;
      }
      onAnswered();
    } catch {
      setError("We couldn't reach our system. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (!answer) {
    return (
      <Card title="Your response">
        <div className="stack">
          <p style={{ margin: 0 }}>
            If this is right, accepting it here tells us to go ahead. If it isn't,
            declining lets us know rather than leaving it open.
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Button tone="primary" onClick={() => setAnswer("accept")}>Accept this quotation</Button>
            <Button onClick={() => setAnswer("decline")}>Decline</Button>
          </div>
        </div>
      </Card>
    );
  }

  /* A CONFIRM STEP, not a one-click accept. This is a commercial commitment,
     and the link may have been forwarded to somebody reading it out of
     interest — a stray tap must not order forty licences. */
  return (
    <Card title={answer === "accept" ? "Accept this quotation" : "Decline this quotation"}>
      <div className="stack">
        <p style={{ margin: 0 }}>
          {answer === "accept"
            ? `You're accepting ${doc.number}. We'll take this as your approval to proceed.`
            : `You're declining ${doc.number}. Nothing further will happen on it.`}
        </p>
        <Field label="Your name" hint="So we know who to thank — and who approved it.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ravi Menon" />
        </Field>
        <Field label={answer === "accept" ? "Anything to add?" : "What's the reason?"} hint="Optional, but it helps.">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error ? <p className="bad" style={{ margin: 0 }}>{error}</p> : null}
        <div className="row">
          <Button
            tone={answer === "accept" ? "primary" : "danger"}
            loading={sending}
            loadingLabel="Recording…"
            onClick={() => void send()}
          >
            {answer === "accept" ? "Confirm — accept" : "Confirm — decline"}
          </Button>
          <Button onClick={() => setAnswer("")} disabled={sending}>Back</Button>
        </div>
      </div>
    </Card>
  );
}

/* ── chrome ─────────────────────────────────────────────────────────── */

function Frame({ company, children }: { company?: PortalData["company"]; children: ReactNode }) {
  return (
    <main className="public-form">
      <div className="public-panel">
        <header className="public-head">
          {company?.logo ? <img src={company.logo} alt="" className="public-logo" /> : null}
          <div>
            <div className="public-company">{company?.name || "Your documents"}</div>
            {company?.tagline ? <div className="muted">{company.tagline}</div> : null}
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
