/**
 * How much of an order has actually shipped.
 *
 * Dispatch is per line and partial: a challan can carry three of the ten
 * laptops on an order, and another the rest. Fulfilment is therefore
 * computed from the challans, never stored on the order — a stored figure
 * drifts the moment a challan is edited or deleted.
 */

export interface OrderLine {
  id: string;
  qty?: number | string;
}

export interface ChallanLine {
  itemId: string;
  qty?: number | string;
}

export interface Challan {
  id: string;
  orderId: string;
  items?: ChallanLine[];
}

export interface Fulfilment {
  ordered: number;
  dispatched: number;
  remaining: number;
  /** 0–100, capped. */
  pct: number;
  /** Dispatched quantity per order line id. */
  byLine: Record<string, number>;
}

/** Total quantity already dispatched for each line of an order. */
export function dispatchedByLine(orderId: string, challans: readonly Challan[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const challan of challans) {
    if (challan.orderId !== orderId) continue;
    for (const line of challan.items ?? []) {
      map[line.itemId] = (map[line.itemId] ?? 0) + (Number(line.qty) || 0);
    }
  }
  return map;
}

export function orderFulfilment(
  order: { id: string; items?: OrderLine[] },
  challans: readonly Challan[],
): Fulfilment {
  const byLine = dispatchedByLine(order.id, challans);
  let ordered = 0;
  let dispatched = 0;
  for (const line of order.items ?? []) {
    const want = Number(line.qty) || 0;
    ordered += want;
    /* Cap at the ordered quantity: over-dispatching one line must not make
       the order look more than complete, and it must not mask another line
       that has shipped nothing. */
    dispatched += Math.min(byLine[line.id] ?? 0, want);
  }
  return {
    ordered,
    dispatched,
    remaining: Math.max(0, ordered - dispatched),
    pct: ordered ? Math.round((dispatched / ordered) * 100) : 0,
    byLine,
  };
}

/** What is left to ship on each line, for pre-filling a new challan. */
export function pendingLines(
  order: { id: string; items?: OrderLine[] },
  challans: readonly Challan[],
): { itemId: string; qty: number }[] {
  const byLine = dispatchedByLine(order.id, challans);
  return (order.items ?? [])
    .map((line) => ({ itemId: line.id, qty: Math.max(0, (Number(line.qty) || 0) - (byLine[line.id] ?? 0)) }))
    .filter((l) => l.qty > 0);
}
