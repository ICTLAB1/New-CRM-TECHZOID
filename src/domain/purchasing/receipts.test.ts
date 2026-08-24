import { describe, expect, it } from "vitest";
import {
  impliedStatus, isFullyReceived, outstandingLines, receiptStatusLabel, summarizeReceipts,
  type GoodsReceipt, type ReceivableDocument,
} from "./receipts";
import type { LineItem } from "../tax/types";

/**
 * Receiving goods is where a purchase order stops being a promise. Every
 * test here pins one way the arithmetic could quietly lie about what turned
 * up — because the failure mode is not an error on screen, it is a supplier
 * being paid for stock nobody has.
 */

const item = (id: string, qty: number | string): LineItem => ({ id, desc: "Switch " + id, qty });

const po = (items: LineItem[], receipts: GoodsReceipt[] = []): ReceivableDocument => ({ items, receipts });

const receipt = (id: string, lines: { itemId: string; qty: number | string }[]): GoodsReceipt =>
  ({ id, date: "2026-08-20", lines });

describe("nothing received yet", () => {
  it("owes the full ordered quantity on every line", () => {
    const s = summarizeReceipts(po([item("a", 10), item("b", 4)]));
    expect(s.lines.map((l) => l.outstanding)).toEqual([10, 4]);
    expect(s.status).toBe("none");
    expect(s.pct).toBe(0);
    expect(s.hasReceipts).toBe(false);
  });

  it("reports an order with no lines as nothing rather than complete", () => {
    // An empty order is not a satisfied one — calling it complete would let
    // a blank purchase order sit in a "received" list.
    const s = summarizeReceipts(po([]));
    expect(s.status).toBe("none");
    expect(s.lineCount).toBe(0);
    expect(isFullyReceived(po([]))).toBe(false);
  });
});

describe("one delivery", () => {
  it("takes the whole order off when everything arrives", () => {
    const s = summarizeReceipts(po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 10 }])]));
    expect(s.status).toBe("complete");
    expect(s.lines[0]!.outstanding).toBe(0);
    expect(s.pct).toBe(100);
  });

  it("leaves the balance outstanding on a short delivery", () => {
    const s = summarizeReceipts(po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 4 }])]));
    expect(s.status).toBe("partial");
    expect(s.lines[0]!.received).toBe(4);
    expect(s.lines[0]!.outstanding).toBe(6);
    expect(s.pct).toBe(40);
  });
});

describe("several deliveries", () => {
  it("adds up quantities across every delivery", () => {
    const s = summarizeReceipts(po(
      [item("a", 10)],
      [receipt("r1", [{ itemId: "a", qty: 4 }]), receipt("r2", [{ itemId: "a", qty: 6 }])],
    ));
    expect(s.lines[0]!.received).toBe(10);
    expect(s.status).toBe("complete");
  });

  it("stays partial while any line is still short", () => {
    const s = summarizeReceipts(po(
      [item("a", 10), item("b", 5)],
      [receipt("r1", [{ itemId: "a", qty: 10 }])],
    ));
    expect(s.status).toBe("partial");
    expect(s.linesComplete).toBe(1);
    expect(s.lineCount).toBe(2);
  });

  it("never calls an order complete because one item over-covered another's shortfall", () => {
    // 15 of 15 units total, but item b never arrived. Summing quantities
    // across lines would report this complete; it is not.
    const s = summarizeReceipts(po(
      [item("a", 10), item("b", 5)],
      [receipt("r1", [{ itemId: "a", qty: 15 }])],
    ));
    expect(s.status).toBe("partial");
    expect(s.lines[1]!.outstanding).toBe(5);
  });
});

describe("over-delivery", () => {
  it("flags a line where more arrived than was ordered", () => {
    const s = summarizeReceipts(po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 12 }])]));
    expect(s.lines[0]!.status).toBe("over");
    expect(s.status).toBe("over");
  });

  it("never reports a negative outstanding — that reads as a shortage", () => {
    const s = summarizeReceipts(po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 12 }])]));
    expect(s.lines[0]!.outstanding).toBe(0);
  });

  it("caps progress at 100 rather than showing 120%", () => {
    const s = summarizeReceipts(po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 12 }])]));
    expect(s.pct).toBe(100);
  });
});

