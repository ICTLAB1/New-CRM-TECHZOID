import { describe, expect, it } from "vitest";
import {
  deliveriesInProgress, kpis, needsAttention, pipelineFunnel, scopeWorkspace,
  teamPerformance, trailingRevenue, type Workspace,
} from "./dashboard";
import { scopeTo, seesEverything } from "./scope";
import { STAGES } from "../pipeline/stages";
import type { Customer } from "../customers/customer";
import type { SalesDocument } from "../documents/create";
import type { SalesOrder } from "../orders/create";
import type { Subscription } from "../subscriptions/expiry";

const NOW = new Date("2026-08-24T10:00:00");
const at = (iso: string) => new Date(iso + "T00:00:00").getTime();

const customer = (o: Partial<Customer>): Customer => ({ id: "c", ownerId: "u1", ...o } as Customer);
const doc = (o: Partial<SalesDocument>): SalesDocument => ({
  id: "d", number: "TZ/QT/2627/0001", ownerId: "u1", customerId: "c1",
  billName: "Acme", billContact: "", billAddress: "", billState: "Delhi", billCountry: "India",
  billGstin: "", billPan: "", billEmail: "", billPhone: "",
  shipSameAsBilling: true, shipName: "", shipAddress: "", shipState: "", shipCountry: "",
  shipGstin: "", shipPan: "", shipContact: "", shipPhone: "", shipEmail: "",
  currency: "INR", taxType: "gst", referenceNo: "", revisionNo: 0, subject: "",
  date: "2026-08-01", validUntil: "2026-08-16", status: "Draft",
  items: [{ id: "i", qty: 1, rate: 100000, disc: 0, gst: 18 }],
  terms: [], roundOff: false, preparedBy: "", createdAt: 0, updatedAt: 0, ...o,
});

const WS: Workspace = {
  customers: [
    customer({ id: "c1", ownerId: "u1", company: "Acme", stage: "negotiation", value: 500000, nextFollowUp: "2026-08-20" }),
    customer({ id: "c2", ownerId: "u2", company: "Northline", stage: "won", value: 400000, wonAt: at("2026-08-05") }),
    customer({ id: "c3", ownerId: "u1", company: "Sunrise", stage: "won", value: 250000, wonAt: at("2026-06-10") }),
    customer({ id: "c4", ownerId: "u2", company: "Vertex", stage: "lead", value: 900000 }),
    customer({ id: "c5", ownerId: "u1", company: "Closed Co", stage: "lost", value: 100000 }),
  ],
  quotations: [
    doc({ id: "q1", ownerId: "u1", number: "TZ/QT/0001", status: "Sent", validUntil: "2026-09-10" }),
    doc({ id: "q2", ownerId: "u2", number: "TZ/QT/0002", status: "Sent", validUntil: "2026-08-10" }),
    doc({ id: "q3", ownerId: "u1", number: "TZ/QT/0003", status: "Draft" }),
  ],
  proformas: [
    doc({ id: "p1", ownerId: "u1", number: "TZ/PI/0001", status: "Sent", validUntil: "2026-08-10", paymentHistory: [{ amount: 20000 }] }),
    doc({ id: "p2", ownerId: "u2", number: "TZ/PI/0002", status: "Sent", validUntil: "2026-09-30" }),
    doc({ id: "p3", ownerId: "u1", number: "TZ/PI/0003", status: "Draft", validUntil: "2026-01-01" }),
  ],
  orders: [
    { id: "o1", ownerId: "u1", number: "TZ/SO/0001", billName: "Acme", stage: "procurement", items: [{ id: "a", qty: 10 }] } as SalesOrder,
    { id: "o2", ownerId: "u2", number: "TZ/SO/0002", billName: "Northline", stage: "delivered", items: [{ id: "b", qty: 5 }] } as SalesOrder,
  ],
  challans: [{ id: "d1", orderId: "o1", items: [{ itemId: "a", qty: 4 }] }],
  subscriptions: [
    { id: "s1", ownerId: "u1", customerName: "Acme", product: "M365", expiryDate: "2026-08-30", sellPrice: 300000 } as Subscription,
    { id: "s2", ownerId: "u2", customerName: "Northline", product: "Kaspersky", expiryDate: "2026-12-01", sellPrice: 100000 } as Subscription,
  ],
};

