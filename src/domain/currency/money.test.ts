import { describe, expect, it } from "vitest";
import {
  formatTotals, inrList, inrShort, isMixed, money, moneyList, moneyShort, totalsByCurrency,
} from "./format";

describe("money in the currency the record is in", () => {
  it("uses the right symbol, not always the rupee", () => {
    // THE REPORTED BUG: a proforma raised in dollars read "₹11,948" in the
    // list beside a PDF that said $11,948.
    expect(moneyList(11948, "USD")).toBe("$11,948");
    expect(moneyList(11948, "INR")).toBe("₹11,948");
    expect(moneyList(11948, "AED")).toContain("AED");
  });

  it("keeps rupees looking exactly as they did", () => {
    // These screens are in daily use; the INR figures must not shift.
    for (const n of [0, 999, 11948, 2359366, 48250111.5]) {
      expect(moneyList(n, "INR")).toBe(inrList(n));
      expect(moneyShort(n, "INR")).toBe(inrShort(n));
    }
  });

  it("groups rupees Indian-style and everything else western", () => {
    expect(moneyList(2359366, "INR")).toBe("₹23,59,366");
    expect(moneyList(2359366, "USD")).toBe("$2,359,366");
  });

  it("keeps the decimals the currency actually has", () => {
    expect(money(1234.5, "USD")).toBe("$1,234.50");
    expect(money(1234.5, "INR")).toBe("₹1,234.50");
  });

  it("treats a missing currency as rupees, which is what a legacy row is", () => {
    expect(moneyList(11948, undefined)).toBe("₹11,948");
    expect(moneyList(11948, "")).toBe("₹11,948");
  });
});

describe("compact figures on a tile", () => {
  it("reads rupees in crore and lakh", () => {
    expect(moneyShort(48250111, "INR")).toBe("₹4.83 Cr");
    expect(moneyShort(257000, "INR")).toBe("₹2.57 L");
    expect(moneyShort(11948, "INR")).toBe("₹11.9 K");
    expect(moneyShort(940, "INR")).toBe("₹940");
  });

  it("does NOT put lakhs on a dollar figure", () => {
    // "$2.57 L" is not a shorter way of writing dollars — it is a phrase a
    // reader in New York has to decode.
    expect(moneyShort(2570000, "USD")).toBe("$2.57M");
    expect(moneyShort(11948, "USD")).toBe("$11.9K");
    expect(moneyShort(940, "USD")).toBe("$940");
  });

  it("keeps a negative readable", () => {
    expect(moneyShort(-257000, "INR")).toBe("-₹2.57 L");
    expect(moneyShort(-2570000, "USD")).toBe("-$2.57M");
  });
});

describe("totals when the records are not all in one currency", () => {
  const docs = [
    { grand: 1000000, currency: "INR" },
    { grand: 1359366, currency: "INR" },
    { grand: 11948, currency: "USD" },
    { grand: 500, currency: "" },
  ];
  const totals = totalsByCurrency(docs, (d) => d.grand, (d) => d.currency);

  it("keeps the currencies apart instead of adding them together", () => {
    // Rs 100 + $100 is not 200 of anything, and the old single figure was
    // wrong by whatever the foreign documents came to.
    expect(totals).toEqual([
      { code: "INR", total: 2359866, count: 3 },
      { code: "USD", total: 11948, count: 1 },
    ]);
  });

  it("puts the largest first and says so on one line", () => {
    expect(formatTotals(totals)).toBe("₹23,59,866 + $11,948");
  });

  it("knows when a single figure would be a lie", () => {
    expect(isMixed(totals)).toBe(true);
    expect(isMixed(totalsByCurrency(docs.slice(0, 2), (d) => d.grand, (d) => d.currency))).toBe(false);
    expect(isMixed([])).toBe(false);
  });

  it("reads a blank currency as the fallback rather than its own bin", () => {
    expect(totals.find((t) => t.code === "INR")?.count).toBe(3);
    expect(totals.some((t) => t.code === "")).toBe(false);
  });

  it("is case- and space-insensitive about the code", () => {
    const messy = totalsByCurrency(
      [{ v: 1, c: "usd" }, { v: 2, c: " USD " }], (x) => x.v, (x) => x.c);
    expect(messy).toEqual([{ code: "USD", total: 3, count: 2 }]);
  });

  it("has nothing to say about nothing", () => {
    expect(totalsByCurrency([], () => 0, () => "INR")).toEqual([]);
    expect(formatTotals([])).toBe("");
  });
});
