import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPANY_DEFAULT_OEM,
  ORDINARY_DISTRIBUTOR_DISCOUNT_MAX,
  buyingPrice,
  compareLists,
  isBelowMinimum,
  isQuoteExpired,
  isUnusualDistributorDiscount,
  linesNeedingApproval,
  marginReadings,
  minSellingPrice,
  periodEnd,
  periodOf,
  quoteExpiry,
  resolveMinMarginPct,
  type MarginRule,
} from "./pricing";

/* The rules the test database is loaded with in
   supabase/proofs/056_price_book_proof.sql. Kept identical on purpose: the
   proof asserts these produce 1150 / 2400 / 550 / 840 inside Postgres, and
   the first block below asserts the same of this file. If the two ever
   disagree, the editor is holding a salesperson to a floor the server does
   not know about. */
const RULES: MarginRule[] = [
  { oem: COMPANY_DEFAULT_OEM, minMarginPct: 5 },
  { oem: "Microsoft", minMarginPct: 10 },
  { oem: "Microsoft", category: "Cloud", minMarginPct: 15 },
  { oem: "Microsoft", category: "Cloud", sku: "M365-E5", minMarginPct: 20 },
];

describe("the minimum selling price, as the database computes it", () => {
  it("agrees with the SQL proof's four products to the paisa", () => {
    const floor = (item: { oem: string; sku: string; category?: string }, reseller: number) =>
      minSellingPrice(reseller, resolveMinMarginPct(RULES, item));

    // Category rule, 15%.
    expect(floor({ oem: "Microsoft", sku: "M365-E3", category: "Cloud" }, 1000)).toBe(1150);
    // SKU rule, 20% — beats the category it sits in.
    expect(floor({ oem: "Microsoft", sku: "M365-E5", category: "Cloud" }, 2000)).toBe(2400);
    // OEM rule, 10% — the Cloud rules do not reach a Desktop product.
    expect(floor({ oem: "Microsoft", sku: "VISIO-P2", category: "Desktop" }, 500)).toBe(550);
    // No Adobe rule at all, so the company default, 5%.
    expect(floor({ oem: "Adobe", sku: "ACROBAT", category: "Desktop" }, 800)).toBe(840);
  });

  it("puts the floor AT the reseller price when nobody has set a rule", () => {
    // Not below it. An unconfigured workspace must not be a workspace where
    // everything can be sold at a loss.
    expect(resolveMinMarginPct([], { oem: "Kaspersky", sku: "KES-10" })).toBe(0);
    expect(minSellingPrice(1234.56, 0)).toBe(1234.56);
  });

  it("ignores case and stray spaces in OEM, category and SKU", () => {
    // Distributor spreadsheets vary all three between months.
    expect(resolveMinMarginPct(RULES, { oem: "  microsoft ", sku: "m365-e5", category: "CLOUD" })).toBe(20);
  });

  it("does not let a rule for one OEM price another OEM's product", () => {
    expect(resolveMinMarginPct(RULES, { oem: "Autodesk", sku: "M365-E5", category: "Cloud" })).toBe(5);
  });

  it("rounds to the paisa the way numeric(14,2) does, not the way a float does", () => {
    // ₹100.10 at 15% is exactly ₹115.115. Postgres rounds it to 115.12;
    // the obvious round2(100.10 * 1.15) gives 115.11, because the product
    // is held as 115.11499999999999. Each of these cases was checked
    // against this CRM's own Postgres, and each one is a case where the
    // editor would otherwise tell a salesperson their price was fine
    // while the server held it below the floor and locked the quotation.
    expect(minSellingPrice(100.1, 15)).toBe(115.12);
    expect(minSellingPrice(100.25, 18)).toBe(118.3);
    expect(minSellingPrice(0.5, 15)).toBe(0.58);
    expect(minSellingPrice(1000, 1.55)).toBe(1015.5);
    expect(minSellingPrice(0, 15)).toBe(0);
  });
});

describe("the buying price", () => {
  it("is the reseller price less the discount actually obtained", () => {
    expect(buyingPrice(1000, 3.5)).toBe(965);
    expect(buyingPrice(2000, 0)).toBe(2000);
    expect(buyingPrice(1000, 3.25)).toBe(967.5);
  });

  it("flags a discount past the ordinary band without refusing it", () => {
    // It happens. The approvals screen asks the Admin to confirm, and the
    // number is recorded either way.
    expect(isUnusualDistributorDiscount(3.5)).toBe(false);
    expect(isUnusualDistributorDiscount(ORDINARY_DISTRIBUTOR_DISCOUNT_MAX + 0.1)).toBe(true);
    expect(buyingPrice(1000, 12)).toBe(880);
  });
});

