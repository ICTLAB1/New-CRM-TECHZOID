import { describe, expect, it } from "vitest";
import { toCostedHit, toHit, toListRow, toMarginRule } from "./priceBook";

describe("what the browser keeps from a price book row", () => {
  it("renames the columns and nothing more", () => {
    const hit = toHit({
      item_id: "i1", oem: "Microsoft", sku: "M365-E3", product_name: "Microsoft 365 E3",
      category: "Cloud", licence_type: "1 Year", unit: "User", currency: "INR",
      min_price: 1150, period: "2026-11",
    });
    expect(hit).toEqual({
      itemId: "i1", oem: "Microsoft", sku: "M365-E3", productName: "Microsoft 365 E3",
      category: "Cloud", licenceType: "1 Year", unit: "User", currency: "INR",
      minPrice: 1150, period: "2026-11",
    });
  });

  it("DROPS A COST COLUMN IF ONE EVER ARRIVES", () => {
    // price_book_search has no cost column in its return type, so this
    // cannot happen today. It is asserted anyway: the day somebody adds one
    // — to that function or to a new one wired through this mapper — the
    // browser must not quietly start carrying it around in memory where a
    // console, a crash report or a screenshot would find it.
    const hit = toHit({
      item_id: "i1", sku: "X", product_name: "X", min_price: 100, currency: "INR", period: "2026-11",
      reseller_price: 1000, buying_price: 965, min_margin_pct: 15, distributor_discount_pct: 3.5,
    }) as unknown as Record<string, unknown>;
    expect(Object.keys(hit).sort()).toEqual([
      "category", "currency", "itemId", "licenceType", "minPrice", "oem", "period",
      "productName", "sku", "unit",
    ]);
    expect(hit.resellerPrice).toBeUndefined();
    expect(hit.buyingPrice).toBeUndefined();
    expect(hit.minMarginPct).toBeUndefined();
  });

  it("carries the cost picture only through the costed mapper", () => {
    const costed = toCostedHit({
      item_id: "i1", sku: "X", product_name: "X", min_price: 1150, currency: "INR", period: "2026-11",
      reseller_price: 1000, buying_price: 965, min_margin_pct: 15,
    });
    expect(costed).toMatchObject({ resellerPrice: 1000, buyingPrice: 965, minMarginPct: 15, minPrice: 1150 });
  });

  it("treats an empty optional column as absent, not as an empty string", () => {
    const hit = toHit({ item_id: "i", sku: "X", product_name: "X", category: "   ", licence_type: null, min_price: 1 });
    expect(hit.category).toBeNull();
    expect(hit.licenceType).toBeNull();
    expect(hit.currency).toBe("INR");
  });

  it("reads a numeric that arrived as a string anyway", () => {
    // db.mjs parses numerics to numbers, but the Supabase path does not
    // always, and a price that is a string compares by character.
    const hit = toHit({ item_id: "i", sku: "X", product_name: "X", min_price: "1150.50" });
    expect(hit.minPrice).toBe(1150.5);
    expect(typeof hit.minPrice).toBe("number");
  });
});

describe("a price list row", () => {
  it("keeps only the three states there are", () => {
    expect(toListRow({ status: "active" }).status).toBe("active");
    expect(toListRow({ status: "archived" }).status).toBe("archived");
    expect(toListRow({ status: "draft" }).status).toBe("draft");
    // Anything else is a draft: an unknown state must not read as live.
    expect(toListRow({ status: "live" }).status).toBe("draft");
    expect(toListRow({}).status).toBe("draft");
  });
});

describe("a margin rule", () => {
  it("keeps the company-wide default distinguishable from an OEM's", () => {
    expect(toMarginRule({ oem: "*", min_margin_pct: 5 })).toMatchObject({ oem: "*", category: null, sku: null, minMarginPct: 5 });
    expect(toMarginRule({ oem: "Microsoft", category: "Cloud", min_margin_pct: 15 }))
      .toMatchObject({ oem: "Microsoft", category: "Cloud", sku: null });
  });
});
