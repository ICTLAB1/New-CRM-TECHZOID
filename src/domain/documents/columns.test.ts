import { describe, expect, it } from "vitest";
import { buildItemColumns, CONTENT_WIDTH_MM, MEASURED_TABLE_WIDTH_MM, naturalWidth } from "./columns";
import { computeDocument } from "../tax/compute";
import type { ComputedRow } from "../tax/types";

const ALL = { subDesc: true, brand: true, sku: true, hsn: true };
const build = (o: Partial<Parameters<typeof buildItemColumns>[0]> = {}) =>
  buildItemColumns({ currency: "INR", taxType: "gst", columns: ALL, ...o });

/** The measured widths, with no absorb/shrink applied. */
const natural = (o: Partial<Parameters<typeof buildItemColumns>[0]> = {}) =>
  buildItemColumns({ currency: "INR", taxType: "gst", columns: ALL, ...o, tableWidthMm: null });

describe("measured widths", () => {
  it("every column shown totals exactly 180mm before fitting", () => {
    // The figure the widths were measured to. If this changes, they were not
    // re-measured against worst-case content in a rendered image.
    expect(naturalWidth(natural())).toBe(MEASURED_TABLE_WIDTH_MM);
  });

  it("fills the full content width once fitted", () => {
    expect(naturalWidth(build())).toBeCloseTo(CONTENT_WIDTH_MM, 6);
  });

  it("has 13 columns with everything on", () => {
    expect(build()).toHaveLength(13);
  });
});

describe("hidden columns", () => {
  it("the description column absorbs the freed width", () => {
    const all = build();
    const some = build({ columns: { subDesc: false, brand: false, sku: false, hsn: false } });
    const descAll = all.find((c) => c.key === "desc")!.w;
    const descSome = some.find((c) => c.key === "desc")!.w;
    expect(descSome).toBeGreaterThan(descAll);
    // No dead gap on the right, whatever is hidden.
    expect(naturalWidth(some)).toBeCloseTo(CONTENT_WIDTH_MM, 6);
  });

  it.each([
    ["subDesc"], ["brand"], ["sku"], ["hsn"],
  ])("still fills the width with %s hidden", (key) => {
    const cols = build({ columns: { ...ALL, [key]: false } });
    expect(cols.some((c) => c.key === key)).toBe(false);
    expect(naturalWidth(cols)).toBeCloseTo(CONTENT_WIDTH_MM, 6);
  });

  it("absent toggles mean visible, so an older settings row loses nothing", () => {
    expect(build({ columns: {} })).toHaveLength(13);
  });

  it("never shrinks a numeric column when the table is narrowed", () => {
    const wide = build();
    const narrow = build({ tableWidthMm: 120 });
    for (const key of ["rate", "gstamt", "total", "qty", "disc", "gst", "num", "unit"] as const) {
      expect(narrow.find((c) => c.key === key)!.w, key).toBe(wide.find((c) => c.key === key)!.w);
    }
  });

  it("takes a shortfall out of the text columns, down to a floor", () => {
    const narrow = build({ tableWidthMm: 120 });
    expect(narrow.find((c) => c.key === "desc")!.w).toBeGreaterThanOrEqual(12);
    expect(narrow.find((c) => c.key === "subDesc")!.w).toBeGreaterThanOrEqual(12);
  });
});

describe("tax columns", () => {
  it("are dropped entirely for a no-tax document", () => {
    const cols = build({ taxType: "none" });
    expect(cols.some((c) => c.key === "gst")).toBe(false);
    expect(cols.some((c) => c.key === "gstamt")).toBe(false);
    // and the description absorbs their width — no gap.
    expect(naturalWidth(cols)).toBeCloseTo(CONTENT_WIDTH_MM, 6);
  });

  it("name the regime in the amount header", () => {
    expect(build({ taxType: "gst" }).find((c) => c.key === "gstamt")!.head).toContain("GST Amount");
    expect(build({ taxType: "vat" }).find((c) => c.key === "gstamt")!.head).toContain("VAT Amount");
    expect(build({ taxType: "sales_tax" }).find((c) => c.key === "gstamt")!.head).toContain("Sales Tax Amount");
  });
});