describe("margin, said both ways", () => {
  it("reports the markup AND the gross margin, because they differ", () => {
    // THE TRAP THIS EXISTS FOR: a 15% minimum margin in this module is a
    // 15% markup on the reseller price, and the same deal reads 13.04% in
    // every other margin figure the CRM shows.
    const r = marginReadings(1150, 1000);
    expect(r.amount).toBe(150);
    expect(r.markupPct).toBe(15);
    expect(r.grossMarginPct).toBe(13.04);
  });

  it("shows the real margin once a distributor discount lands", () => {
    // Floor set at 1150 against a 1000 list; 3.5% obtained, so the stock
    // cost 965 and the deal earns 185, not 150.
    const r = marginReadings(1150, buyingPrice(1000, 3.5));
    expect(r.amount).toBe(185);
    expect(r.markupPct).toBe(19.17);
    expect(r.grossMarginPct).toBe(16.09);
  });

  it("gives null, not zero, where a percentage has no meaning", () => {
    expect(marginReadings(1000, 0).markupPct).toBeNull();
    expect(marginReadings(0, 0).grossMarginPct).toBeNull();
  });

  it("reports a price under cost as a loss", () => {
    const r = marginReadings(900, 1000);
    expect(r.amount).toBe(-100);
    expect(r.markupPct).toBe(-10);
  });
});

describe("which lines lock the quotation", () => {
  it("catches a line typed below its floor", () => {
    const need = linesNeedingApproval([{ lineId: "l1", sku: "M365-E3", qty: 10, minPrice: 1150, unitPrice: 1050 }]);
    expect(need).toEqual([
      { lineId: "l1", sku: "M365-E3", qty: 10, minPrice: 1150, requestedPrice: 1050 },
    ]);
  });

  it("leaves a line AT its floor alone", () => {
    expect(linesNeedingApproval([{ lineId: "l1", minPrice: 1150, unitPrice: 1150 }])).toEqual([]);
    // And a paisa over is over.
    expect(linesNeedingApproval([{ lineId: "l1", minPrice: 1150, unitPrice: 1150.01 }])).toEqual([]);
  });

  it("does not invent a floor for a line that has none", () => {
    // A hand-typed line, a service, or anything quoted before the price
    // book existed. Treating a missing minimum as zero would lock every
    // such quotation for an approval nobody could grant.
    expect(linesNeedingApproval([{ lineId: "l1", unitPrice: 1 }])).toEqual([]);
    expect(linesNeedingApproval([{ lineId: "l1", minPrice: null, unitPrice: 1 }])).toEqual([]);
    expect(linesNeedingApproval([{ lineId: "l1", minPrice: 0, unitPrice: 1 }])).toEqual([]);
  });

  it("treats an approved price as the new floor, not the old one", () => {
    const line = { lineId: "l1", minPrice: 1150, approvedPrice: 1080, unitPrice: 1080 };
    // Holding the approved price is not a fresh request.
    expect(linesNeedingApproval([line])).toEqual([]);
    // Nor is going back up.
    expect(linesNeedingApproval([{ ...line, unitPrice: 1200 }])).toEqual([]);
    // Cutting below it is, and the Admin is told they are being asked twice.
    expect(linesNeedingApproval([{ ...line, unitPrice: 1070 }])).toEqual([
      { lineId: "l1", sku: undefined, qty: undefined, minPrice: 1150, requestedPrice: 1070, previouslyApprovedAt: 1080 },
    ]);
  });

  it("reports every offending line, not just the first", () => {
    const need = linesNeedingApproval([
      { lineId: "a", minPrice: 100, unitPrice: 90 },
      { lineId: "b", minPrice: 200, unitPrice: 250 },
      { lineId: "c", minPrice: 300, unitPrice: 299 },
    ]);
    expect(need.map((n) => n.lineId)).toEqual(["a", "c"]);
  });

  it("does not treat a half-paisa of float noise as a discount", () => {
    expect(isBelowMinimum(1150 - 0.004, 1150)).toBe(false);
    expect(isBelowMinimum(1149.98, 1150)).toBe(true);
  });
});

