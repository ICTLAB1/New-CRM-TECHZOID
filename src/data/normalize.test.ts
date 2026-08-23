import { describe, expect, it } from "vitest";
import { normalizeCustomer, normalizeDocument } from "./normalize";

describe("legacy record normalisation", () => {
  it("fills every field a pre-multi-currency document lacks", () => {
    const legacy = { id: "q1", billName: "Acme" };
    const d = normalizeDocument(legacy);
    expect(d).toMatchObject({
      currency: "INR",
      taxType: "gst",
      billCountry: "India",
      paymentHistory: [],
      items: [],
    });
  });

  it("never overwrites a value that is present", () => {
    const d = normalizeDocument({ currency: "AED", taxType: "none", billCountry: "UAE" });
    expect(d).toMatchObject({ currency: "AED", taxType: "none", billCountry: "UAE" });
  });

  it("repairs a paymentHistory that is not an array", () => {
    expect(normalizeDocument({ paymentHistory: null }).paymentHistory).toEqual([]);
    expect(normalizeDocument({ paymentHistory: "x" }).paymentHistory).toEqual([]);
  });

  it("repairs items that are missing or malformed", () => {
    expect(normalizeDocument({}).items).toEqual([]);
    expect(normalizeDocument({ items: null }).items).toEqual([]);
  });

  it("preserves every other field untouched", () => {
    const d = normalizeDocument({ id: "q1", number: "TZ/QT/2526/0001", custom: { a: 1 } });
    expect(d.id).toBe("q1");
    expect(d.custom).toEqual({ a: 1 });
  });

  it("normalises customers the same way", () => {
    expect(normalizeCustomer({ company: "Acme" })).toMatchObject({
      currency: "INR",
      taxType: "gst",
      country: "India",
    });
  });
});