describe("money cells", () => {
  const totals = computeDocument(
    { items: [{ id: "1", desc: "Item", qty: 2, rate: 376656, disc: 0, gst: 18 }], taxType: "gst" },
    "Delhi",
  );
  const row = totals.rows[0] as ComputedRow;

  it("name the currency in the header, once", () => {
    const cols = build({ currency: "USD" });
    expect(cols.find((c) => c.key === "rate")!.head).toBe("Unit Price\n(USD)");
    expect(cols.find((c) => c.key === "total")!.head).toBe("Total\n(USD)");
  });

  it("carry a bare number in the cell — never a currency prefix", () => {
    // "Rs. 376,6 / 56.00" is what adding the prefix back looked like.
    for (const key of ["rate", "gstamt", "total"] as const) {
      for (const currency of ["INR", "USD", "KWD", "JPY", "PKR"]) {
        const col = build({ currency }).find((c) => c.key === key)!;
        expect(col.get(row, 0), `${key}/${currency}`).toMatch(/^-?[0-9,.]+$/);
      }
    }
  });

  it("respects each currency's decimal places", () => {
    const cell = (currency: string) => build({ currency }).find((c) => c.key === "rate")!.get(row, 0);
    expect(cell("INR")).toBe("376,656.00");
    expect(cell("JPY")).toBe("376,656");
    expect(cell("KWD")).toBe("376,656.000");
  });

  it("is monospaced and right-aligned so figures line up down the column", () => {
    for (const key of ["rate", "gstamt", "total"] as const) {
      const col = build().find((c) => c.key === key)!;
      expect(col.mono).toBe(true);
      expect(col.align).toBe("right");
    }
  });
});

describe("cell content", () => {
  const totals = computeDocument(
    { items: [{ id: "1", qty: 3, rate: 100, disc: 12.5, gst: 18, unit: "License" }], taxType: "gst" },
    "Delhi",
  );
  const row = totals.rows[0] as ComputedRow;

  it("falls back to an em dash for a missing description", () => {
    expect(build().find((c) => c.key === "desc")!.get(row, 0)).toBe("—");
  });

  it("numbers rows from 1", () => {
    expect(build().find((c) => c.key === "num")!.get(row, 0)).toBe("1");
    expect(build().find((c) => c.key === "num")!.get(row, 41)).toBe("42");
  });

  it("shows discount to two decimals and tax as a percentage", () => {
    expect(build().find((c) => c.key === "disc")!.get(row, 0)).toBe("12.50");
    expect(build().find((c) => c.key === "gst")!.get(row, 0)).toBe("18%");
  });

  it("renders empty strings, not 'undefined', for absent optional fields", () => {
    for (const col of build()) {
      expect(col.get(row, 0), col.key).not.toContain("undefined");
    }
  });
});

describe("measured metrics (golden)", () => {
  /* Width, type size and padding only work as a SET. A narrow column at
     default padding wraps mid-number — "12.0 / 0" in Disc. and "18 / %" in
     Tax %, which is how this table was found to have drifted from v1.
     Changing any value here means re-measuring in a rendered PDF image
     (scripts/compare-v1-pdf.mjs), not adjusting until a test passes. */
  const GOLDEN: Record<string, { w: number; fontSize: number; pad: string; mono: boolean }> = {
    num:    { w: 9,  fontSize: 6.6, pad: "default", mono: false },
    desc:   { w: 27, fontSize: 6.6, pad: "default", mono: false },
    subDesc:{ w: 20, fontSize: 6.3, pad: "default", mono: false },
    brand:  { w: 12, fontSize: 6.3, pad: "tight",   mono: false },
    sku:    { w: 14, fontSize: 4.7, pad: "tight",   mono: true },
    hsn:    { w: 11, fontSize: 5.8, pad: "tight",   mono: true },
    qty:    { w: 8,  fontSize: 6.6, pad: "default", mono: false },
    unit:   { w: 9,  fontSize: 6.2, pad: "tight",   mono: false },
    rate:   { w: 18, fontSize: 5.9, pad: "money",   mono: true },
    disc:   { w: 8,  fontSize: 6.6, pad: "tight",   mono: false },
    gst:    { w: 7,  fontSize: 6.6, pad: "tight",   mono: false },
    gstamt: { w: 18, fontSize: 5.9, pad: "money",   mono: true },
    total:  { w: 19, fontSize: 5.9, pad: "money",   mono: true },
  };

  it("matches the measured values for every column", () => {
    const cols = natural();
    expect(cols.map((c) => c.key)).toEqual(Object.keys(GOLDEN));
    for (const col of cols) {
      expect({ w: col.w, fontSize: col.fontSize, pad: col.pad, mono: col.mono }, col.key)
        .toEqual(GOLDEN[col.key]);
    }
  });

  it("gives the narrow numeric columns tight padding", () => {
    // Default padding costs ~1.6mm of content width, which these cannot spare.
    for (const key of ["disc", "gst", "unit", "hsn", "sku", "brand"] as const) {
      expect(natural().find((c) => c.key === key)!.pad, key).toBe("tight");
    }
  });

  it("gives money columns money padding, never default", () => {
    for (const key of ["rate", "gstamt", "total"] as const) {
      expect(natural().find((c) => c.key === key)!.pad, key).toBe("money");
    }
  });
});