describe("how long a quotation's prices stay quotable", () => {
  it("expires at the end of the month of the list it was built on", () => {
    expect(periodOf(2026, 11)).toBe("2026-11");
    expect(periodEnd("2026-11")).toBe("2026-11-30");
    expect(periodEnd("2026-12")).toBe("2026-12-31");
  });

  it("knows February", () => {
    expect(periodEnd("2026-02")).toBe("2026-02-28");
    expect(periodEnd("2024-02")).toBe("2024-02-29");
  });

  it("gives the whole of the last day, in local terms", () => {
    // The date is a string throughout, never a Date. Midnight UTC on the
    // 30th is half past five in the morning in Delhi, which would expire a
    // quotation most of a day early for everybody using this CRM.
    expect(isQuoteExpired(periodEnd("2026-11"), "2026-11-30")).toBe(false);
    expect(isQuoteExpired(periodEnd("2026-11"), "2026-12-01")).toBe(true);
  });

  it("lets an Admin's own date win, in either direction", () => {
    expect(quoteExpiry("2026-11", "2026-12-15")).toBe("2026-12-15");
    expect(quoteExpiry("2026-11", "2026-11-10")).toBe("2026-11-10");
    expect(quoteExpiry("2026-11", "")).toBe("2026-11-30");
    expect(quoteExpiry(null, null)).toBe("");
  });

  it("never expires a quotation that has no expiry at all", () => {
    // Every quotation raised before the price book existed.
    expect(isQuoteExpired("", "2030-01-01")).toBe(false);
    expect(isQuoteExpired(null, "2030-01-01")).toBe(false);
  });

  it("refuses to guess at a malformed period", () => {
    expect(periodEnd("rubbish")).toBe("");
    expect(periodEnd("2026-13")).toBe("");
  });
});

describe("this month's list against last month's", () => {
  const last = [
    { sku: "M365-E3", productName: "Microsoft 365 E3", resellerPrice: 1000 },
    { sku: "M365-E5", productName: "Microsoft 365 E5", resellerPrice: 2000 },
    { sku: "VISIO-P2", productName: "Visio Plan 2", resellerPrice: 500 },
  ];
  const now = [
    { sku: "m365-e3 ", productName: "Microsoft 365 E3", resellerPrice: 1100 },
    { sku: "M365-E5", productName: "Microsoft 365 E5", resellerPrice: 2000 },
    { sku: "TEAMS-EEA", productName: "Teams EEA", resellerPrice: 300 },
  ];

  it("names what is new, what is gone and what moved", () => {
    const diff = compareLists(last, now);
    expect(diff.added.map((r) => r.sku)).toEqual(["TEAMS-EEA"]);
    expect(diff.removed.map((r) => r.sku)).toEqual(["VISIO-P2"]);
    expect(diff.unchanged).toBe(1);
    expect(diff.changed).toEqual([
      { sku: "m365-e3 ", productName: "Microsoft 365 E3", from: 1000, to: 1100, changePct: 10 },
    ]);
  });

  it("matches a SKU across a change of case or spacing", () => {
    // "m365-e3 " and "M365-E3" are the same part number, and counting the
    // first as new and the second as removed would make every month's
    // report useless.
    const diff = compareLists(last, now);
    expect(diff.added.some((r) => r.sku.trim().toLowerCase() === "m365-e3")).toBe(false);
  });

  it("reports a fall as a negative, and rounds the percentage", () => {
    const diff = compareLists(
      [{ sku: "X", resellerPrice: 1000 }],
      [{ sku: "X", resellerPrice: 666.67 }],
    );
    expect(diff.changed[0]).toMatchObject({ from: 1000, to: 666.67, changePct: -33.33 });
  });

  it("gives no percentage where there was no price to rise from", () => {
    const diff = compareLists([{ sku: "X", resellerPrice: 0 }], [{ sku: "X", resellerPrice: 100 }]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.changePct).toBeNull();
  });

  it("does not report a paisa of rounding as a price change", () => {
    const diff = compareLists([{ sku: "X", resellerPrice: 100 }], [{ sku: "X", resellerPrice: 100.004 }]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toBe(1);
  });
});

describe("the SQL this file mirrors", () => {
  const sql = readFileSync("supabase/056_price_book.sql", "utf8");

  it("still computes the minimum selling price the same way", () => {
    // If migration 056 is ever rewritten, this fails rather than letting
    // the editor and the server drift apart in silence. The migration is
    // applied and must not be edited — a change goes in a NEW migration,
    // and this assertion then has to be pointed at it deliberately.
    expect(sql).toContain("round(coalesce(p_reseller, 0) * (1 + coalesce(p_margin_pct, 0) / 100.0), 2)");
  });

  it("still takes the distributor discount off the reseller price", () => {
    expect(sql).toContain("round(i.reseller_price * (1 - coalesce(p_distributor_pct, 0) / 100.0), 2)");
  });

  it("still resolves margin rules most-specific-first", () => {
    expect(sql).toContain("order by (r.sku is not null) desc");
    expect(sql).toContain("(r.category is not null) desc");
    expect(sql).toContain("(r.oem <> '*') desc");
  });

  it("still keeps the cost out of the search a salesperson calls", () => {
    // The guarantee is structural: the function's return type has no cost
    // column, so there is nothing to forget to redact.
    const search = sql.slice(sql.indexOf("function public.price_book_search("));
    const signature = search.slice(0, search.indexOf("language plpgsql"));
    expect(signature).toContain("min_price numeric");
    expect(signature).not.toContain("reseller_price");
    expect(signature).not.toContain("buying_price");
    expect(signature).not.toContain("margin");
  });
});
