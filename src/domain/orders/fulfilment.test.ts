import { describe, expect, it } from "vitest";
import { dispatchedByLine, orderFulfilment, pendingLines, type Challan } from "./fulfilment";
import { ORDER_STAGES, orderStageOf } from "./stages";

const order = { id: "o1", items: [{ id: "a", qty: 10 }, { id: "b", qty: 5 }, { id: "c", qty: 2 }] };

const challan = (id: string, lines: [string, number][], orderId = "o1"): Challan => ({
  id, orderId, items: lines.map(([itemId, qty]) => ({ itemId, qty })),
});

describe("dispatched quantities", () => {
  it("sums across challans, per line", () => {
    const map = dispatchedByLine("o1", [challan("d1", [["a", 4]]), challan("d2", [["a", 3], ["b", 5]])]);
    expect(map).toEqual({ a: 7, b: 5 });
  });

  it("ignores challans for other orders", () => {
    expect(dispatchedByLine("o1", [challan("d1", [["a", 4]], "other")])).toEqual({});
  });

  it("reads quantities stored as strings", () => {
    expect(dispatchedByLine("o1", [{ id: "d", orderId: "o1", items: [{ itemId: "a", qty: "3" }] }])).toEqual({ a: 3 });
  });

  it("survives a challan with no items", () => {
    expect(dispatchedByLine("o1", [{ id: "d", orderId: "o1" }])).toEqual({});
  });
});

describe("order fulfilment", () => {
  it("is zero for an order with nothing dispatched", () => {
    expect(orderFulfilment(order, [])).toMatchObject({ ordered: 17, dispatched: 0, remaining: 17, pct: 0 });
  });

  it("counts a partial dispatch", () => {
    const f = orderFulfilment(order, [challan("d1", [["a", 5]])]);
    expect(f).toMatchObject({ ordered: 17, dispatched: 5, remaining: 12, pct: 29 });
  });

  it("reaches 100% only when every line has shipped", () => {
    const f = orderFulfilment(order, [challan("d1", [["a", 10], ["b", 5], ["c", 2]])]);
    expect(f).toMatchObject({ dispatched: 17, remaining: 0, pct: 100 });
  });

  it("caps an over-dispatched line at what was ordered", () => {
    // Shipping 20 of a line of 10 must not make the order look more than
    // complete, and must not mask the lines that have shipped nothing.
    const f = orderFulfilment(order, [challan("d1", [["a", 20]])]);
    expect(f.dispatched).toBe(10);
    expect(f.remaining).toBe(7);
    expect(f.pct).toBe(59);
  });

  it("does not divide by zero on an order with no lines", () => {
    const f = orderFulfilment({ id: "o2", items: [] }, []);
    expect(f.pct).toBe(0);
    expect(Number.isFinite(f.pct)).toBe(true);
  });

  it("survives an order with no items array at all", () => {
    expect(orderFulfilment({ id: "o3" }, []).ordered).toBe(0);
  });
});

describe("pending lines", () => {
  it("lists what is left to ship", () => {
    expect(pendingLines(order, [challan("d1", [["a", 4]])])).toEqual([
      { itemId: "a", qty: 6 }, { itemId: "b", qty: 5 }, { itemId: "c", qty: 2 },
    ]);
  });

  it("omits lines already complete", () => {
    const pending = pendingLines(order, [challan("d1", [["a", 10], ["b", 5]])]);
    expect(pending).toEqual([{ itemId: "c", qty: 2 }]);
  });

  it("is empty for a fully dispatched order", () => {
    expect(pendingLines(order, [challan("d1", [["a", 10], ["b", 5], ["c", 2]])])).toEqual([]);
  });

  it("never returns a negative quantity", () => {
    expect(pendingLines(order, [challan("d1", [["a", 99]])]).find((l) => l.itemId === "a")).toBeUndefined();
  });
});

describe("order stages", () => {
  it("runs Confirmed to Closed, with Cancelled", () => {
    expect(ORDER_STAGES.map((s) => s.id)).toEqual([
      "confirmed", "procurement", "ready", "dispatched", "delivered", "closed", "cancelled",
    ]);
  });

  it("reads an unknown stage as Confirmed rather than blank", () => {
    expect(orderStageOf(undefined).id).toBe("confirmed");
    expect(orderStageOf("archived").id).toBe("confirmed");
  });

  it("counts delivered, closed and cancelled as no longer open", () => {
    for (const id of ["delivered", "closed", "cancelled"]) {
      expect(orderStageOf(id).open, id).toBe(false);
    }
    for (const id of ["confirmed", "procurement", "ready", "dispatched"]) {
      expect(orderStageOf(id).open, id).toBe(true);
    }
  });
});
