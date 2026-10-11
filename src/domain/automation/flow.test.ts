import { describe, it, expect } from "vitest";
import { AUTOMATION_START, ADMIN_GRACE_MS, planAutomations, nextFollowUpDate, type FlowInput } from "./flow";
import type { SalesDocument } from "../documents/create";
import type { SalesOrder } from "../orders/create";

const NOW = AUTOMATION_START + 86_400_000;
const me = { id: "u1", role: "Sales" };

const doc = (over: Partial<SalesDocument> & Record<string, unknown>): SalesDocument =>
  ({ id: "q1", number: "QT/1", ownerId: "u1", customerId: "c1", status: "Draft", items: [],
     createdAt: NOW - 1000, updatedAt: NOW - 500, validUntil: "2026-12-31", ...over }) as unknown as SalesDocument;

const order = (over: Partial<SalesOrder> & Record<string, unknown>): SalesOrder =>
  ({ id: "o1", number: "SO/1", ownerId: "u1", customerId: "c1", stage: "confirmed", items: [],
     createdAt: NOW - 1000, updatedAt: NOW - 500, ...over }) as unknown as SalesOrder;

const base = (over: Partial<FlowInput> = {}): FlowInput => ({
  customers: [{ id: "c1", ownerId: "u1", stage: "lead" }],
  quotations: [], proformas: [], invoices: [], orders: [], subscriptions: [],
  me, today: "2026-10-12", now: NOW, grandOf: () => 1000,
  ...over,
});

describe("stages move themselves", () => {
  it("a sent quotation moves the customer to Quotation Sent", () => {
    const steps = planAutomations(base({ quotations: [doc({ status: "Sent" })] }));
    expect(steps.find((s) => s.kind === "stage")).toMatchObject({ stage: "quoted" });
  });

  it("an accepted quotation marks the deal Won, with its value", () => {
    const steps = planAutomations(base({ quotations: [doc({ status: "Accepted" })] }));
    expect(steps.find((s) => s.kind === "stage")).toMatchObject({ stage: "won", value: 1000 });
  });

  it("does it once: a stamped document is left alone", () => {
    const steps = planAutomations(base({ quotations: [doc({ status: "Accepted", auto: { won: 1, orderId: "o9" } })] }));
    expect(steps.filter((s) => s.kind === "stage" || s.kind === "order")).toEqual([]);
  });

  it("never replays history from before automations were switched on", () => {
    const steps = planAutomations(base({ quotations: [doc({ status: "Accepted", updatedAt: AUTOMATION_START - 1 })] }));
    expect(steps).toEqual([]);
  });
});

describe("the document chain", () => {
  it("an accepted quotation becomes a sales order", () => {
    const steps = planAutomations(base({ quotations: [doc({ status: "Accepted" })] }));
    expect(steps.find((s) => s.kind === "order")).toMatchObject({ from: "quotation" });
  });

  it("not when an order already exists for it", () => {
    const steps = planAutomations(base({
      quotations: [doc({ status: "Accepted" })],
      orders: [order({ quoteId: "q1", updatedAt: 0 })],
    }));
    expect(steps.find((s) => s.kind === "order")).toBeUndefined();
  });

  it("a paid proforma whose quotation already became an order makes no second one", () => {
    const steps = planAutomations(base({
      proformas: [doc({ id: "p1", status: "Paid", quoteId: "q1" })],
      orders: [order({ quoteId: "q1", updatedAt: 0 })],
    }));
    expect(steps.find((s) => s.kind === "order")).toBeUndefined();
  });

  it("a delivered order gets its invoice drafted, once", () => {
    const pf = doc({ id: "p1", status: "Paid", auto: { won: 1, orderId: "o1" } });
    const steps = planAutomations(base({ proformas: [pf], orders: [order({ stage: "delivered", proformaId: "p1" })] }));
    expect(steps.find((s) => s.kind === "invoice")).toMatchObject({ source: { id: "p1" } });

    const again = planAutomations(base({
      proformas: [pf],
      orders: [order({ stage: "delivered", proformaId: "p1" })],
      invoices: [doc({ id: "i1", quoteId: "p1", status: "Draft" })],
    }));
    expect(again.find((s) => s.kind === "invoice")).toBeUndefined();
  });
});

describe("tasks", () => {
  it("a sent quotation gets a follow-up three days out", () => {
    const steps = planAutomations(base({ quotations: [doc({ status: "Sent" })] }));
    expect(steps.find((s) => s.kind === "task")).toMatchObject({ due: "2026-10-15" });
  });

  it("an overdue unpaid invoice raises a collection task for that due date only", () => {
    const inv = doc({ id: "i1", status: "Issued", validUntil: "2026-10-01" });
    expect(planAutomations(base({ invoices: [inv] })).find((s) => s.kind === "task")).toBeTruthy();
    const stamped = doc({ id: "i1", status: "Issued", validUntil: "2026-10-01", auto: { overdueFor: "2026-10-01" } });
    expect(planAutomations(base({ invoices: [stamped] })).find((s) => s.kind === "task")).toBeUndefined();
  });

  it("someone else's record is not mine — unless I am an admin and they have not been in", () => {
    const theirs = doc({ ownerId: "u2", status: "Sent" });
    expect(planAutomations(base({ quotations: [theirs] }))).toEqual([]);
    const stale = doc({ ownerId: "u2", status: "Sent", updatedAt: NOW - ADMIN_GRACE_MS - 1 });
    expect(planAutomations(base({ quotations: [stale], me: { id: "a", role: "Admin" } })).length).toBeGreaterThan(0);
  });

  it("keeps the earlier follow-up date, but replaces one already past", () => {
    expect(nextFollowUpDate("2026-10-13", "2026-10-15", "2026-10-12")).toBe("2026-10-13");
    expect(nextFollowUpDate("2026-10-01", "2026-10-15", "2026-10-12")).toBe("2026-10-15");
    expect(nextFollowUpDate(undefined, "2026-10-15", "2026-10-12")).toBe("2026-10-15");
  });
});
