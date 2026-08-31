import { describe, expect, it } from "vitest";
import { activeSchemes, calcMetrics, computePayout, nextTarget, periodBounds, type IncentiveScheme } from "./incentives";
import type { Workspace } from "../analytics/dashboard";

const AUG = new Date("2026-08-23T10:00:00+05:30");

const ms = (iso: string) => new Date(iso + "T10:00:00+05:30").getTime();

const workspace = {
  customers: [
    { id: "c1", ownerId: "u1", company: "Acme", stage: "won", value: 400_000, wonAt: ms("2026-08-02"), createdAt: ms("2026-07-01") },
    { id: "c2", ownerId: "u1", company: "Beta", stage: "won", value: 250_000, wonAt: ms("2026-06-10"), createdAt: ms("2026-06-01") },
    { id: "c3", ownerId: "u2", company: "Gamma", stage: "won", value: 900_000, wonAt: ms("2026-08-05"), createdAt: ms("2026-08-01") },
    { id: "c4", ownerId: "u1", company: "Delta", stage: "qualified", value: 100_000, createdAt: ms("2026-08-11") },
  ],
  quotations: [
    { id: "q1", ownerId: "u1", createdAt: ms("2026-08-04") },
    { id: "q2", ownerId: "u1", createdAt: ms("2026-05-04") },
    { id: "q3", ownerId: "u2", createdAt: ms("2026-08-06") },
  ],
  proformas: [], orders: [], challans: [],
  subscriptions: [
    { id: "s1", ownerId: "u1", status: "Renewed", updatedAt: ms("2026-08-07") },
    { id: "s2", ownerId: "u1", status: "Active", updatedAt: ms("2026-08-08") },
  ],
} as unknown as Workspace;

describe("periods", () => {
  it("uses Indian financial quarters", () => {
    // August falls in Q2: July to September.
    const q = periodBounds("Quarterly", AUG);
    expect(q.label).toBe("Q2 2026-27");
    expect(new Date(q.startMs).getMonth()).toBe(6);
    expect(new Date(q.endMs).getMonth()).toBe(8);
  });

  it("puts January in Q4 of the financial year that began the previous April", () => {
    const q = periodBounds("Quarterly", new Date("2027-01-15T10:00:00+05:30"));
    expect(q.label).toBe("Q4 2026-27");
    expect(new Date(q.startMs).getFullYear()).toBe(2027);
  });

  it("defaults to the financial year", () => {
    expect(periodBounds("Yearly", AUG).label).toBe("FY 2026-27");
    expect(periodBounds("anything else", AUG).label).toBe("FY 2026-27");
  });
});

describe("metrics", () => {
  it("counts only this person, only within the period", () => {
    const m = calcMetrics("u1", "Monthly", workspace, AUG);
    expect(m.revenue).toBe(400_000);   // Beta was won in June
    expect(m.dealsWon).toBe(1);
    expect(m.quotationsSent).toBe(1);  // q2 was May
    expect(m.newCustomers).toBe(1);    // Delta, created in August
    expect(m.renewals).toBe(1);        // only the Renewed one
  });

  it("widens with the period", () => {
    const m = calcMetrics("u1", "Yearly", workspace, AUG);
    expect(m.revenue).toBe(650_000);
    expect(m.dealsWon).toBe(2);
  });
});

