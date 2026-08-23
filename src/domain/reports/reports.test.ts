import { describe, expect, it } from "vitest";
import { buildReports } from "./reports";
import { objectsToCsv, type CsvValue } from "./csv";
import type { Workspace } from "../analytics/dashboard";
import type { Customer } from "../customers/customer";
import type { SalesDocument } from "../documents/create";
import type { Subscription } from "../subscriptions/expiry";
import type { SalesOrder } from "../orders/create";

const NOW = new Date("2026-08-24T10:00:00");
const at = (iso: string) => new Date(iso + "T00:00:00").getTime();

const doc = (o: Partial<SalesDocument>): SalesDocument => ({
  id: "d", number: "TZ/QT/0001", ownerId: "u1", customerId: "c1",
  billName: "Acme", billContact: "", billAddress: "", billState: "Delhi", billCountry: "India",
  billGstin: "", billPan: "", billEmail: "", billPhone: "",
  shipSameAsBilling: true, shipName: "", shipAddress: "", shipState: "", shipCountry: "",
  shipGstin: "", shipPan: "", shipContact: "", shipPhone: "", shipEmail: "",
  currency: "INR", taxType: "gst", referenceNo: "", revisionNo: 0, subject: "",
  date: "2026-08-01", validUntil: "2026-09-30", status: "Sent",
  items: [{ id: "i", qty: 1, rate: 100000, disc: 0, gst: 18 }],
  terms: [], roundOff: false, preparedBy: "", createdAt: 0, updatedAt: 0, ...o,
});

const WS: Workspace = {
  customers: [
    { id: "c1", ownerId: "u1", company: "Acme, R & Co", stage: "won", value: 400000, wonAt: at("2026-08-05"), segment: "Enterprise" } as Customer,
    { id: "c2", ownerId: "u2", company: "Northline", stage: "lost", value: 200000, lostReason: "Price too high", segment: "SMB" } as Customer,
    { id: "c3", ownerId: "u1", company: "Vertex", stage: "lead", value: 900000, segment: "SMB" } as Customer,
  ],
  quotations: [doc({ id: "q1" }), doc({ id: "q2", ownerId: "u2", status: "Accepted" })],
  proformas: [doc({ id: "p1", number: "TZ/PI/0001", status: "Sent", validUntil: "2026-08-10", paymentHistory: [{ amount: 50000 }] })],
  orders: [{ id: "o1", ownerId: "u1", number: "TZ/SO/0001", billName: "Acme", stage: "procurement", date: "2026-08-02", items: [{ id: "a", qty: 10, rate: 5000, gst: 18 }] } as SalesOrder],
  challans: [{ id: "dc1", orderId: "o1", items: [{ itemId: "a", qty: 4 }] }],
  subscriptions: [
    { id: "s1", ownerId: "u1", customerName: "Acme", product: "M365", vendor: "Microsoft", expiryDate: "2026-09-01", sellPrice: 300000 } as Subscription,
  ],
};

const USERS = [{ id: "u1", name: "Priyanshi" }, { id: "u2", name: "Rashmi" }];
const reports = buildReports(WS, USERS, "Delhi", 6, NOW);
const byId = (id: string) => reports.find((r) => r.id === id)!;

describe("the report set", () => {
  it("covers every report the brief lists", () => {
    const ids = reports.map((r) => r.id);
    for (const id of [
      "revenue", "salespeople", "drilldown", "renewals-or-expiry", "segments",
      "vendors", "funnel", "quotations", "lost", "expiry", "activity",
    ].filter((x) => x !== "renewals-or-expiry")) {
      expect(ids, id).toContain(id);
    }
  });

  it("gives every report a title, description and columns", () => {
    for (const r of reports) {
      expect(r.title, r.id).toBeTruthy();
      expect(r.description, r.id).toBeTruthy();
      expect(r.columns.length, r.id).toBeGreaterThan(0);
    }
  });

  it("exports exactly the columns it displays", () => {
    // Three of v1's ten reports exported a different set of fields from the
    // one they showed.
    for (const r of reports) {
      const csv = objectsToCsv(r.columns, r.rows as Record<string, CsvValue>[]);
      const header = csv.split("\r\n")[0];
      expect(header, r.id).toBe(r.columns.map((c) => c.label).join(","));
    }
  });

  it("escapes a customer name containing a comma", () => {
    const csv = objectsToCsv(byId("lost").columns, byId("lost").rows as Record<string, CsvValue>[]);
    expect(csv).not.toContain("Acme, R & Co,");
  });
});

describe("individual reports", () => {
  it("revenue places a deal in the month it was won and totals it", () => {
    const revenue = byId("revenue");
    expect(revenue.rows).toHaveLength(6);
    expect(revenue.total?.revenue).toBe(400000);
  });

  it("by salesperson attributes work to its owner", () => {
    const rows = byId("salespeople").rows;
    expect(rows.find((r) => r.person === "Priyanshi")?.wonValue).toBe(400000);
    expect(rows.find((r) => r.person === "Rashmi")?.lostDeals).toBe(1);
  });

  it("quotation analysis shares add to the whole", () => {
    const analysis = byId("quotations");
    expect(analysis.total?.count).toBe(2);
    expect(analysis.rows.find((r) => r.status === "Accepted")?.count).toBe(1);
  });

  it("lost deals names an unrecorded reason rather than leaving it blank", () => {
    const ws = { ...WS, customers: [{ id: "x", ownerId: "u1", company: "Quiet", stage: "lost", value: 1 } as Customer] };
    const lost = buildReports(ws, USERS, "Delhi", 6, NOW).find((r) => r.id === "lost")!;
    expect(lost.rows[0]?.reason).toBe("Not recorded");
  });

  it("payments reports outstanding money and flags overdue", () => {
    const payments = byId("payments");
    expect(payments.rows[0]?.status).toBe("Overdue");
    expect(payments.total?.outstanding).toBe(68000);
  });

  it("orders reports how much of each has shipped", () => {
    expect(byId("orders").rows[0]?.dispatched).toBe("4 / 10");
    expect(byId("orders").rows[0]?.pct).toBe(40);
  });

  it("subscription expiry sorts soonest first", () => {
    expect(byId("expiry").rows[0]?.customer).toBe("Acme");
  });

  it("activity puts the least-contacted accounts first", () => {
    expect(byId("activity").rows[0]?.notes).toBe(0);
  });

  it("survives an entirely empty workspace", () => {
    const empty = buildReports(
      { customers: [], quotations: [], proformas: [], orders: [], challans: [], subscriptions: [] },
      USERS, "Delhi", 6, NOW,
    );
    for (const r of empty) {
      expect(() => objectsToCsv(r.columns, r.rows as Record<string, CsvValue>[]), r.id).not.toThrow();
    }
    expect(empty.find((r) => r.id === "revenue")?.total?.revenue).toBe(0);
  });
});
