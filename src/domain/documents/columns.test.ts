import { describe, expect, it } from "vitest";
import { buildItemColumns, CONTENT_WIDTH_MM, MEASURED_TABLE_WIDTH_MM, naturalWidth } from "./columns";
import { computeDocument } from "../tax/compute";
import type { ComputedRow } from "../tax/types";

const build = (o: Partial<Parameters<typeof buildItemColumns>[0]> = {}) =>
  buildItemColumns({ currency: "INR", taxType: "gst", columns: {}, ...o });

const natural = (o: Partial<Parameters<typeof buildItemColumns>[0]> = {}) =>
  buildItemColumns({ currency: "INR", taxType: "gst", columns: {}, ...o, tableWidthMm: null });

describe("the approved nine columns", () => {
  it("is exactly the design's column set, in order", () => {
    expect(build().map((c) => c.key)).toEqual([
      "num", "desc", "brand", "sku", "qty", "unit", "rate", "disc", "taxable",
    ]);
  });

  it("totals exactly the 184mm content width", () => {
    expect(naturalWidth(natural())).toBe(MEASURED_TABLE_WIDTH_MM);
    expect(MEASURED_TABLE_WIDTH_MM).toBe(CONTENT_WIDTH_MM);
  });

  it("carries no per-row tax column — tax lives in the summary block only", () => {
    // A per-row tax column would state the same thing twice and cost the
    // description its width.
    const keys = build().map((c) => c.key);
    expect(keys).not.toContain("gst");
    expect(keys).not.toContain("gstamt");
    expect(keys).not.toContain("hsn");
  });

  it("keeps all nine columns for an exempt document", () => {
    // Nothing in this table depends on the tax regime.
    expect(build({ taxType: "none" })).toHaveLength(9);
    expect(naturalWidth(build({ taxType: "none" }))).toBeCloseTo(CONTENT_WIDTH_MM, 6);
  });
});

describe("measured metrics (golden)", () => {
  /* Width, type size and padding only work as a SET. A narrow column at
     default padding wraps mid-number. Changing any value here means
     re-measuring in a rendered PDF image, not adjusting until a test passes. */
  const GOLDEN: Record<string, { w: number; fontSize: number; pad: string; mono: boolean }> = {
    num:     { w: 11, fontSize: 6.6, pad: "default", mono: false },
    desc:    { w: 48, fontSize: 6.6, pad: "default", mono: false },
    brand:   { w: 17, fontSize: 6.3, pad: "tight",   mono: false },
    sku:     { w: 22, fontSize: 5.4, pad: "tight",   mono: true },
    qty:     { w: 12, fontSize: 6.6, pad: "tight",   mono: false },
    unit:    { w: 12, fontSize: 6.2, pad: "tight",   mono: false },
    rate:    { w: 20, fontSize: 5.9, pad: "money",   mono: true },
    disc:    { w: 20, fontSize: 5.9, pad: "money",   mono: true },
    taxable: { w: 22, fontSize: 5.9, pad: "money",   mono: true },
  };

  it("matches the measured values for every column", () => {
    const cols = natural();
    expect(cols.map((c) => c.key)).toEqual(Object.keys(GOLDEN));
    for (const col of cols) {
      expect({ w: col.w, fontSize: col.fontSize, pad: col.pad, mono: col.mono }, col.key)
        .toEqual(GOLDEN[col.key]);
    }
  });

  it("gives money columns money padding, never default", () => {
    for (const key of ["rate", "disc", "taxable"] as const) {
      expect(natural().find((c) => c.key === key)!.pad, key).toBe("money");
    }
  });
});

describe("money cells", () => {
  const totals = computeDocument(
    { items: [{ id: "1", desc: "Item", qty: 25, rate: 18900, disc: 25, gst: 18 }], taxType: "gst" },
    "Delhi",
  );
  const row = totals.rows[0] as ComputedRow;

  it("names the currency in the header, once", () => {
    const cols = build({ currency: "USD" });
    expect(cols.find((c) => c.key === "rate")!.head).toBe("UNIT PRICE\n(USD)");
    expect(cols.find((c) => c.key === "taxable")!.head).toBe("TAXABLE VALUE\n(USD)");
  });

  it("carries a bare number in the cell — never a currency prefix", () => {
    for (const key of ["rate", "disc", "taxable"] as const) {
      for (const currency of ["INR", "USD", "KWD", "JPY", "PKR"]) {
        const col = build({ currency }).find((c) => c.key === key)!;
        expect(col.get(row, 0), `${key}/${currency}`).toMatch(/^-?[0-9,.]+$/);
      }
    }
  });

  it("groups INR in lakhs and crores, as the approved design renders it", () => {
    const cell = (key: string) => build().find((c) => c.key === key)!.get(row, 0);
    expect(cell("rate")).toBe("18,900.00");
    expect(cell("disc")).toBe("1,18,125.00");
    expect(cell("taxable")).toBe("3,54,375.00");
  });

  it("shows the discount as an amount, not a percentage", () => {
    // The design's column is "DISCOUNT (INR)" — a rupee figure, not "25%".
    expect(build().find((c) => c.key === "disc")!.get(row, 0)).not.toContain("%");
  });

  it("shows each row's taxable value, which the summary then totals", () => {
    expect(build().find((c) => c.key === "taxable")!.get(row, 0)).toBe("3,54,375.00");
  });

  it("respects each currency's decimal places", () => {
    const cell = (currency: string) => build({ currency }).find((c) => c.key === "rate")!.get(row, 0);
    expect(cell("JPY")).toBe("18,900");
    expect(cell("KWD")).toBe("18,900.000");
  });
});

describe("cell content", () => {
  const totals = computeDocument(
    { items: [{ id: "1", qty: 3, rate: 100, disc: 0, gst: 18, unit: "License" }], taxType: "gst" },
    "Delhi",
  );
  const row = totals.rows[0] as ComputedRow;

  it("falls back to an em dash for a missing description", () => {
    expect(build().find((c) => c.key === "desc")!.get(row, 0)).toBe("—");
  });

  it("numbers rows from 1", () => {
    expect(build().find((c) => c.key === "num")!.get(row, 0)).toBe("1");
    expect(build().find((c) => c.key === "num")!.get(row, 49)).toBe("50");
  });

  it("renders empty strings, not 'undefined', for absent optional fields", () => {
    for (const col of build()) {
      expect(col.get(row, 0), col.key).not.toContain("undefined");
    }
  });
});
