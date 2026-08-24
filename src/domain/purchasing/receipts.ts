import { round2 } from "../money";
import type { LineItem } from "../tax/types";

/**
 * What has actually turned up against a purchase order.
 *
 * Pure: no clock, no I/O, no storage of its own. A purchase order carries a
 * list of receipt EVENTS — each one a delivery that arrived, with the
 * quantities on it — and everything anyone wants to know (how much is still
 * outstanding, whether the order is complete) is derived from that list on
 * every read.
 *
 * NOTHING IS STORED AS A TOTAL. The alternative — keeping a `receivedQty` on
 * each line and adding to it — loses the delivery history the moment anyone
 * corrects a number, and gives you no way to answer "which delivery was
 * short". Events keep both, and a mistyped receipt is fixed by removing the
 * event rather than by reverse-engineering a running total.
 *
 * Deliberately NOT a status field. A purchase order's status column says what
 * the buyer has done with it (drafted, issued, cancelled); whether the goods
 * arrived is a fact about deliveries, and the two must never be able to
 * disagree.
 */

/** One line on one delivery: how much of a given order line turned up. */
export interface ReceiptLine {
  /** The `id` of the LineItem on the purchase order this quantity is against. */
  itemId: string;
  qty?: number | string;
}

/** One delivery. Several may arrive against a single order. */
export interface GoodsReceipt {
  id: string;
  /** The date the goods were received, not the date it was keyed in. */
  date?: string;
  /** The supplier's delivery challan or invoice number — what to quote when
   *  a delivery is disputed. */
  challanNo?: string;
  /** Who took delivery. */
  receivedBy?: string;
  /** Damage, shortages, wrong model — anything worth remembering later. */
  note?: string;
  lines?: ReceiptLine[];
}

/** A purchase order, as far as receiving is concerned. Narrow on purpose:
 *  receiving must not depend on prices, parties, or anything a document
 *  redesign could move. */
export interface ReceivableDocument {
  items?: LineItem[];
  receipts?: GoodsReceipt[] | null;
}

export type ReceiptStatus = "none" | "partial" | "complete" | "over";

export interface LineReceipt {
  item: LineItem;
  /** Quantity on the order. */
  ordered: number;
  /** Total received across every delivery. */
  received: number;
  /** Still to come. Floored at zero — an over-delivery is reported through
   *  `status`, not as a negative outstanding, because "-3 outstanding" reads
   *  as a shortage at a glance. */
  outstanding: number;
  status: ReceiptStatus;
}

export interface ReceiptSummary {
  lines: LineReceipt[];
  /** The order as a whole. `partial` the moment anything has arrived and
   *  anything is still due. */
  status: ReceiptStatus;
  /** How many order lines are fully satisfied, and how many there are. */
  linesComplete: number;
  lineCount: number;
  /** 0–100, by quantity across all lines, capped. Progress for a bar. */
  pct: number;
  /** True once at least one delivery has been recorded, whatever it said. */
  hasReceipts: boolean;
}

const qtyOf = (v: unknown): number => {
  const n = Number(v);
  /* A negative quantity is a keying error, not a return: treating it as
     stock going back out would silently reduce what the supplier still
     owes. Returns are their own document. */
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function statusOf(ordered: number, received: number): ReceiptStatus {
  if (received <= 0) return "none";
  if (received > ordered) return "over";
  /* An order line for zero is already satisfied by definition — otherwise a
     line someone zeroed out would hold the whole order open forever. */
  if (received >= ordered) return "complete";
  return "partial";
}

/**
 * Fold every delivery into a per-line and whole-order picture.
 *
 * Receipt lines naming an item that is no longer on the order are IGNORED
 * rather than errored: a line can be deleted from a purchase order after a
 * delivery was recorded against it, and losing the rest of the report over
 * one orphan would be a worse outcome than dropping it.
 */
export function summarizeReceipts(doc: ReceivableDocument): ReceiptSummary {
  const items = doc.items ?? [];
  const receipts = doc.receipts ?? [];

  const receivedById = new Map<string, number>();
  for (const receipt of receipts) {
    for (const line of receipt.lines ?? []) {
      if (!line.itemId) continue;
      receivedById.set(line.itemId, round2((receivedById.get(line.itemId) ?? 0) + qtyOf(line.qty)));
    }
  }

  const lines: LineReceipt[] = items.map((item) => {
    const ordered = qtyOf(item.qty);
    const received = round2(receivedById.get(item.id) ?? 0);
    return {
      item,
      ordered,
      received,
      outstanding: round2(Math.max(0, ordered - received)),
      status: statusOf(ordered, received),
    };
  });

  const totalOrdered = round2(lines.reduce((a, l) => a + l.ordered, 0));
  const totalReceived = round2(lines.reduce((a, l) => a + l.received, 0));
  const linesComplete = lines.filter((l) => l.status === "complete" || l.status === "over").length;

  /* The order is only complete when every line is. Comparing summed
     quantities instead would call an order complete when a double delivery
     of one item covered a shortfall of another. */
  const anyReceived = lines.some((l) => l.received > 0);
  const anyOver = lines.some((l) => l.status === "over");
  const allDone = lines.length > 0 && linesComplete === lines.length;

  const status: ReceiptStatus = anyOver && allDone
    ? "over"
    : allDone
      ? "complete"
      : anyReceived
        ? "partial"
        : "none";

  return {
    lines,
    status,
    linesComplete,
    lineCount: lines.length,
    pct: totalOrdered > 0 ? Math.min(100, Math.round((totalReceived / totalOrdered) * 100)) : 0,
    hasReceipts: receipts.length > 0,
  };
}

/** What is still due, ready to prefill a new delivery. Lines already
 *  satisfied are left out — nobody wants to zero them by hand. */
export function outstandingLines(doc: ReceivableDocument): LineReceipt[] {
  return summarizeReceipts(doc).lines.filter((l) => l.outstanding > 0);
}

/** True when nothing is left to receive, so the button offering to record
 *  another delivery can be hidden rather than left to disappoint. */
export const isFullyReceived = (doc: ReceivableDocument): boolean => {
  const s = summarizeReceipts(doc);
  return s.lineCount > 0 && s.linesComplete === s.lineCount;
};

const STATUS_LABELS: Record<ReceiptStatus, string> = {
  none: "Awaiting delivery",
  partial: "Partially received",
  complete: "Received",
  over: "Over-received",
};

export const receiptStatusLabel = (status: ReceiptStatus): string => STATUS_LABELS[status];

/**
 * The purchase order status implied by what has arrived.
 *
 * Returns null when receiving has nothing to say — no deliveries yet, or the
 * order is cancelled or still a draft, where the goods are not the point.
 * The caller decides whether to apply it; this never mutates anything,
 * because a status quietly rewritten under someone is how a cancelled order
 * comes back to life.
 */
export function impliedStatus(doc: ReceivableDocument, current: string): string | null {
  if (current === "Cancelled" || current === "Draft") return null;
  const { status } = summarizeReceipts(doc);
  if (status === "partial") return current === "Partially Received" ? null : "Partially Received";
  if (status === "complete" || status === "over") return current === "Received" ? null : "Received";
  return null;
}
