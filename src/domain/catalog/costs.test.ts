import { describe, expect, it } from "vitest";
import { hasCost, mergeCosts, splitCosts, type CostMap } from "./costs";
import type { CatalogProduct } from "./types";

const product = (over: Partial<CatalogProduct>): CatalogProduct => ({
  id: "p1", name: "Microsoft 365 E3", publisher: "Microsoft", licenseType: "CSP",
  productId: "CFQ7TTC0LF8R", skuId: "0001", termDuration: "P1Y", billingPlan: "Annual",
  segment: "Commercial", costPrice: 0, sellPrice: 2400, hsn: "997331", unit: "License",
  active: true, createdAt: 1, updatedAt: 1, ...over,
});

const vendor = (cost: number) => ({
  id: "vp1", vendor: "Ingram", cost, currency: "INR", validUntil: "2026-12-31", note: "list",
});

describe("taking the buying price out of the catalog", () => {
  it("moves the cost into the map and leaves a zero behind", () => {
    const { catalog, costs } = splitCosts([product({ costPrice: 1826.4 })]);
    expect(costs.p1!).toEqual({ cost: 1826.4, vendorPrices: [] });
    expect(catalog[0]!.costPrice).toBe(0);
  });

  it("zeroes the cost rather than deleting the key", () => {
    // Every build in the field reads product.costPrice and renders it. A
    // missing number is NaN on somebody's screen, and a deploy is not
    // instant, so the key has to survive the move.
    const { catalog } = splitCosts([product({ costPrice: 1826.4 })]);
    expect("costPrice" in catalog[0]!).toBe(true);
  });

  it("takes the vendor list with it", () => {
    const { catalog, costs } = splitCosts([
      product({ costPrice: 1826.4, vendorPrices: [vendor(1826.4), vendor(1850)] }),
    ]);
    expect(costs.p1!.vendorPrices).toHaveLength(2);
    expect(catalog[0]!.vendorPrices).toBeUndefined();
    expect("vendorPrices" in catalog[0]!).toBe(false);
  });

  it("writes no cost row for a product that has no cost", () => {
    // Not tidiness. A row of zeros cannot be told apart from a real zero,
    // and once written it would overwrite the figure a privileged user
    // still had in hand.
    const { costs } = splitCosts([product({ id: "free", costPrice: 0 })]);
    expect(costs).toEqual({});
  });

  it("writes a row for a product priced only through a vendor", () => {
    const { costs } = splitCosts([product({ costPrice: 0, vendorPrices: [vendor(1826.4)] })]);
    expect(costs.p1!).toEqual({ cost: 0, vendorPrices: [vendor(1826.4)] });
  });

  it("keeps a product with no id out of the map, and in the catalog", () => {
    // A bad import can produce one. There is nothing to key a cost row on,
    // but the product itself is still somebody's data.
    const { catalog, costs } = splitCosts([product({ id: "", costPrice: 99 })]);
    expect(costs).toEqual({});
    expect(catalog).toHaveLength(1);
  });

  it("changes nothing else about the product", () => {
    const one = product({ costPrice: 1826.4, sellPrice: 2400, hsn: "997331", active: false });
    const { catalog } = splitCosts([one]);
    expect(catalog[0]!).toEqual({ ...one, costPrice: 0, vendorPrices: undefined });
  });

  it("keeps the catalog in order", () => {
    const { catalog } = splitCosts([
      product({ id: "a", costPrice: 1 }), product({ id: "b" }), product({ id: "c", costPrice: 3 }),
    ]);
    expect(catalog.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("reads a cost the database handed back as a string", () => {
    // numeric(14,4) arrives as a string over some drivers, and 'NaN' from a
    // column somebody has fed rubbish into.
    const costs = { p1: { cost: "1826.4000" as unknown as number, vendorPrices: [] } };
    const [merged] = mergeCosts([product({})], costs as CostMap);
    expect(merged!.costPrice).toBe(1826.4);

    const [bad] = mergeCosts([product({})], { p1: { cost: Number("x"), vendorPrices: [] } });
    expect(bad!.costPrice).toBe(0);
  });
});

describe("putting it back for whoever is allowed it", () => {
  it("fills the cost and the vendor list from the map", () => {
    const [merged] = mergeCosts([product({})], { p1: { cost: 1826.4, vendorPrices: [vendor(1826.4)] } });
    expect(merged!.costPrice).toBe(1826.4);
    expect(merged!.vendorPrices).toEqual([vendor(1826.4)]);
  });

  it("hands the catalog straight back when the map is empty", () => {
    // This is the salesperson's case: row-level security returns them no
    // rows, so there is nothing to merge. The catalog must come back whole,
    // not blanked — and as the SAME array, or every screen below gets a new
    // catalog on each render.
    const base = [product({}), product({ id: "p2" })];
    const merged = mergeCosts(base, {});
    expect(merged).toBe(base);
  });

  it("leaves a product the map says nothing about alone", () => {
    const merged = mergeCosts([product({ id: "p1" }), product({ id: "p2", costPrice: 500 })], {
      p1: { cost: 1826.4, vendorPrices: [] },
    });
    expect(merged[0]!.costPrice).toBe(1826.4);
    expect(merged[1]!.costPrice).toBe(500);
  });

  it("survives a round trip without changing a figure", () => {
    const before = [
      product({ id: "p1", costPrice: 1826.4, vendorPrices: [vendor(1826.4), vendor(1850)] }),
      product({ id: "p2", costPrice: 940.5 }),
      product({ id: "p3", costPrice: 0 }),
    ];
    const { catalog, costs } = splitCosts(before);
    const after = mergeCosts(catalog, costs);
    expect(after.map((p) => ({ id: p.id, cost: p.costPrice, vendors: p.vendorPrices?.length ?? 0 })))
      .toEqual([
        { id: "p1", cost: 1826.4, vendors: 2 },
        { id: "p2", cost: 940.5, vendors: 0 },
        { id: "p3", cost: 0, vendors: 0 },
      ]);
  });
});

describe("whether there is anything to protect", () => {
  it("counts a cost, a vendor price, and neither", () => {
    expect(hasCost({ cost: 1, vendorPrices: [] })).toBe(true);
    expect(hasCost({ cost: 0, vendorPrices: [vendor(1)] })).toBe(true);
    expect(hasCost({ cost: 0, vendorPrices: [] })).toBe(false);
  });
});
