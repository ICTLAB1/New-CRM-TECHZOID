import { useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Field, Input, Select } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { COURIERS, DISPATCH_STATUSES, DISPATCH_TONE, type DispatchStatus } from "../../domain/orders/stages";
import type { DeliveryChallan } from "../../domain/orders/create";
import { fmtDate } from "../../domain/dates";

export function DispatchScreen({
  challans, onChange,
}: {
  challans: DeliveryChallan[];
  onChange: (challans: DeliveryChallan[]) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<DeliveryChallan | null>(null);

  const save = (dc: DeliveryChallan) => {
    onChange(challans.map((c) => (c.id === dc.id ? { ...dc, updatedAt: Date.now() } : c)));
    setEditing(null);
    toast(`Challan ${dc.number} updated.`, "good");
  };

  return (
    <main className="page">
      <PageHead title="Dispatch" sub={`${challans.length} delivery challan${challans.length === 1 ? "" : "s"}.`} />

      <Card padded={false}>
        {challans.length === 0 ? (
          <Empty title="Nothing dispatched yet" body="Raise a challan from a sales order that has lines still to ship." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 4 }} />
                  <th>Challan</th><th>Order</th><th>Ship to</th><th>Courier</th>
                  <th>Tracking</th><th>Dispatched</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {challans.map((c) => {
                  const late = c.status !== "Delivered" && c.status !== "Returned" && !!c.expectedDeliveryDate
                    && c.expectedDeliveryDate < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={c.id} className={late ? "needs-warn" : undefined}>
                      <td className="edge-cell" />
                      <td className="mono strong">{c.number}</td>
                      <td className="mono">{c.orderNumber}</td>
                      <td className="strong">{c.shipName}</td>
                      <td>{c.courier}</td>
                      <td className="mono">{c.trackingNo || "—"}</td>
                      <td className="muted">{fmtDate(c.dispatchDate)}</td>
                      <td><Chip tone={DISPATCH_TONE[c.status]}>{c.status}</Chip></td>
                      <td><Button size="sm" tone="quiet" onClick={() => setEditing(c)}>Update</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing ? (
        <ChallanModal challan={editing} onSave={save} onClose={() => setEditing(null)} />
      ) : null}
    </main>
  );
}

function ChallanModal({
  challan, onSave, onClose,
}: {
  challan: DeliveryChallan;
  onSave: (c: DeliveryChallan) => void;
  onClose: () => void;
}) {
  const [c, setC] = useState(challan);
  const set = <K extends keyof DeliveryChallan>(k: K) => (e: { target: { value: string } }) =>
    setC((cur) => ({ ...cur, [k]: e.target.value }));

  return (
    <Modal
      open
      title={`Challan ${c.number}`}
      description={`Against order ${c.orderNumber}, shipping to ${c.shipName}.`}
      onClose={onClose}
      footer={<><Button tone="quiet" onClick={onClose}>Cancel</Button><Button tone="primary" onClick={() => onSave(c)}>Save</Button></>}
    >
      <div className="stack">
        <div className="grid grid-2">
          <Field label="Courier">
            <Select value={c.courier} onChange={set("courier")}>
              {COURIERS.map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select
              value={c.status}
              onChange={(e) => {
                const status = e.target.value as DispatchStatus;
                /* Marking delivered stamps the date, so nobody has to
                   remember to fill it in afterwards — and it is the date the
                   whole delivery report reads from. */
                setC((cur) => ({
                  ...cur,
                  status,
                  deliveredDate: status === "Delivered" ? (cur.deliveredDate || new Date().toISOString().slice(0, 10)) : cur.deliveredDate,
                }));
              }}
            >
              {DISPATCH_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Tracking number"><Input value={c.trackingNo ?? ""} onChange={set("trackingNo")} /></Field>
          <Field label="E-way bill"><Input value={c.ewayBill ?? ""} onChange={set("ewayBill")} /></Field>
          <Field label="Dispatch date"><Input type="date" value={c.dispatchDate} onChange={set("dispatchDate")} /></Field>
          <Field label="Expected delivery"><Input type="date" value={c.expectedDeliveryDate ?? ""} onChange={set("expectedDeliveryDate")} /></Field>
          <Field label="Delivered on"><Input type="date" value={c.deliveredDate ?? ""} onChange={set("deliveredDate")} /></Field>
          <Field label="Transporter"><Input value={c.transporter ?? ""} onChange={set("transporter")} /></Field>
        </div>
        <div className="field-hint">{c.items.length} line{c.items.length === 1 ? "" : "s"} on this challan.</div>
      </div>
    </Modal>
  );
}
