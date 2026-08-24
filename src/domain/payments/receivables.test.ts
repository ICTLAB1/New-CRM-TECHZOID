import { describe, expect, it } from "vitest";
import { AGE_BUCKETS, bucketFor, buildReceivables, daysBetween, type AgeableInvoice } from "./receivables";

/**
 * Every figure here is a function of the date it is asked on, which is why
 * `today` is a parameter rather than a clock read. These tests pin the
 * arithmetic of what is owed and how old it is — the two numbers somebody
 * chases people for.
 */

const TODAY = "2026-08-24";

const inv = (over: Partial<AgeableInvoice> = {}): AgeableInvoice => ({
  id: "i1", number: "TZ/INV/2026-27/0001", ownerId: "u1", billName: "Acme",
  status: "Issued", date: "2026-07-01", validUntil: "2026-07-31",
  paymentHistory: [],
  ...over,
});

const grand = () => 100000;

describe("day counting", () => {
  it("counts whole calendar days, so an invoice due yesterday is one day overdue", () => {
    expect(daysBetween("2026-08-23", "2026-08-24")).toBe(1);
    expect(daysBetween("2026-08-24", "2026-08-24")).toBe(0);
  });

  it("reports a future due date as negative, not as overdue", () => {
    expect(daysBetween("2026-09-24", "2026-08-24")).toBe(-31);
  });

  it("returns 0 rather than NaN for an unparseable date", () => {
    expect(daysBetween("", TODAY)).toBe(0);
    expect(daysBetween("not-a-date", TODAY)).toBe(0);
  });
});

describe("bucketing", () => {
  it("puts anything not yet due in Not yet due, including due today", () => {
    expect(bucketFor(-5)).toBe("current");
    expect(bucketFor(0)).toBe("current");
  });

  it("splits at 30, 60 and 90 days", () => {
    expect(bucketFor(1)).toBe("d30");
    expect(bucketFor(30)).toBe("d30");
    expect(bucketFor(31)).toBe("d60");
    expect(bucketFor(60)).toBe("d60");
    expect(bucketFor(61)).toBe("d90");
    expect(bucketFor(90)).toBe("d90");
    expect(bucketFor(91)).toBe("d90plus");
    expect(bucketFor(400)).toBe("d90plus");
  });

  it("has a bucket for every id the report produces", () => {
    const ids = AGE_BUCKETS.map((b) => b.id);
    for (const days of [-10, 0, 1, 30, 31, 60, 61, 90, 91, 1000]) {
      expect(ids, String(days)).toContain(bucketFor(days));
    }
  });
});

describe("what is outstanding", () => {
  it("owes the full amount when nothing has been paid", () => {
    const r = buildReceivables([inv()], grand, TODAY);
    expect(r.totalOutstanding).toBe(100000);
    expect(r.open[0]!.amountPaid).toBe(0);
  });

  it("owes the balance after a part payment", () => {
    const r = buildReceivables([inv({ paymentHistory: [{ amount: 40000 }] })], grand, TODAY);
    expect(r.totalOutstanding).toBe(60000);
    expect(r.open[0]!.amountPaid).toBe(40000);
  });

  it("drops a fully paid invoice off the list entirely", () => {
    const r = buildReceivables([inv({ paymentHistory: [{ amount: 100000 }] })], grand, TODAY);
    expect(r.open).toEqual([]);
    expect(r.totalOutstanding).toBe(0);
  });

  it("never shows a negative balance when a customer overpays", () => {
    const r = buildReceivables([inv({ paymentHistory: [{ amount: 150000 }] })], grand, TODAY);
    expect(r.open).toEqual([]);
    expect(r.totalOutstanding).toBe(0);
  });

  it("ignores a cancelled invoice — nobody owes that", () => {
    expect(buildReceivables([inv({ status: "Cancelled" })], grand, TODAY).open).toEqual([]);
  });

  it("ignores a draft — issuing it is what creates the debt", () => {
    // Counting drafts would overstate the book with invoices nobody has seen.
    expect(buildReceivables([inv({ status: "Draft" })], grand, TODAY).open).toEqual([]);
  });
});

describe("ageing", () => {
  it("separates overdue money from money merely outstanding", () => {
    const r = buildReceivables(
      [
        inv({ id: "a", validUntil: "2026-07-31" }),   // 24 days overdue
        inv({ id: "b", validUntil: "2026-09-30" }),   // not yet due
      ],
      grand,
      TODAY,
    );
    expect(r.totalOutstanding).toBe(200000);
    expect(r.overdueOutstanding).toBe(100000);
    expect(r.byBucket.current).toBe(100000);
    expect(r.byBucket.d30).toBe(100000);
  });

  it("puts the oldest debt at the top — the list is a to-do", () => {
    const r = buildReceivables(
      [
        inv({ id: "recent", validUntil: "2026-08-20" }),
        inv({ id: "ancient", validUntil: "2026-01-01" }),
        inv({ id: "future", validUntil: "2026-12-01" }),
      ],
      grand,
      TODAY,
    );
    expect(r.open.map((o) => o.invoice.id)).toEqual(["ancient", "recent", "future"]);
  });

  it("totals each bucket separately", () => {
    const r = buildReceivables(
      [
        inv({ id: "a", validUntil: "2026-08-10" }),  // 14 days
        inv({ id: "b", validUntil: "2026-07-10" }),  // 45 days
        inv({ id: "c", validUntil: "2026-06-10" }),  // 75 days
        inv({ id: "d", validUntil: "2026-01-10" }),  // 226 days
      ],
      grand,
      TODAY,
    );
    expect(r.byBucket.d30).toBe(100000);
    expect(r.byBucket.d60).toBe(100000);
    expect(r.byBucket.d90).toBe(100000);
    expect(r.byBucket.d90plus).toBe(100000);
  });

  it("treats an invoice with no due date as not overdue rather than infinitely so", () => {
    const r = buildReceivables([inv({ validUntil: null })], grand, TODAY);
    expect(r.open[0]!.daysOverdue).toBe(0);
    expect(r.overdueOutstanding).toBe(0);
  });

  it("splits the book by owner, so each salesperson sees their own", () => {
    const r = buildReceivables(
      [inv({ id: "a", ownerId: "u1" }), inv({ id: "b", ownerId: "u2" }), inv({ id: "c", ownerId: "u1" })],
      grand,
      TODAY,
    );
    expect(r.byOwner["u1"]).toBe(200000);
    expect(r.byOwner["u2"]).toBe(100000);
  });
});

describe("the figure owed", () => {
  it("uses the grand total it is handed, never one of its own", () => {
    // Every total in this product comes from computeDocument. A receivables
    // screen re-deriving one would be the first place the two could differ.
    const r = buildReceivables([inv()], () => 12345.67, TODAY);
    expect(r.totalOutstanding).toBe(12345.67);
  });

  it("rounds sums rather than accumulating floating-point drift", () => {
    const many = Array.from({ length: 3 }, (_, i) => inv({ id: "i" + i }));
    const r = buildReceivables(many, () => 0.1, TODAY);
    expect(r.totalOutstanding).toBe(0.3);
  });
});
