import { describe, expect, it } from "vitest";
import { filterNav, firstMatch } from "./launcherSearch";
import { NAV } from "./nav";

/**
 * The App Launcher's search.
 *
 * A launcher that quietly stops finding a screen is a fault nobody
 * reports: people go back to the rail and decide the box does not work.
 */

const ids = (q: string): string[] => filterNav(q).flatMap((s) => s.items.map((i) => i.id));
const labels = (q: string): string[] => filterNav(q).map((s) => s.label);

describe("an empty box", () => {
  it("shows every section", () => {
    expect(labels("")).toEqual(NAV.map((s) => s.label));
  });

  it("treats a box of spaces as empty rather than matching nothing", () => {
    expect(ids("   ")).toEqual(ids(""));
  });

  it("LEAVES OUT THE COMPONENT GALLERY, which is a developer page", () => {
    expect(ids("")).not.toContain("components");
    /* And it is genuinely in the nav, so this is filtering rather than a
       test that would pass if the item were simply deleted. */
    expect(NAV.flatMap((s) => s.items.map((i) => i.id))).toContain("components");
  });
});

describe("typing", () => {
  it("finds a screen by part of its name", () => {
    expect(ids("quot")).toEqual(["quotations"]);
  });

  it("ignores case", () => {
    expect(ids("QUOT")).toEqual(["quotations"]);
  });

  it("MATCHES EVERY TERM, so two words narrow rather than widen", () => {
    /* The opposite — any-term — is the common bug: "purchase orders"
       would then also return every other order screen. */
    expect(ids("pur ord")).toEqual(["purchase-orders"]);
  });

  it("finds a screen through the section it is in", () => {
    /* Somebody who knows the shape of the business but not the name of
       the screen still gets there. */
    const out = filterNav("deliver");
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("Deliver");
    expect(out[0]!.items.map((i) => i.id)).toEqual(["orders", "dispatch", "subscriptions", "renewals"]);
  });

  it("drops a section with nothing left in it", () => {
    /* Eight headings over one result reads as a broken search. */
    for (const sec of filterNav("quot")) expect(sec.items.length).toBeGreaterThan(0);
    expect(labels("quot")).toEqual(["Sell"]);
  });

  it("returns nothing at all for a query that matches nothing", () => {
    expect(filterNav("zzzznope")).toEqual([]);
  });

  it("keeps the nav's own order rather than ranking", () => {
    /* A launcher people learn by position must not reshuffle itself. */
    expect(labels("s")).toEqual(labels("s").slice().sort((a, b) =>
      NAV.findIndex((s) => s.label === a) - NAV.findIndex((s) => s.label === b)));
  });
});

describe("what Enter opens", () => {
  it("is the first destination on screen", () => {
    expect(firstMatch(filterNav("quot"))).toBe("quotations");
  });

  it("is nothing when nothing matched", () => {
    expect(firstMatch(filterNav("zzzznope"))).toBeNull();
  });

  it("READS THE FILTERED LIST, so it cannot open something not shown", () => {
    /* Searching again inside this function is the bug it exists to
       avoid: Enter would then open a screen the person cannot see. */
    const shown = filterNav("deliver");
    expect(firstMatch(shown)).toBe(shown[0]!.items[0]!.id);
  });
});
