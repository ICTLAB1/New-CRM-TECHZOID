import { useState } from "react";
import { PageHead } from "./AppShell";
import { Button, Card, Chip, Empty, Field, Input, Meter, Select, StatTile, SummaryBar, Tabs, Textarea } from "../components/primitives";
import { Confirm, Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { inr, inrList, inrShort } from "../domain/currency/format";

/**
 * A single screen exercising every component in the system, used to review
 * the design as a whole rather than one control at a time. It is also how
 * the shell gets rendered and looked at — the same discipline the PDF gets.
 */

const QUOTES = [
  { no: "TZ/QT/2627/0117", customer: "Acme Manufacturing India Pvt Ltd", owner: "Priyanshi", value: 7178851, status: "Sent", tone: "accent" as const, due: "in 5 days" },
  { no: "TZ/QT/2627/0116", customer: "Northline Logistics", owner: "Rashmi", value: 412500, status: "Accepted", tone: "good" as const, due: "—" },
  { no: "TZ/QT/2627/0114", customer: "Sunrise Education Trust", owner: "Priyanshi", value: 86400, status: "Expired", tone: "bad" as const, due: "12 days ago", needs: "bad" as const },
  { no: "TZ/QT/2627/0111", customer: "Vertex Analytics Pvt Ltd", owner: "Rashmi", value: 1249000, status: "Draft", tone: "neutral" as const, due: "—" },
  { no: "TZ/QT/2627/0108", customer: "Harbour Foods Pvt Ltd", owner: "Priyanshi", value: 298750, status: "Sent", tone: "accent" as const, due: "tomorrow", needs: "warn" as const },
];

function Body() {
  const toast = useToast();
  const [tab, setTab] = useState<"all" | "open" | "attention">("attention");
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [gstin, setGstin] = useState("27AAPFU0939F1ZW");

  return (
    <main className="page">
      <PageHead
        title="Quotations"
        sub="Everything you have quoted this financial year."
        actions={
          <>
            <Button tone="quiet" onClick={() => toast("Exported 42 rows to CSV.", "good")}>Export</Button>
            <Button tone="default" onClick={() => setModal(true)}>Filters</Button>
            <Button tone="primary" onClick={() => toast("Draft quotation created.")}>New quotation</Button>
          </>
        }
      />

      <div style={{ marginBottom: "var(--gap-wide)" }}>
        <SummaryBar columns={5}>
          <StatTile label="Open pipeline" value={inrShort(24_860_000)} meta="18 deals" />
          <StatTile label="Won this month" value={inrShort(4_120_000)} meta="6 deals" tone="good" />
          <StatTile label="Quotes pending" value="11" meta="3 past validity" />
          <StatTile label="Payments due" value={inrShort(1_860_400)} meta="2 overdue" tone="bad" />
          <StatTile label="Renewals ≤30 days" value="7" meta="₹3.1 L at risk" tone="warn" />
        </SummaryBar>
      </div>

      <div className="grid grid-3" style={{ marginBottom: "var(--gap-wide)" }}>
        <Card edge="bad" title="Overdue proforma">
          <div className="label">Vertex Analytics Pvt Ltd</div>
          <div className="value-lg">{inr(486000)}</div>
          <div className="field-hint">TZ/PI/2627/0031 · 14 days past validity</div>
          <div style={{ marginTop: 12 }}><Meter pct={35} tone="bad" /></div>
          <div className="field-hint">35% collected · {inr(315900)} outstanding</div>
        </Card>
        <Card edge="warn" title="Follow-up due">
          <div className="label">Harbour Foods Pvt Ltd</div>
          <div className="value-lg">Tomorrow</div>
          <div className="field-hint">Quotation sent 11 days ago, no response</div>
        </Card>
        <Card title="Collected this month">
          <div className="value-lg">{inr(3_942_180)}</div>
          <div className="field-hint">Across 9 proformas</div>
          <div style={{ marginTop: 12 }}><Meter pct={78} tone="good" /></div>
          <div className="field-hint">78% of ₹50.5 L invoiced</div>
        </Card>
      </div>

      <Card padded={false} title="Recent quotations" actions={<Button size="sm" tone="quiet">View all</Button>}>
        <div style={{ padding: "0 var(--gap-wide)" }}>
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "all", label: "All", count: 42 },
              { id: "open", label: "Open", count: 11 },
              { id: "attention", label: "Needs attention", count: 2 },
            ]}
          />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 4 }} />
                <th>Number</th>
                <th>Customer</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Validity</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {QUOTES.map((q) => (
                <tr key={q.no} className={q.needs ? `needs-${q.needs}` : undefined}>
                  <td className="edge-cell" />
                  <td className="mono strong">{q.no}</td>
                  <td className="strong">{q.customer}</td>
                  <td>{q.owner}</td>
                  <td><Chip tone={q.tone}>{q.status}</Chip></td>
                  <td className="muted">{q.due}</td>
                  <td className="num strong">{inrList(q.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-2" style={{ marginTop: "var(--gap-block)", alignItems: "start" }}>
        <Card title="Controls">
          <div className="stack">
            <Field label="Company name" hint="As it should appear on the document.">
              <Input defaultValue="Acme Manufacturing India Private Limited" />
            </Field>
            <div className="grid grid-2">
              <Field
                label="GSTIN"
                error={gstin.length === 15 ? "Checksum failed — usually two digits transposed. Check it against the customer's certificate." : undefined}
              >
                <Input value={gstin} invalid={gstin.length === 15} onChange={(e) => setGstin(e.target.value)} />
              </Field>
              <Field label="Currency">
                <Select defaultValue="INR">
                  <option>INR</option><option>USD</option><option>AED</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-3">
              <Field label="Qty"><Input numeric defaultValue="250" /></Field>
              <Field label="Rate"><Input numeric defaultValue="2,899.50" /></Field>
              <Field label="Disc. %"><Input numeric defaultValue="7.50" /></Field>
            </div>
            <Field label="Notes"><Textarea rows={3} placeholder="Anything the customer should see on the document." /></Field>
            <div className="row-tight wrap">
              <Button tone="primary">Save</Button>
              <Button tone="default">Save &amp; preview</Button>
              <Button tone="quiet">Cancel</Button>
              <Button tone="danger" onClick={() => setConfirm(true)}>Delete</Button>
              <Button tone="default" disabled>Disabled</Button>
            </div>
          </div>
        </Card>

        <div className="stack">
          <Card title="States">
            <div className="row-tight wrap">
              <Chip tone="neutral">Draft</Chip>
              <Chip tone="accent">Sent</Chip>
              <Chip tone="good">Accepted</Chip>
              <Chip tone="good">Paid</Chip>
              <Chip tone="warn">Due soon</Chip>
              <Chip tone="bad">Overdue</Chip>
              <Chip tone="bad">Lost</Chip>
              <Chip tone="neutral">Expired</Chip>
            </div>
            <div className="field-hint" style={{ marginTop: 10 }}>
              Green means won or paid, amber means it needs attention, red means overdue or lost.
              Nothing else is coloured.
            </div>
            <div className="label" style={{ marginTop: 16 }}>Filled — reserved for where a state is the subject</div>
            <div className="row-tight wrap">
              <Chip solid tone="bad">Overdue</Chip>
              <Chip solid tone="good">Paid in full</Chip>
            </div>
          </Card>
          <Card padded={false}>
            <Empty
              title="No lost deals this quarter"
              body="When a deal is moved to Lost, the reason you record shows up here."
              action={<Button tone="default">See last quarter</Button>}
            />
          </Card>
          <Card title="Toasts">
            <div className="row-tight wrap">
              <Button size="sm" onClick={() => toast("Quotation saved.")}>Neutral</Button>
              <Button size="sm" onClick={() => toast("Payment of ₹4,86,000 recorded.", "good")}>Good</Button>
              <Button size="sm" onClick={() => toast("Sheet 'Hardware' imported 0 rows — its columns are named Artikel, Menge, Preis.", "warn")}>Warn</Button>
              <Button size="sm" onClick={() => toast("Could not send: no mailbox connected. Connect one in Settings → Integrations.", "bad")}>Bad</Button>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={modal}
        title="Filter quotations"
        description="On a phone this same component renders as a bottom sheet."
        onClose={() => setModal(false)}
        footer={<><Button tone="quiet" onClick={() => setModal(false)}>Cancel</Button><Button tone="primary" onClick={() => setModal(false)}>Apply</Button></>}
      >
        <div className="stack">
          <Field label="Status"><Select><option>Any</option><option>Draft</option><option>Sent</option></Select></Field>
          <Field label="Owner"><Select><option>Anyone</option><option>Priyanshi</option><option>Rashmi</option></Select></Field>
        </div>
      </Modal>

      <Confirm
        open={confirm}
        title="Delete this quotation?"
        body="TZ/QT/2627/0117 for Acme Manufacturing will be removed. This cannot be undone."
        confirmLabel="Delete quotation"
        tone="danger"
        onConfirm={() => { setConfirm(false); toast("Quotation deleted.", "good"); }}
        onCancel={() => setConfirm(false)}
      />
    </main>
  );
}

export function Showcase() {
  return <Body />;
}