describe("payout", () => {
  const scheme = (over: Partial<IncentiveScheme> = {}): IncentiveScheme => ({
    id: "s", name: "FY scheme", period: "Monthly", active: true,
    slabs: [
      { id: "a", metric: "Revenue", minTarget: 300_000, maxTarget: 0, payoutType: "Percentage", payoutValue: 2, bonusFlat: 0 },
      { id: "b", metric: "Deals Won", minTarget: 5, maxTarget: 0, payoutType: "Flat", payoutValue: 10_000, bonusFlat: 0 },
    ],
    ...over,
  });

  it("pays a qualified slab and skips one that isn't met", () => {
    const m = calcMetrics("u1", "Monthly", workspace, AUG);
    const result = computePayout(scheme(), m);
    expect(result.breakdown[0]?.qualified).toBe(true);
    expect(result.breakdown[1]?.qualified).toBe(false);
    expect(result.totalPayout).toBe(8_000);   // 2% of 4,00,000
  });

  /* v1's arithmetic, kept deliberately: a percentage slab pays a percentage
     of REVENUE whatever metric it is measured on. Changing this would
     restate what somebody has already been paid. */
  it("pays a percentage of revenue even on a non-revenue metric", () => {
    const m = calcMetrics("u1", "Monthly", workspace, AUG);
    const s = scheme({
      slabs: [{ id: "a", metric: "Deals Won", minTarget: 1, maxTarget: 0, payoutType: "Percentage", payoutValue: 5, bonusFlat: 0 }],
    });
    expect(computePayout(s, m).totalPayout).toBe(20_000);  // 5% of 4,00,000, not of 1
  });

  it("adds the bonus on top of the payout, not instead of it", () => {
    const m = calcMetrics("u1", "Monthly", workspace, AUG);
    const s = scheme({
      slabs: [{ id: "a", metric: "Revenue", minTarget: 0, maxTarget: 0, payoutType: "Flat", payoutValue: 5_000, bonusFlat: 2_500 }],
    });
    expect(computePayout(s, m).totalPayout).toBe(7_500);
  });

  it("treats a zero upper target as no ceiling", () => {
    const m = calcMetrics("u1", "Yearly", workspace, AUG);
    const s = scheme({
      slabs: [{ id: "a", metric: "Revenue", minTarget: 0, maxTarget: 0, payoutType: "Flat", payoutValue: 1_000, bonusFlat: 0 }],
    });
    expect(computePayout(s, m).breakdown[0]?.qualified).toBe(true);
  });

  it("respects a real upper target", () => {
    const m = calcMetrics("u1", "Monthly", workspace, AUG);
    const s = scheme({
      slabs: [{ id: "a", metric: "Revenue", minTarget: 0, maxTarget: 100_000, payoutType: "Flat", payoutValue: 1_000, bonusFlat: 0 }],
    });
    expect(computePayout(s, m).breakdown[0]?.qualified).toBe(false);
  });

  it("names the nearest slab still out of reach", () => {
    const m = calcMetrics("u1", "Monthly", workspace, AUG);
    const gap = nextTarget(computePayout(scheme(), m), m);
    expect(gap?.slab.metric).toBe("Deals Won");
    expect(gap?.gap).toBe(4);
  });

  it("reports nothing left to reach once every slab is met", () => {
    const m = calcMetrics("u1", "Monthly", workspace, AUG);
    const s = scheme({
      slabs: [{ id: "a", metric: "Revenue", minTarget: 0, maxTarget: 0, payoutType: "Flat", payoutValue: 1, bonusFlat: 0 }],
    });
    expect(nextTarget(computePayout(s, m), m)).toBeNull();
  });

  it("ignores an inactive scheme", () => {
    expect(activeSchemes([scheme(), scheme({ id: "x", active: false })])).toHaveLength(1);
    expect(activeSchemes(undefined)).toEqual([]);
  });
});

