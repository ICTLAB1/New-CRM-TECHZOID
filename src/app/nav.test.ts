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
      "orders", "dispatch", "subscriptions", "renewals",
      "reports", "activity", "assistant", "catalog", "team", "integrations", "settings", "components",
    ]) {
      expect(ids, required).toContain(required);
    }
  });

  it("badges only things worth interrupting for", () => {
    // A badge is for work that is due or overdue, never a row count —
    // a permanent number next to every item teaches people to ignore all of them.
    const badged = NAV.flatMap((s) => s.items).filter((i) => i.badge !== undefined);
    expect(badged.map((i) => i.id).sort()).toEqual(["proformas", "renewals"]);
    for (const item of badged) expect(item.badge).toBeGreaterThan(0);
  });

  it("groups by what someone is doing, not by table", () => {
    expect(NAV.map((s) => s.label)).toEqual(["Sell", "Deliver", "Understand", "Administer"]);
  });
});
