import { describe, expect, it } from "vitest";
import { THIN_MARGIN_PERCENT, documentMargin, lineMargin, lineRevenue, marginNote, marginTone } from "./margin";
import { bestPrice, effectiveCost, isExpired, readVendorPrices, vendorsInCatalog, withEffectiveCost } from "../catalog/vendors";
import type { CatalogProduct } from "../catalog/types";

const TODAY = "2026-08-27";

describe("what a line earns", () => {
  it("counts revenue after discount, before tax", () => {
    // Margin is not earned on tax — that money is the government's.
    expect(lineRevenue({ qty: 2, rate: 1000, disc: 10 })).toBe(1800);
  });

  it("multiplies cost by quantity, because cost is per unit", () => {
    const m = lineMargin({ qty: 3, rate: 1000, disc: 0, cost: 700 });
    expect(m).toMatchObject({ revenue: 3000, cost: 2100, amount: 900 });
    expect(m.percent).toBeCloseTo(30);
  });

  it("reports a line priced below cost as a loss, not as zero", () => {
    const m = lineMargin({ qty: 1, rate: 500, disc: 0, cost: 800 });
    expect(m.amount).toBe(-300);
    expect(m.percent).toBeCloseTo(-60);
  });

  it("treats a line with no cost as UNKNOWN, not as free", () => {
    // Averaging it in as zero cost would report 100% margin on a line
    // nobody has costed.
    const m = lineMargin({ qty: 1, rate: 1000, disc: 0 });
    expect(m.known).toBe(false);
    expect(m.percent).toBeNull();
    expect(m.amount).toBe(0);
    expect(lineMargin({ qty: 1, rate: 1000, cost: "" }).known).toBe(false);
    // Zero IS a cost, and a real one — free stock still has a margin.
    expect(lineMargin({ qty: 1, rate: 1000, cost: 0 }).known).toBe(true);
  });
});

describe("the whole document", () => {
  it("adds up only the lines it can", () => {
    const m = documentMargin([
      { qty: 1, rate: 1000, cost: 600 },
      { qty: 1, rate: 2000, cost: 1500 },
      { qty: 1, rate: 5000 },            // uncosted
    ]);
    expect(m.revenue).toBe(3000);
    expect(m.cost).toBe(2100);
    expect(m.amount).toBe(900);
    expect(m.costedLines).toBe(2);
    expect(m.totalLines).toBe(3);
    expect(m.percent).toBeCloseTo(30);
  });

  it("says out loud what it is not counting", () => {
    const m = documentMargin([{ qty: 1, rate: 1000, cost: 600 }, { qty: 1, rate: 5000 }]);
    expect(marginNote(m)).toContain("1 line carries no cost");
  });

  it("knows nothing when nothing is costed", () => {
    const m = documentMargin([{ qty: 1, rate: 1000 }]);
    expect(m.known).toBe(false);
    expect(marginTone(m)).toBe("neutral");
    // "0%" where the answer is "nobody entered a cost" is a false statement.
    expect(marginNote(m)).toContain("no margin to show");
  });

  it("flags a document with a below-cost line even when the total is healthy", () => {
    // The loss-leader hidden inside a profitable quote is exactly what a
    // single total percentage conceals.
    const m = documentMargin([{ qty: 1, rate: 10000, cost: 5000 }, { qty: 1, rate: 100, cost: 400 }]);
    expect(m.amount).toBeGreaterThan(0);
    expect(m.anyBelowCost).toBe(true);
    expect(marginTone(m)).toBe("bad");
    expect(marginNote(m)).toContain("below what it cost");
  });

  it("warns on a thin margin", () => {
    const m = documentMargin([{ qty: 1, rate: 1000, cost: 970 }]);
    expect(m.percent).toBeCloseTo(3);
    expect(m.percent!).toBeLessThan(THIN_MARGIN_PERCENT);
    expect(marginTone(m)).toBe("warn");
  });

  it("is quiet about an empty document", () => {
    expect(marginNote(documentMargin([]))).toContain("Nothing quoted");
  });
});

/* ── vendor price lists ── */

const product = (o: Partial<CatalogProduct>): CatalogProduct => ({
  id: "p1", name: "Adobe CC", publisher: "Adobe", licenseType: "", productId: "", skuId: "",
  termDuration: "", billingPlan: "", segment: "", costPrice: 0, sellPrice: 0, hsn: "", unit: "Nos",
  active: true, createdAt: 0, updatedAt: 0, ...o,
});

const price = (o: Partial<import("../catalog/vendors").VendorPrice>) =>
  ({ id: "v", vendor: "Ingram", cost: 100, currency: "INR", validUntil: "", note: "", ...o });

describe("what a product costs, from whom", () => {
  it("takes the cheapest price that is still live", () => {
    const p = product({ vendorPrices: [
      price({ id: "a", vendor: "Ingram", cost: 900 }),
      price({ id: "b", vendor: "Redington", cost: 850 }),
    ] });
    expect(bestPrice(readVendorPrices(p), TODAY)?.vendor).toBe("Redington");
    expect(effectiveCost(p, TODAY)).toMatchObject({ cost: 850, source: "Redington", expired: false });
  });

  it("SKIPS an expired price, however cheap", () => {
    // That is the entire point of recording the date. Quoting off a lapsed
    // price is how a deal is won at a loss.
    const p = product({ vendorPrices: [
      price({ id: "a", vendor: "Ingram", cost: 900 }),
      price({ id: "b", vendor: "Cheap but lapsed", cost: 100, validUntil: "2026-08-26" }),
    ] });
    expect(effectiveCost(p, TODAY).cost).toBe(900);
    expect(isExpired({ validUntil: "2026-08-26" }, TODAY)).toBe(true);
    // Today is still valid — a price list runs to the end of its last day.
    expect(isExpired({ validUntil: TODAY }, TODAY)).toBe(false);
    // No date means a standing price, which is ordinary.
    expect(isExpired({ validUntil: "" }, TODAY)).toBe(false);
  });

  it("falls back to the catalog cost, and says when it is stale", () => {
    const lapsed = product({ costPrice: 700, vendorPrices: [price({ cost: 500, validUntil: "2020-01-01" })] });
    expect(effectiveCost(lapsed, TODAY)).toMatchObject({ cost: 700, source: "an expired price list", expired: true });

    const plain = product({ costPrice: 700 });
    expect(effectiveCost(plain, TODAY)).toMatchObject({ cost: 700, source: "the catalog", expired: false });
  });

  it("ignores a vendor row with no price in it", () => {
    const p = product({ costPrice: 700, vendorPrices: [price({ cost: 0 })] });
    expect(effectiveCost(p, TODAY)).toMatchObject({ cost: 700, source: "the catalog" });
  });

  it("keeps costPrice level with the best live price, so old screens agree", () => {
    const p = product({ costPrice: 999, vendorPrices: [price({ cost: 850 })] });
    expect(withEffectiveCost(p, TODAY).costPrice).toBe(850);
    // Nothing live: leave the existing figure alone rather than zero it.
    const none = product({ costPrice: 999 });
    expect(withEffectiveCost(none, TODAY).costPrice).toBe(999);
  });

  it("lists every distributor in the catalog, once, sorted", () => {
    const list = vendorsInCatalog([
      product({ id: "a", vendorPrices: [price({ vendor: "Redington" }), price({ vendor: "Ingram" })] }),
      product({ id: "b", vendorPrices: [price({ vendor: "Ingram" }), price({ vendor: "  " })] }),
      product({ id: "c" }),
    ]);
    expect(list).toEqual(["Ingram", "Redington"]);
  });
});