describe("scope", () => {
  it("shows a salesperson only their own rows", () => {
    expect(scopeTo(WS.customers, { id: "u1", role: "Sales" }).map((c) => c.id)).toEqual(["c1", "c3", "c5"]);
  });

  it("shows admins, managers and accounts everything", () => {
    for (const role of ["Admin", "Manager", "Accounts"]) {
      expect(seesEverything(role), role).toBe(true);
      expect(scopeTo(WS.customers, { id: "u1", role }), role).toHaveLength(5);
    }
  });

  it("narrows challans by the orders that survived scoping", () => {
    // Challans carry no owner of their own — they follow their order.
    const scoped = scopeWorkspace(WS, { id: "u2", role: "Sales" });
    expect(scoped.orders.map((o) => o.id)).toEqual(["o2"]);
    expect(scoped.challans).toHaveLength(0);
  });

  it("does not mutate the workspace it was given", () => {
    scopeWorkspace(WS, { id: "u1", role: "Sales" });
    expect(WS.customers).toHaveLength(5);
  });
});

describe("KPIs", () => {
  const k = kpis(WS, "Delhi", NOW);

  it("totals open pipeline, excluding won and lost", () => {
    expect(k.openDeals).toBe(2);
    expect(k.openPipeline).toBe(1400000);
  });

  it("counts what was won THIS month, by the won timestamp", () => {
    // c3 was won in June and must not count toward August.
    expect(k.wonThisMonthCount).toBe(1);
    expect(k.wonThisMonth).toBe(400000);
  });

  it("counts quotations still live, and stale ones separately", () => {
    expect(k.quotesPending).toBe(1);
    expect(k.quotesStale).toBe(1);
  });

  it("totals outstanding money on sent proformas only", () => {
    // A draft proforma is not owed by anyone yet.
    expect(k.paymentsDue).toBe(216000);
    expect(k.paymentsOverdue).toBe(1);
  });

  it("counts renewals inside thirty days", () => {
    expect(k.renewalsDue).toBe(1);
    expect(k.renewalsValue).toBe(300000);
  });

  it("reports zeroes for an empty workspace rather than NaN", () => {
    const empty = kpis({ customers: [], quotations: [], proformas: [], orders: [], challans: [], subscriptions: [] }, "Delhi", NOW);
    for (const value of Object.values(empty)) expect(Number.isFinite(value)).toBe(true);
    expect(empty.openPipeline).toBe(0);
  });

  it("shows a salesperson only their own numbers", () => {
    const mine = kpis(scopeWorkspace(WS, { id: "u1", role: "Sales" }), "Delhi", NOW);
    expect(mine.wonThisMonth).toBe(0);
    expect(mine.openDeals).toBe(1);
  });
});

describe("needs attention", () => {
  const rows = needsAttention(WS, "Delhi", NOW);

  it("lists overdue proformas, due follow-ups, stale quotations and renewals", () => {
    expect(new Set(rows.map((r) => r.kind))).toEqual(
      new Set(["overdue-proforma", "follow-up", "stale-quotation", "renewal"]),
    );
  });

  it("puts the most urgent first", () => {
    expect(rows[0]?.kind).toBe("overdue-proforma");
    const urgencies = rows.map((r) => r.urgency);
    expect([...urgencies].sort((a, b) => b - a)).toEqual(urgencies);
  });

  it("carries the screen each row belongs to", () => {
    // A list of problems with no way through to them is a list people stop
    // reading.
    for (const row of rows) expect(row.view, row.kind).toBeTruthy();
    expect(rows.find((r) => r.kind === "renewal")?.view).toBe("renewals");
  });

  it("ignores a draft proforma, however old", () => {
    expect(rows.some((r) => r.title.includes("TZ/PI/0003"))).toBe(false);
  });

  it("ignores a follow-up on a closed deal", () => {
    const ws = { ...WS, customers: [customer({ id: "x", ownerId: "u1", company: "Done", stage: "won", nextFollowUp: "2026-01-01" })] };
    expect(needsAttention(ws, "Delhi", NOW).some((r) => r.kind === "follow-up")).toBe(false);
  });

  it("is empty when nothing needs doing", () => {
    expect(needsAttention({ customers: [], quotations: [], proformas: [], orders: [], challans: [], subscriptions: [] }, "Delhi", NOW)).toEqual([]);
  });
});

