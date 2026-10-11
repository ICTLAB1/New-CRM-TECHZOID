import { describe, expect, it } from "vitest";
import { NAV } from "./nav";

describe("navigation", () => {
  it("has unique ids across every section", () => {
    const ids = NAV.flatMap((s) => s.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every screen the brief lists", () => {
    const ids = new Set(NAV.flatMap((s) => s.items.map((i) => i.id)));
    for (const required of [
      "dashboard", "pipeline", "customers", "quotations", "proformas",
      "purchase-orders",
      "orders", "dispatch", "subscriptions", "renewals",
      "invoices", "receivables",
      "reports", "activity", "assistant", "incentives",
      "catalog", "team", "integrations", "settings", "components",
    ]) {
      expect(ids, required).toContain(required);
    }
  });

  it("badges only things worth interrupting for", () => {
    // A badge is for work that is due or overdue, never a row count —
    // a permanent number next to every item teaches people to ignore all of them.
    // The numbers are live now (Workbench passes them to the shell), so
    // nothing in the static menu may carry a made-up one.
    const badged = NAV.flatMap((s) => s.items).filter((i) => i.badge !== undefined);
    expect(badged).toEqual([]);
  });

  it("groups by what someone is doing, not by table", () => {
    // "Buy" sits between selling and delivering because that is the order
    // the work happens in: quote the customer, order from the distributor,
    // then despatch. "Find" — cold outreach — comes after selling rather
    // than before it: a salesperson opens the CRM to work the pipeline, not
    // to import a list.
    // "Collect" is the Payment Tracker: a separate section for bills on
    // credit and their automatic reminders, right after getting paid.
    expect(NAV.map((s) => s.label))
      .toEqual(["Sell", "Find", "Buy", "Deliver", "Get paid", "Collect", "Understand", "Administer"]);
  });
});
