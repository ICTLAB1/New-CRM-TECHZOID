import { describe, expect, it } from "vitest";
import { computePaymentInfo } from "./ledger";

const pay = (amount: number) => ({ amount, date: "2026-01-01", method: "UPI" });

describe("payment ledger", () => {
  it("reports an untouched proforma as unpaid", () => {
    const info = computePaymentInfo({}, 1000);
    expect(info).toMatchObject({ amountPaid: 0, outstanding: 1000, pct: 0, paymentStatus: "unpaid" });
  });

  it("treats a legacy record with no paymentHistory as an empty ledger", () => {
    expect(computePaymentInfo({ paymentHistory: null }, 500).paymentStatus).toBe("unpaid");
    expect(computePaymentInfo({ paymentHistory: undefined }, 500).outstanding).toBe(500);
  });

  it("sums part payments into a partial status", () => {
    const info = computePaymentInfo({ paymentHistory: [pay(250), pay(250)] }, 1000);
    expect(info).toMatchObject({ amountPaid: 500, outstanding: 500, pct: 50, paymentStatus: "partial" });
  });

  it("marks exactly-settled as paid", () => {
    const info = computePaymentInfo({ paymentHistory: [pay(1000)] }, 1000);
    expect(info).toMatchObject({ amountPaid: 1000, outstanding: 0, pct: 100, paymentStatus: "paid" });
  });

  describe("zero-value proforma", () => {
    it("does not divide by zero", () => {
      const info = computePaymentInfo({}, 0);
      expect(info.pct).toBe(0);
      expect(Number.isFinite(info.pct)).toBe(true);
      expect(info.outstanding).toBe(0);
    });

    it("counts any receipt against a zero-value document as paid", () => {
      expect(computePaymentInfo({ paymentHistory: [pay(1)] }, 0).paymentStatus).toBe("paid");
    });
  });

  describe("overpayment", () => {
    it("caps the percentage at 100 and floors outstanding at zero", () => {
      const info = computePaymentInfo({ paymentHistory: [pay(1500)] }, 1000);
      expect(info.pct).toBe(100);
      expect(info.outstanding).toBe(0);
      expect(info.paymentStatus).toBe("paid");
      expect(info.amountPaid).toBe(1500);
    });
  });

  describe("floating-point drift", () => {
    it("settles three payments of 0.1 against 0.3", () => {
      const info = computePaymentInfo({ paymentHistory: [pay(0.1), pay(0.1), pay(0.1)] }, 0.3);
      expect(info.amountPaid).toBe(0.3);
      expect(info.outstanding).toBe(0);
      expect(info.paymentStatus).toBe("paid");
    });

    it("does not leave a sub-paisa residue outstanding", () => {
      const info = computePaymentInfo({ paymentHistory: [pay(1180.03), pay(0.02)] }, 1180.05);
      expect(info.outstanding).toBe(0);
      expect(info.paymentStatus).toBe("paid");
    });
  });

  describe("overdue", () => {
    it("flags an unpaid document past its validity", () => {
      const info = computePaymentInfo({ validUntil: "2026-01-01" }, 1000, "2026-02-01");
      expect(info.overdue).toBe(true);
    });

    it("never flags a settled document", () => {
      const info = computePaymentInfo({ validUntil: "2026-01-01", paymentHistory: [pay(1000)] }, 1000, "2026-02-01");
      expect(info.overdue).toBe(false);
    });

    it("never flags a document with no validity date", () => {
      expect(computePaymentInfo({}, 1000, "2030-01-01").overdue).toBe(false);
    });

    it("is not overdue on the validity date itself", () => {
      expect(computePaymentInfo({ validUntil: "2026-02-01" }, 1000, "2026-02-01").overdue).toBe(false);
    });
  });

  it("reads amounts stored as strings", () => {
    const info = computePaymentInfo({ paymentHistory: [{ amount: "250.50" }] }, 1000);
    expect(info.amountPaid).toBe(250.5);
  });

  it("ignores malformed entries rather than producing NaN", () => {
    const info = computePaymentInfo({ paymentHistory: [{ amount: "abc" }, { }, pay(100)] }, 1000);
    expect(info.amountPaid).toBe(100);
  });
});
