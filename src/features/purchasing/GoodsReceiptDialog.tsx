import { useState } from "react";
import { Button, Chip, Field, Input, Meter, Textarea } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { fmtDate, TODAY } from "../../domain/dates";
import {
  impliedStatus, receiptStatusLabel, summarizeReceipts,
  type GoodsReceipt, type ReceiptStatus,
} from "../../domain/purchasing/receipts";
import type { SalesDocument } from "../../domain/documents/create";
import type { Tone } from "../../components/primitives";

/**
 * Logging a delivery against a purchase order.
 *
 * Prefilled with what is still owed, because a full delivery is the common
 * case and re-typing the same numbers is where a shortage gets missed. Lines
 * already satisfied are shown but not editable — seeing the whole order is
 * how you notice the box that never arrived.
 *
 * The dialog writes a receipt EVENT. It never edits a running total, so a
 * delivery keyed wrong is undone by deleting it rather than by working out
 * what the number used to be.
 */

const LINE_TONE: Record<ReceiptStatus, Tone> = {
  none: "neutral", partial: "warn", complete: "good", over: "accent",
};

export interface GoodsReceiptDialogProps {
  open: boolean;
  doc: SalesDocument;
  /** Who is logging it, so the record says who signed for the goods. */
  currentUser: { name: string };
  /** Hands back the order with the delivery added, and the status receiving
   *  implies already applied. */
  onSave: (next: SalesDocument) => void;
  onClose: () => void;
}