describe("bad data", () => {
  it("treats a missing quantity as nothing received, not as NaN", () => {
    const s = summarizeReceipts(po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: "" }])]));
    expect(s.lines[0]!.received).toBe(0);
    expect(s.lines[0]!.outstanding).toBe(10);
  });

  it("ignores a negative quantity rather than reducing what is owed", () => {
    // A negative is a keying error. Honouring it would silently increase the
    // outstanding balance against the supplier. Returns are their own thing.
    const s = summarizeReceipts(po(
      [item("a", 10)],
      [receipt("r1", [{ itemId: "a", qty: 6 }]), receipt("r2", [{ itemId: "a", qty: -3 }])],
    ));
    expect(s.lines[0]!.received).toBe(6);
  });

  it("ignores a receipt line for an item no longer on the order", () => {
    // Deleting an order line after a delivery was logged must not take the
    // rest of the report down with it.
    const s = summarizeReceipts(po([item("a", 10)], [receipt("r1", [
      { itemId: "a", qty: 10 }, { itemId: "gone", qty: 99 },
    ])]));
    expect(s.status).toBe("complete");
    expect(s.lines).toHaveLength(1);
  });

  it("copes with a receipt carrying no lines at all", () => {
    const s = summarizeReceipts(po([item("a", 10)], [{ id: "r1", date: "2026-08-20" }]));
    expect(s.hasReceipts).toBe(true);
    expect(s.status).toBe("none");
  });

  it("copes with an order that predates receipts entirely", () => {
    expect(summarizeReceipts({ items: [item("a", 10)] }).status).toBe("none");
    expect(summarizeReceipts({}).lineCount).toBe(0);
  });

  it("reads a quantity typed as a string, as the editor stores it", () => {
    const s = summarizeReceipts(po([item("a", "10")], [receipt("r1", [{ itemId: "a", qty: "10" }])]));
    expect(s.status).toBe("complete");
  });

  it("does not accumulate floating-point drift across deliveries", () => {
    const s = summarizeReceipts(po(
      [item("a", 0.3)],
      [receipt("r1", [{ itemId: "a", qty: 0.1 }]), receipt("r2", [{ itemId: "a", qty: 0.2 }])],
    ));
    expect(s.lines[0]!.received).toBe(0.3);
    expect(s.status).toBe("complete");
  });
});

describe("what to prefill on the next delivery", () => {
  it("offers only lines still owed", () => {
    const rows = outstandingLines(po(
      [item("a", 10), item("b", 5), item("c", 2)],
      [receipt("r1", [{ itemId: "a", qty: 10 }, { itemId: "b", qty: 2 }])],
    ));
    expect(rows.map((r) => r.item.id)).toEqual(["b", "c"]);
    expect(rows.map((r) => r.outstanding)).toEqual([3, 2]);
  });

  it("offers nothing once the order is complete", () => {
    const doc = po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 10 }])]);
    expect(outstandingLines(doc)).toEqual([]);
    expect(isFullyReceived(doc)).toBe(true);
  });
});

describe("the status receiving implies", () => {
  it("moves an issued order to Partially Received on a short delivery", () => {
    const doc = po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 4 }])]);
    expect(impliedStatus(doc, "Issued")).toBe("Partially Received");
  });

  it("moves it to Received once everything has arrived", () => {
    const doc = po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 10 }])]);
    expect(impliedStatus(doc, "Acknowledged")).toBe("Received");
  });

  it("says nothing when the status is already right", () => {
    const doc = po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 10 }])]);
    expect(impliedStatus(doc, "Received")).toBeNull();
  });

  it("never revives a cancelled order", () => {
    // Goods turning up against a cancelled order is a conversation, not a
    // reason for the CRM to un-cancel it.
    const doc = po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 10 }])]);
    expect(impliedStatus(doc, "Cancelled")).toBeNull();
  });

  it("leaves a draft alone — nothing was ordered yet", () => {
    const doc = po([item("a", 10)], [receipt("r1", [{ itemId: "a", qty: 10 }])]);
    expect(impliedStatus(doc, "Draft")).toBeNull();
  });

  it("says nothing when no delivery has been recorded", () => {
    expect(impliedStatus(po([item("a", 10)]), "Issued")).toBeNull();
  });
});

describe("labels", () => {
  it("has wording for every status the summary can produce", () => {
    for (const s of ["none", "partial", "complete", "over"] as const) {
      expect(receiptStatusLabel(s), s).toBeTruthy();
    }
  });
});