describe("what revenue is measured on", () => {
  /* THE REPORTED BUG. A customer created, a proforma paid, a tax invoice
     raised and accepted for more than ₹22 lakh — and the incentives screen
     read "Deals won 3, Revenue earned ₹0". Revenue came from the Deal value
     typed on the customer record, and invoices were not even passed to the
     calculation. Because a Percentage slab pays a percentage of REVENUE
     whatever its metric, zero revenue paid zero on every slab. */
  const NOW = new Date("2026-08-27T10:00:00");
  const ms = (iso: string) => new Date(iso + "T00:00:00").getTime();

  const doc = (o: Record<string, unknown>): never => ({
    id: "d", number: "TZ/INV/1", ownerId: "u1", customerId: "c1",
    billName: "NEXCEL", billContact: "", billAddress: "", billState: "Delhi", billCountry: "India",
    billGstin: "", billPan: "", billEmail: "", billPhone: "",
    shipSameAsBilling: true, shipName: "", shipAddress: "", shipState: "", shipCountry: "",
    shipGstin: "", shipPan: "", shipContact: "", shipPhone: "", shipEmail: "",
    currency: "INR", taxType: "none", referenceNo: "", revisionNo: 0, subject: "",
    date: "2026-08-10", validUntil: "2026-09-10", status: "Accepted",
    items: [{ id: "i", qty: 1, rate: 2200000, disc: 0, gst: 0 }],
    terms: [], roundOff: false, preparedBy: "", createdAt: ms("2026-08-10"), updatedAt: 0, ...o,
  }) as never;

  const ws = {
    customers: [
      /* Won this month, and nobody typed a Deal value — which is ordinary
         when the real figure lives on the invoice. */
      { id: "c1", ownerId: "u1", stage: "won", wonAt: ms("2026-08-12") },
      { id: "c2", ownerId: "u1", stage: "won", wonAt: ms("2026-08-14") },
      { id: "c3", ownerId: "u1", stage: "won", wonAt: ms("2026-08-20") },
    ] as never[],
    quotations: [] as never[],
    proformas: [doc({ id: "pf1", number: "TZ/PI/1", status: "Paid", paymentHistory: [{ amount: 500000, date: "2026-08-15" }] })],
    invoices: [doc({ id: "inv1" })],
    orders: [] as never[], challans: [] as never[], subscriptions: [] as never[],
  };

  it("counted nothing before, from three won deals", () => {
    // The old behaviour, kept as an option so an existing scheme is not
    // silently restated.
    const m = calcMetrics("u1", "Monthly", ws, NOW, "deal-value");
    expect(m.dealsWon).toBe(3);
    expect(m.revenue).toBe(0);
  });

  it("counts the tax invoice that was actually raised", () => {
    const m = calcMetrics("u1", "Monthly", ws, NOW, "invoiced");
    expect(m.revenue).toBe(2200000);
    expect(m.dealsWon).toBe(3);
  });

  it("counts money that actually arrived, on an invoice or a proforma", () => {
    // This company takes payment against a proforma routinely.
    expect(calcMetrics("u1", "Monthly", ws, NOW, "collected").revenue).toBe(500000);
  });

  it("dates a collection by the payment, not by the document", () => {
    // A January invoice settled in March is March's revenue to whoever is
    // paid on collections.
    const late = { ...ws, proformas: [] as never[], invoices: [doc({ id: "inv2", createdAt: ms("2026-01-05"), paymentHistory: [{ amount: 900000, date: "2026-08-20" }] })] };
    expect(calcMetrics("u1", "Monthly", late, NOW, "collected").revenue).toBe(900000);
    // …and it is NOT August's invoiced revenue, because it was raised in January.
    expect(calcMetrics("u1", "Monthly", late, NOW, "invoiced").revenue).toBe(0);
  });

  it("ignores a draft invoice, which has not been raised at all", () => {
    const draft = { ...ws, invoices: [doc({ id: "inv3", status: "Draft" })] };
    expect(calcMetrics("u1", "Monthly", draft, NOW, "invoiced").revenue).toBe(0);
  });

  it("counts only this person's documents", () => {
    const theirs = { ...ws, invoices: [doc({ id: "inv4", ownerId: "u2" })] };
    expect(calcMetrics("u1", "Monthly", theirs, NOW, "invoiced").revenue).toBe(0);
  });

  it("copes with a workspace that carries no invoices at all", () => {
    const none = { ...ws, invoices: undefined };
    expect(calcMetrics("u1", "Monthly", none, NOW, "invoiced").revenue).toBe(0);
    expect(calcMetrics("u1", "Monthly", none, NOW, "collected").revenue).toBe(500000);
  });
});
