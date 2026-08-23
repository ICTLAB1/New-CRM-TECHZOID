import { describe, expect, it } from "vitest";
import { buildTimeline, filterTimeline, groupByDay } from "./timeline";
import type { Workspace } from "../analytics/dashboard";

const at = (iso: string) => new Date(iso + "T10:00:00+05:30").getTime();

const workspace = {
  customers: [
    {
      id: "c1", ownerId: "u1", company: "Acme", stage: "won",
      notes: [
        { id: "n1", ts: at("2026-08-20"), type: "Call", text: "Spoke to Rajesh", user: "Asha", userId: "u1", outcome: "Interested", nextAction: "Send revised pricing" },
        { id: "n2", ts: at("2026-08-18"), type: "Note", text: "Budget approved", user: "Asha", userId: "u1" },
      ],
    },
    {
      id: "c2", ownerId: "u2", company: "Beta Corp", stage: "lead",
      notes: [{ id: "n3", ts: at("2026-08-19"), type: "Email", text: "Sent brochure", user: "Ravi", userId: "u2" }],
    },
  ],
  quotations: [
    { id: "q1", number: "TZ/QT/2627/0001", ownerId: "u1", customerId: "c1", billName: "Acme", subject: "Laptops", status: "Sent", createdAt: at("2026-08-20"), items: [] },
  ],
  proformas: [],
  orders: [
    { id: "o1", number: "SO/2627/0007", ownerId: "u1", customerId: "c1", billName: "Acme", stage: "confirmed", createdAt: at("2026-08-17"), items: [] },
  ],
  challans: [{ id: "d1", orderId: "o1", number: "DC/2627/0003", status: "Delivered", createdAt: at("2026-08-21") }],
  subscriptions: [
    { id: "s1", ownerId: "u2", customerId: "c2", product: "Microsoft 365", vendor: "Microsoft", seats: 25, status: "Active", createdAt: at("2026-08-16") },
  ],
} as unknown as Workspace;

const ADMIN = { id: "u9", role: "Admin" };
const SALES = { id: "u1", role: "Sales" };
const NOW = new Date("2026-08-23T10:00:00+05:30");

describe("building the timeline", () => {
  const events = buildTimeline(workspace, "Delhi");

  it("merges typed notes with what the app recorded", () => {
    expect(events.filter((e) => e.logged)).toHaveLength(3);
    expect(events.filter((e) => !e.logged)).toHaveLength(4);
  });

  it("puts the newest first", () => {
    const stamps = events.map((e) => e.ts);
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
    expect(events[0]?.title).toContain("DC/2627/0003");
  });

  it("keeps what came of a logged call", () => {
    const call = events.find((e) => e.kind === "Call");
    expect(call?.outcome).toBe("Interested");
    expect(call?.nextAction).toBe("Send revised pricing");
    expect(call?.who).toBe("Asha");
  });

  it("takes a challan's customer and owner from its order", () => {
    const challan = events.find((e) => e.kind === "challan");
    expect(challan?.customerName).toBe("Acme");
    expect(challan?.ownerId).toBe("u1");
    expect(challan?.detail).toBe("Against order SO/2627/0007");
  });

  it("gives every event a unique id, so two records cannot collide", () => {
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("filtering", () => {
  const events = buildTimeline(workspace, "Delhi");

  it("shows a Sales user their own work only", () => {
    const mine = filterTimeline(events, {}, SALES, NOW);
    expect(mine.some((e) => e.customerName === "Beta Corp")).toBe(false);
    expect(mine.some((e) => e.customerName === "Acme")).toBe(true);
  });

  it("shows an admin everything", () => {
    expect(filterTimeline(events, {}, ADMIN, NOW)).toHaveLength(events.length);
  });

  it("narrows by kind, by customer and by person", () => {
    expect(filterTimeline(events, { kind: "Call" }, ADMIN, NOW)).toHaveLength(1);
    expect(filterTimeline(events, { customerId: "c2" }, ADMIN, NOW)).toHaveLength(2);
    expect(filterTimeline(events, { ownerId: "u2" }, ADMIN, NOW)).toHaveLength(2);
  });

  it("narrows by how long ago", () => {
    expect(filterTimeline(events, { withinDays: 4 }, ADMIN, NOW).length).toBeLessThan(events.length);
    expect(filterTimeline(events, { withinDays: 0 }, ADMIN, NOW)).toHaveLength(events.length);
  });

  it("searches the text, the customer and the person", () => {
    expect(filterTimeline(events, { search: "rajesh" }, ADMIN, NOW)).toHaveLength(1);
    expect(filterTimeline(events, { search: "Beta" }, ADMIN, NOW)).toHaveLength(2);
    expect(filterTimeline(events, { search: "nothing here" }, ADMIN, NOW)).toHaveLength(0);
  });
});

describe("grouping", () => {
  it("groups consecutive events by day, newest day first", () => {
    const days = groupByDay(filterTimeline(buildTimeline(workspace, "Delhi"), {}, ADMIN, NOW));
    expect(days[0]?.key).toBe("2026-08-21");
    expect(days.map((d) => d.key)).toEqual([...days.map((d) => d.key)].sort().reverse());
    expect(days.reduce((a, d) => a + d.events.length, 0)).toBe(7);
  });

  it("puts an undated record at the end rather than in 1970", () => {
    const days = groupByDay([
      { id: "a", ts: at("2026-08-20"), kind: "Note", title: "A", logged: true },
      { id: "b", ts: 0, kind: "Note", title: "B", logged: true },
    ]);
    expect(days[days.length - 1]?.label).toBe("Undated");
  });
});