describe("trailing revenue", () => {
  const points = trailingRevenue(WS, 6, NOW);

  it("returns one point per month, oldest first, ending this month", () => {
    expect(points).toHaveLength(6);
    expect(points.at(-1)?.key).toBe("2026-08");
    expect(points[0]?.key).toBe("2026-03");
  });

  it("places each deal in the month it was actually won", () => {
    expect(points.find((p) => p.key === "2026-08")?.value).toBe(400000);
    expect(points.find((p) => p.key === "2026-06")?.value).toBe(250000);
    expect(points.find((p) => p.key === "2026-07")?.value).toBe(0);
  });

  it("ignores a won deal with no timestamp rather than dating it today", () => {
    const ws = { ...WS, customers: [customer({ id: "z", ownerId: "u1", stage: "won", value: 999 })] };
    expect(trailingRevenue(ws, 6, NOW).reduce((a, p) => a + p.value, 0)).toBe(0);
  });
});

describe("funnels and team", () => {
  it("counts and values every pipeline stage", () => {
    const funnel = pipelineFunnel(WS, STAGES);
    expect(funnel).toHaveLength(STAGES.length);
    expect(funnel.find((s) => s.id === "won")?.count).toBe(2);
    expect(funnel.find((s) => s.id === "lead")?.value).toBe(900000);
  });

  it("ranks the team by what they have won", () => {
    const team = teamPerformance(WS, [{ id: "u1", name: "Priyanshi" }, { id: "u2", name: "Rashmi" }], NOW);
    expect(team.map((t) => t.name)).toEqual(["Rashmi", "Priyanshi"]);
    expect(team[0]?.wonValue).toBe(400000);
  });

  it("leaves out a user with nothing to show", () => {
    const team = teamPerformance(WS, [{ id: "u9", name: "Nobody" }], NOW);
    expect(team).toEqual([]);
  });

  it("lists deliveries still in progress with how far along they are", () => {
    const rows = deliveriesInProgress(WS);
    expect(rows.map((r) => r.number)).toEqual(["TZ/SO/0001"]);
    expect(rows[0]?.pct).toBe(40);
  });
});

describe("a deal that was won and then lost", () => {
  /* THE REGRESSION THIS EXISTS FOR. Making a win survive re-engagement was
     written as "stage is won, OR there is a wonAt" — which also takes in
     every customer who was marked Won and later marked Lost, because the
     stamp is deliberately never cleared. On a live board that put a lost
     ₹39.76 L deal into "Won this month", so the tile read ₹42.21 L while
     the funnel three inches below it read ₹3.03 L for the same deals.

     The fixture below is that board's shape: a lost deal far larger than
     everything won. */
  const churned: Workspace = {
    ...WS,
    customers: [
      customer({ id: "w1", ownerId: "u1", company: "Piramal", stage: "won", value: 131000, wonAt: at("2026-08-05") }),
      customer({ id: "w2", ownerId: "u1", company: "Thinvent", stage: "won", value: 62000, wonAt: at("2026-08-06") }),
      customer({ id: "l1", ownerId: "u1", company: "Nangia & Co", stage: "lost", value: 3976000, wonAt: at("2026-08-07") }),
    ],
  };

  it("is not revenue this month", () => {
    expect(kpis(churned, "Delhi", NOW).wonThisMonth).toBe(193000);
    expect(kpis(churned, "Delhi", NOW).wonThisMonthCount).toBe(2);
  });

  it("agrees with the Won column on the board", () => {
    // The tile and the funnel are counting the same two deals here, so a
    // reader looking at both at once must not see two different figures.
    const funnelWon = pipelineFunnel(churned, STAGES).find((s) => s.id === "won");
    expect(funnelWon?.value).toBe(kpis(churned, "Delhi", NOW).wonThisMonth);
  });

  it("is not revenue in the trailing chart either", () => {
    const august = trailingRevenue(churned, 6, NOW).at(-1);
    expect(august?.value).toBe(193000);
  });

  it("still counts a customer quoted again after winning", () => {
    // The case the change was made for, which must keep working: a won
    // customer moved back into the pipeline by a fresh quotation.
    const requoted: Workspace = {
      ...WS,
      customers: [customer({ id: "r1", ownerId: "u1", company: "Northline", stage: "quoted", value: 900000, wonValue: 412500, wonAt: at("2026-08-05") })],
    };
    expect(kpis(requoted, "Delhi", NOW).wonThisMonth).toBe(412500);
  });
});
