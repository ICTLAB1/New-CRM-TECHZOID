import { describe, expect, it } from "vitest";
import { inr, inrList, inrShort } from "./format";

describe("rupees on screen", () => {
  it("inr keeps full precision, for detail views and documents", () => {
    expect(inr(7178851)).toBe("₹71,78,851.00");
    expect(inr(1234.5)).toBe("₹1,234.50");
  });

  it("inrList drops the decimals, for scanning a column", () => {
    // Forty rows all ending ".00" is forty repetitions of nothing.
    expect(inrList(7178851)).toBe("₹71,78,851");
    expect(inrList(86400)).toBe("₹86,400");
  });

  it("inrList rounds rather than truncating", () => {
    expect(inrList(99.6)).toBe("₹100");
    expect(inrList(99.4)).toBe("₹99");
  });

  it("both group in the Indian system, not the western one", () => {
    expect(inrList(10000000)).toBe("₹1,00,00,000");
  });

  it("inrShort compacts to Cr / L / K for headline figures", () => {
    expect(inrShort(24860000)).toBe("₹2.49 Cr");
    expect(inrShort(412000)).toBe("₹4.12 L");
    expect(inrShort(4120)).toBe("₹4.1 K");
    expect(inrShort(412)).toBe("₹412");
  });

  it("survives null, undefined and rubbish", () => {
    for (const fn of [inr, inrList, inrShort]) {
      expect(fn(null)).toContain("₹");
      expect(fn(undefined)).toContain("₹");
      expect(fn("abc")).toContain("₹");
    }
  });
});