export function GoodsReceiptDialog({ open, doc, currentUser, onSave, onClose }: GoodsReceiptDialogProps) {
  const toast = useToast();
  const summary = summarizeReceipts(doc);

  /* Keyed by line id, prefilled with the outstanding quantity. A line with
     nothing left owed starts blank rather than at zero: a zero someone has
     to clear reads as a number they entered. */
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(summary.lines.map((l) => [l.item.id, l.outstanding > 0 ? String(l.outstanding) : ""])),
  );
  const [date, setDate] = useState(TODAY());
  const [challanNo, setChallanNo] = useState("");
  const [receivedBy, setReceivedBy] = useState(currentUser.name);
  const [note, setNote] = useState("");

  const entered = summary.lines
    .map((l) => ({ itemId: l.item.id, qty: Number(qtys[l.item.id]) || 0 }))
    .filter((l) => l.qty > 0);

  const total = entered.reduce((a, l) => a + l.qty, 0);

  const save = () => {
    const receipt: GoodsReceipt = {
      id: Math.random().toString(36).slice(2, 10),
      date,
      challanNo: challanNo.trim(),
      receivedBy: receivedBy.trim(),
      note: note.trim(),
      lines: entered,
    };
    const withReceipt: SalesDocument = {
      ...doc,
      receipts: [...(doc.receipts ?? []), receipt],
      updatedAt: Date.now(),
    };
    /* Status follows the goods rather than being set by hand — but only
       where receiving has something to say. `impliedStatus` returns null on
       a cancelled or draft order, and the status is left exactly as it was. */
    const next = impliedStatus(withReceipt, withReceipt.status);
    onSave(next ? { ...withReceipt, status: next } : withReceipt);
    toast(
      next === "Received"
        ? `${doc.number} is fully received.`
        : `Delivery recorded against ${doc.number}.`,
      "good",
    );
  };

  return (
    <Modal
      open={open}
      side
      title={`Record a delivery — ${doc.number}`}
      description={
        doc.vendorName
          ? `Goods arriving from ${doc.vendorName}. Quantities are prefilled with what is still owed.`
          : "Quantities are prefilled with what is still owed."
      }
      unsavedChanges={entered.length > 0}
      onClose={onClose}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Cancel</Button>
          <Button tone="primary" disabled={entered.length === 0} onClick={save}>
            Record delivery
          </Button>
        </>
      }
    >
      <div className="stack">
        {summary.hasReceipts ? (
          <div>
            <div className="row-tight" style={{ marginBottom: 6 }}>
              <Chip tone={LINE_TONE[summary.status]}>{receiptStatusLabel(summary.status)}</Chip>
              <span className="field-hint">
                {summary.linesComplete} of {summary.lineCount} lines complete
              </span>
            </div>
            <Meter pct={summary.pct} tone={summary.pct >= 100 ? "good" : "warn"} />
          </div>
        ) : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Ordered</th>
                <th className="num">Received</th>
                <th className="num">Outstanding</th>
                <th className="num" style={{ width: 120 }}>Arriving now</th>
              </tr>
            </thead>
            <tbody>
              {summary.lines.map((line) => (
                <tr key={line.item.id}>
                  <td>
                    <div className="strong">{line.item.desc || "—"}</div>
                    {line.item.sku ? <div className="field-hint">{line.item.sku}</div> : null}
                  </td>
                  <td className="num muted">{line.ordered}{line.item.unit ? " " + line.item.unit : ""}</td>
                  <td className="num muted">{line.received || "—"}</td>
                  <td className="num strong">
                    {line.outstanding > 0
                      ? line.outstanding
                      : <Chip tone={LINE_TONE[line.status]}>{receiptStatusLabel(line.status)}</Chip>}
                  </td>
                  <td className="num">
                    <Input
                      numeric
                      value={qtys[line.item.id] ?? ""}
                      placeholder="0"
                      onChange={(e) => setQtys((cur) => ({ ...cur, [line.item.id]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-2">
          <Field label="Date received" hint="When the goods arrived, not when this was keyed in.">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Supplier challan / invoice no." hint="What to quote if a delivery is ever disputed.">
            <Input value={challanNo} onChange={(e) => setChallanNo(e.target.value)} />
          </Field>
        </div>
        <Field label="Received by">
          <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
        </Field>
        <Field label="Note" hint="Damage, shortages, wrong model — anything worth remembering later.">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {total > 0 ? (
          <div className="field-hint">{total} unit(s) across {entered.length} line(s) on this delivery.</div>
        ) : (
          <div className="field-hint">Enter at least one quantity to record a delivery.</div>
        )}

        {summary.hasReceipts ? <ReceiptHistory doc={doc} onSave={onSave} /> : null}
      </div>
    </Modal>
  );
}

/* ── what has already arrived ──────────────────────────────────────── */

/**
 * Past deliveries, newest last, each removable.
 *
 * Removing is how a mistyped delivery is corrected: the event goes, and
 * every total recomputes from what is left. Editing the numbers in place
 * would leave no trace that the correction happened.
 */
function ReceiptHistory({ doc, onSave }: { doc: SalesDocument; onSave: (next: SalesDocument) => void }) {
  const toast = useToast();
  const receipts = doc.receipts ?? [];

  const remove = (id: string) => {
    const next: SalesDocument = {
      ...doc,
      receipts: receipts.filter((r) => r.id !== id),
      updatedAt: Date.now(),
    };
    onSave(next);
    toast("Delivery removed. Outstanding quantities have gone back up.", "good");
  };

  return (
    <div>
      <div className="field-hint" style={{ marginBottom: 6 }}>Deliveries so far</div>
      <div className="stack" style={{ gap: 8 }}>
        {receipts.map((r) => {
          const units = (r.lines ?? []).reduce((a, l) => a + (Number(l.qty) || 0), 0);
          return (
            <div key={r.id} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
              <div className="grow">
                <div className="strong">
                  {fmtDate(r.date)} · {units} unit(s)
                  {r.challanNo ? ` · ${r.challanNo}` : ""}
                </div>
                <div className="field-hint">
                  {[r.receivedBy ? "Received by " + r.receivedBy : "", r.note]
                    .filter(Boolean).join(" · ") || "No note."}
                </div>
              </div>
              <Button size="sm" tone="quiet" onClick={() => remove(r.id)}>Remove</Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
