import { useMemo, useState } from "react";
import { Presence } from "../../components/Presence";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Input, Meter, Tabs } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { Modal } from "../../components/Modal";
import { AttachmentsPanel } from "../attachments/AttachmentsPanel";
import { ORDER_STAGES, orderStageOf, type OrderStageId } from "../../domain/orders/stages";
import { orderFulfilment, type Challan } from "../../domain/orders/fulfilment";
import { newChallan, suggestedStage, type DeliveryChallan, type SalesOrder } from "../../domain/orders/create";
import { computeDocument } from "../../domain/tax/compute";
import { inrList } from "../../domain/currency/format";
import { fmtDate } from "../../domain/dates";

export interface OrdersScreenProps {
  orders: SalesOrder[];
  challans: DeliveryChallan[];
  settings: Record<string, unknown>;
  /** Who is looking — a file they attach is uploaded as them. */
  currentUser: { id: string; name: string; role?: string };
  onChange: (orders: SalesOrder[], challans: DeliveryChallan[], settings: Record<string, unknown>) => void;
}

export function OrdersScreen({ orders, challans, settings, currentUser, onChange }: OrdersScreenProps) {
  const toast = useToast();
  const [stage, setStage] = useState<string>("open");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<SalesOrder | null>(null);
  const sellerState = ((settings["company"] as { state?: string })?.state) ?? "Delhi";

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (stage === "open" && !orderStageOf(o.stage).open) return false;
      if (stage !== "open" && stage !== "all" && o.stage !== stage) return false;
      if (!q) return true;
      return [o.number, o.billName, o.poNumber].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [orders, stage, query]);

  const setStageOf = (order: SalesOrder, next: OrderStageId) => {
    onChange(orders.map((o) => (o.id === order.id ? { ...o, stage: next, updatedAt: Date.now() } : o)), challans, settings);
    toast(`${order.number} moved to ${orderStageOf(next).label}.`, "good");
  };

  const raiseChallan = (order: SalesOrder) => {
    const dc = newChallan(order, challans as Challan[], settings as { dispatchPrefix?: string; dispatchSeq?: number });
    if (!dc.items.length) {
      toast("Everything on this order has already been dispatched.", "warn");
      return;
    }
    onChange(orders, [dc, ...challans], { ...settings, dispatchSeq: (Number(settings["dispatchSeq"]) || 1) + 1 });
    toast(`Challan ${dc.number} raised for ${dc.items.length} pending line${dc.items.length === 1 ? "" : "s"}.`, "good");
  };

  return (
    <main className="page">
      <PageHead
        title="Sales orders"
        sub={`${orders.filter((o) => orderStageOf(o.stage).open).length} still open.`}
      />

      <Card padded={false}>
        <div style={{ padding: "0 var(--gap-wide)" }}>
          <Tabs
            active={stage}
            onChange={setStage}
            tabs={[
              { id: "open", label: "Open", count: orders.filter((o) => orderStageOf(o.stage).open).length },
              { id: "all", label: "All", count: orders.length },
              ...ORDER_STAGES.map((s) => ({
                id: s.id, label: s.label, count: orders.filter((o) => o.stage === s.id).length,
              })),
            ]}
          />
        </div>

        <div className="row wrap" style={{ padding: "var(--gap) var(--gap-wide)" }}>
          <Input style={{ maxWidth: 280 }} placeholder="Search order, customer, PO…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="grow" />
          <span className="field-hint">{shown.length} shown</span>
        </div>

        {shown.length === 0 ? (
          <Empty title="No orders here" body="A sales order is raised when a proforma is marked Paid." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 4 }} />
                  <th>Order</th>
                  <th>Customer</th>
                  <th>PO</th>
                  <th>Date</th>
                  <th>Stage</th>
                  <th style={{ minWidth: 130 }}>Dispatched</th>
                  <th className="num">Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => {
                  const f = orderFulfilment(o, challans as Challan[]);
                  const totals = computeDocument(o, sellerState);
                  const stageInfo = orderStageOf(o.stage);
                  const suggest = suggestedStage(o.stage, f.pct);
                  return (
                    <tr key={o.id} className={suggest ? "needs-warn" : undefined}>
                      <td className="edge-cell" />
                      <td data-head className="mono strong">{o.number}</td>
                      <td data-label="Customer" className="strong">{o.billName}</td>
                      <td data-label="PO" className="muted">{o.poNumber || "—"}</td>
                      <td data-label="Date" className="muted">{fmtDate(o.date)}</td>
                      <td data-label="Stage"><Chip tone={stageInfo.tone}>{stageInfo.label}</Chip></td>
                      <td data-label="Dispatched" data-block>
                        <Meter pct={f.pct} tone={f.pct === 100 ? "good" : undefined} />
                        <div className="field-hint">{f.dispatched} of {f.ordered} units</div>
                      </td>
                      <td data-label="Value" className="num strong">{inrList(totals.grand)}</td>
                      <td data-actions>
                        <span className="row-tight">
                          {suggest ? (
                            <Button size="sm" tone="default" onClick={() => setStageOf(o, suggest)}>
                              Move to {orderStageOf(suggest).label}
                            </Button>
                          ) : null}
                          {f.remaining > 0 && stageInfo.open ? (
                            <Button size="sm" tone="quiet" onClick={() => raiseChallan(o)}>New challan</Button>
                          ) : null}
                          {/* The customer's own PO, the signed delivery note,
                              the site photo — the paperwork an order collects
                              that is not a document this CRM produced. */}
                          <Button size="sm" tone="quiet" onClick={() => setFiles(o)}>Files</Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="field-hint" style={{ marginTop: "var(--gap-wide)" }}>
        Stage changes are suggested from what has actually shipped, never applied on their own —
        an order can be fully dispatched and still not delivered.
      </p>

      <Presence value={files}>
        {(order, open) => (
          <Modal
            open={open}
            side
            title={`Files — ${order.number}`}
            description={`${order.billName || "This order"}${order.poNumber ? ` · their PO ${order.poNumber}` : ""}`}
            onClose={() => setFiles(null)}
          >
            <AttachmentsPanel
              framed={false}
              recordType="order"
              recordId={order.id}
              ownerId={order.ownerId}
              currentUser={currentUser}
            />
          </Modal>
        )}
      </Presence>
    </main>
  );
}
