import { useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Input, StatTile, SummaryBar, Tabs } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { Field, Select } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import {
  daysLeft, dueForRenewal, expiryLabel, expiryTone, isPerpetual, normalizeSubscription,
  RENEWAL_STAGES, setSubscriptionType, SUB_BILLING, SUB_STATUSES, SUB_TYPES, SUB_VENDORS,
  valueAtRisk, type Subscription,
} from "../../domain/subscriptions/expiry";
import { inrList, inrShort } from "../../domain/currency/format";
import { fmtDate } from "../../domain/dates";

/**
 * Subscriptions and renewals on one screen.
 *
 * v1 had three: a dashboard, a pipeline and a calendar. They read the same
 * records and answered the same question — what is about to lapse and what
 * is it worth — so this is one screen with windows across the top. The
 * calendar earned its place least: a list sorted by days remaining says the
 * same thing in a tenth of the space.
 */
export function RenewalsScreen({
  subscriptions, customers, onChange,
}: {
  subscriptions: Subscription[];
  customers: { id: string; company?: string }[];
  onChange: (subs: Subscription[]) => void;
}) {
  const toast = useToast();
  const [window, setWindow] = useState("30");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Subscription | null>(null);

  const windows = [7, 30, 90] as const;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = window === "all"
      ? [...subscriptions].sort((a, b) => daysLeft(a) - daysLeft(b))
      : dueForRenewal(subscriptions, Number(window));
    if (!q) return base;
    return base.filter((s) => [s.customerName, s.product, s.vendor].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [subscriptions, window, query]);

  const save = (raw: Subscription) => {
    /* A perpetual licence loses its term here, not in the form: an old row
       edited for something else must not keep a countdown it should never
       have had. */
    const sub = normalizeSubscription(raw);
    const exists = subscriptions.some((s) => s.id === sub.id);
    onChange(exists ? subscriptions.map((s) => (s.id === sub.id ? sub : s)) : [sub, ...subscriptions]);
    setEditing(null);
    toast("Subscription saved.", "good");
  };

  return (
    <main className="page">
      <PageHead
        title="Subscriptions & renewals"
        sub="What is about to lapse, and what it is worth."
        actions={
          <Button tone="primary" onClick={() => setEditing({ id: Math.random().toString(36).slice(2, 10), ownerId: "", status: "Active", renewalStage: "Upcoming" })}>
            New subscription
          </Button>
        }
      />

      <div style={{ marginBottom: "var(--gap-wide)" }}>
        <SummaryBar columns={4}>
          <StatTile label="Due in 7 days" value={String(dueForRenewal(subscriptions, 7).length)} meta={inrShort(valueAtRisk(subscriptions, 7))} tone="bad" />
          <StatTile label="Due in 30 days" value={String(dueForRenewal(subscriptions, 30).length)} meta={inrShort(valueAtRisk(subscriptions, 30))} tone="warn" />
          <StatTile label="Due in 90 days" value={String(dueForRenewal(subscriptions, 90).length)} meta={inrShort(valueAtRisk(subscriptions, 90))} />
          <StatTile label="Under management" value={String(subscriptions.length)} meta={`${subscriptions.filter(isPerpetual).length} perpetual`} />
        </SummaryBar>
      </div>

      <Card padded={false}>
        <div style={{ padding: "0 var(--gap-wide)" }}>
          <Tabs
            active={window}
            onChange={setWindow}
            tabs={[
              ...windows.map((w) => ({ id: String(w), label: `Next ${w} days`, count: dueForRenewal(subscriptions, w).length })),
              { id: "all", label: "Everything", count: subscriptions.length },
            ]}
          />
        </div>

        <div className="row wrap" style={{ padding: "var(--gap) var(--gap-wide)" }}>
          <Input style={{ maxWidth: 280 }} placeholder="Search customer, product, vendor…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="grow" />
          <span className="field-hint">{shown.length} shown</span>
        </div>

        {shown.length === 0 ? (
          <Empty
            title="Nothing due in this window"
            body="Widen the window, or add the subscriptions you manage so they start appearing here before they lapse."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 4 }} />
                  <th>Customer</th><th>Product</th><th>Vendor</th><th>Expires</th>
                  <th>Countdown</th><th>Renewal stage</th><th className="num">Value</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const tone = expiryTone(s);
                  return (
                    <tr key={s.id} className={tone === "bad" ? "needs-bad" : tone === "warn" ? "needs-warn" : undefined}>
                      <td className="edge-cell" />
                      <td data-head className="strong">{s.customerName || "—"}</td>
                      <td data-label="Product">{s.product || "—"}</td>
                      <td data-label="Vendor" className="muted">{s.vendor || "—"}</td>
                      <td data-label="Expires" className="muted">{isPerpetual(s) ? "—" : fmtDate(s.expiryDate)}</td>
                      <td data-label="Status"><Chip tone={tone}>{expiryLabel(s)}</Chip></td>
                      <td data-label="Stage" className="muted">{isPerpetual(s) ? "—" : s.renewalStage || "—"}</td>
                      <td data-label="Value" className="num strong">{s.sellPrice ? inrList(s.sellPrice) : "—"}</td>
                      <td data-actions><Button size="sm" tone="quiet" onClick={() => setEditing(s)}>Edit</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing ? (
        <SubscriptionModal
          sub={editing}
          customers={customers}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </main>
  );
}

function SubscriptionModal({
  sub, customers, onSave, onClose,
}: {
  sub: Subscription;
  customers: { id: string; company?: string }[];
  onSave: (s: Subscription) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(sub);
  const set = <K extends keyof Subscription>(k: K) => (e: { target: { value: string } }) =>
    setS((cur) => ({ ...cur, [k]: e.target.value }));

  /* Either field can say "bought outright", so both are asked. Whichever one
     it was, the term fields below stop being answerable — and go with it. */
  const perpetual = isPerpetual(s);

  return (
    <Modal
      open
      side
      title={s.product || "New subscription"}
      description={
        perpetual
          ? "Bought outright. No expiry, no renewal."
          : s.expiryDate ? expiryLabel(s) : "No expiry date yet."
      }
      onClose={onClose}
      footer={<><Button tone="quiet" onClick={onClose}>Cancel</Button><Button tone="primary" onClick={() => onSave(s)}>Save</Button></>}
    >
      <div className="stack">
        <Field label="Customer">
          <Select
            value={s.customerId ?? ""}
            onChange={(e) => {
              const c = customers.find((x) => x.id === e.target.value);
              setS((cur) => ({ ...cur, customerId: e.target.value, customerName: c?.company ?? "" }));
            }}
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </Select>
        </Field>
        <Field label="Product"><Input value={s.product ?? ""} onChange={set("product")} /></Field>
        <div className="grid grid-2">
          <Field label="Vendor">
            <Select value={s.vendor ?? ""} onChange={set("vendor")}>
              <option value="">—</option>
              {SUB_VENDORS.map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select
              value={s.type ?? ""}
              onChange={(e) => setS((cur) => setSubscriptionType(cur, e.target.value))}
            >
              <option value="">—</option>
              {SUB_TYPES.map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Billing">
            <Select value={s.billing ?? ""} onChange={set("billing")}>
              <option value="">—</option>
              {SUB_BILLING.map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Seats"><Input numeric value={String(s.seats ?? "")} onChange={set("seats")} /></Field>
          <Field label="Starts"><Input type="date" value={s.startDate ?? ""} onChange={set("startDate")} /></Field>
          <Field
            label="Expires"
            hint={
              perpetual
                ? "A perpetual licence does not expire. Change Type or Status to give it a term."
                : "Leave blank for a perpetual licence."
            }
          >
            <Input
              type="date"
              value={perpetual ? "" : s.expiryDate ?? ""}
              disabled={perpetual}
              onChange={set("expiryDate")}
            />
          </Field>
          <Field label="Selling price"><Input numeric value={String(s.sellPrice ?? "")} onChange={set("sellPrice")} /></Field>
          <Field label="Status">
            <Select
              value={s.status ?? "Active"}
              onChange={(e) => setS((cur) => normalizeSubscription({ ...cur, status: e.target.value }))}
            >
              {SUB_STATUSES.map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Renewal stage" hint={perpetual ? "Nothing to renew." : undefined}>
            <Select value={s.renewalStage ?? "Upcoming"} disabled={perpetual} onChange={set("renewalStage")}>
              <option value="">—</option>
              {RENEWAL_STAGES.map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
