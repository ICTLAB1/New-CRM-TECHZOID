import { describe, expect, it } from "vitest";
import { computeDocument } from "./compute";
import type { LineItem, TaxableDocument } from "./types";

const item = (o: Partial<LineItem>): LineItem => ({ id: "i", qty: 1, rate: 100, disc: 0, gst: 18, ...o });

const doc = (o: Partial<TaxableDocument>): TaxableDocument => ({
  items: [item({})],
  taxType: "gst",
  billState: "Delhi",
  ...o,
});

describe("tax regimes", () => {
  it("GST intra-state splits CGST + SGST", () => {
    const t = computeDocument(doc({ billState: "Delhi" }), "Delhi");
    expect(t.intra).toBe(true);
    expect(t.taxTotal).toBe(18);
    expect(t.cgst).toBe(9);
    expect(t.sgst).toBe(9);
    expect(t.grand).toBe(118);
  });

  it("GST inter-state uses IGST", () => {
    const t = computeDocument(doc({ billState: "Maharashtra" }), "Delhi");
    expect(t.intra).toBe(false);
    expect(t.igst).toBe(18);
    expect(t.grand).toBe(118);
  });

  it("a blank buyer state is treated as inter-state", () => {
    expect(computeDocument(doc({ billState: "" }), "Delhi").intra).toBe(false);
    expect(computeDocument(doc({ billState: null }), "Delhi").intra).toBe(false);
  });

  it("VAT and Sales Tax total the same as GST — only the label differs", () => {
    const gst = computeDocument(doc({ taxType: "gst" }), "Delhi");
    for (const taxType of ["vat", "sales_tax"] as const) {
      const t = computeDocument(doc({ taxType }), "Delhi");
      expect(t.taxTotal).toBe(gst.taxTotal);
      expect(t.grand).toBe(gst.grand);
    }
  });

  describe('taxType "none"', () => {
    it("zeroes tax on every row regardless of the per-item rate", () => {
      const t = computeDocument(
        doc({ taxType: "none", items: [item({ gst: 18 }), item({ gst: 28 }), item({ gst: 5 })] }),
        "Delhi",
      );
      expect(t.rows.map((r) => r.tax)).toEqual([0, 0, 0]);
      expect(t.taxTotal).toBe(0);
      expect(t.cgst).toBe(0);
      expect(t.sgst).toBe(0);
      expect(t.igst).toBe(0);
      expect(t.grand).toBe(300);
    });

    it("still reports taxable value, so the document can print a net total", () => {
      const t = computeDocument(doc({ taxType: "none" }), "Delhi");
      expect(t.taxable).toBe(100);
    });
  });

  it("an unknown taxType is taxed, not silently exempted", () => {
    const t = computeDocument(doc({ taxType: "something-new" }), "Delhi");
    expect(t.taxTotal).toBe(18);
  });

  it("a missing taxType (legacy record) is taxed", () => {
    const t = computeDocument(doc({ taxType: null }), "Delhi");
    expect(t.taxTotal).toBe(18);
  });
});

describe("discounts", () => {
  it("apply before tax", () => {
    const t = computeDocument(doc({ items: [item({ qty: 2, rate: 500, disc: 10, gst: 18 })] }), "Delhi");
    expect(t.gross).toBe(1000);
    expect(t.discount).toBe(100);
    expect(t.taxable).toBe(900);
    expect(t.taxTotal).toBe(162);
    expect(t.grand).toBe(1062);
  });

  it("a 100% discount leaves nothing taxable", () => {
    const t = computeDocument(doc({ items: [item({ disc: 100 })] }), "Delhi");
    expect(t.taxable).toBe(0);
    expect(t.taxTotal).toBe(0);
    expect(t.grand).toBe(0);
  });
});

describe("round-off", () => {
  const items = [item({ qty: 3, rate: 333.33, disc: 0, gst: 18 })];

  it("is off by default", () => {
    const t = computeDocument(doc({ items }), "Delhi");
    expect(t.grand).toBe(1179.99);
    expect(t.roundDiff).toBe(0);
  });

  it("rounds to the nearest unit and reports the difference when enabled", () => {
    const t = computeDocument(doc({ items, roundOff: true }), "Delhi");
    expect(t.grand).toBe(1180);
    expect(t.roundDiff).toBe(0.01);
  });
});

describe("slabs", () => {
  it("groups taxable value and tax by rate", () => {
    const t = computeDocument(
      doc({ items: [item({ gst: 18 }), item({ gst: 18 }), item({ gst: 5, rate: 200 })] }),
      "Delhi",
    );
    expect(t.slabs[18]).toEqual({ taxable: 200, tax: 36 });
    expect(t.slabs[5]).toEqual({ taxable: 200, tax: 10 });
  });
});

describe("legacy and malformed rows", () => {
  it("survives an empty document", () => {
    const t = computeDocument({}, "Delhi");
    expect(t.grand).toBe(0);
    expect(t.rows).toEqual([]);
  });

  it("survives items missing every numeric field", () => {
    const t = computeDocument({ items: [{ id: "x" }], taxType: "gst" }, "Delhi");
    expect(t.grand).toBe(0);
  });

  it("reads numeric strings, as they arrive from form inputs", () => {
    const t = computeDocument(
      { items: [{ id: "x", qty: "2", rate: "150.50", disc: "10", gst: "18" }], taxType: "gst" },
      "Delhi",
    );
    expect(t.gross).toBe(301);
    expect(t.discount).toBe(30.1);
    expect(t.taxable).toBe(270.9);
    expect(t.grand).toBe(319.66);
  });
});
