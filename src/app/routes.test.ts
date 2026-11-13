import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HOME, VIEWS, pathForView, viewForPath, viewOnArrival } from "./routes";

/**
 * The Back button has to mean something inside the CRM. That starts with
 * every screen having an address of its own.
 */

describe("a screen's address", () => {
  it("puts the dashboard at the root", () => {
    expect(pathForView("dashboard")).toBe("/");
    expect(pathForView("")).toBe("/");
  });

  it("gives every other screen its own path", () => {
    expect(pathForView("quotations")).toBe("/quotations");
    expect(pathForView("purchase-orders")).toBe("/purchase-orders");
  });

  it("round-trips every screen there is", () => {
    for (const view of VIEWS) expect(viewForPath(pathForView(view))).toBe(view);
  });

  it("refuses to invent a path for a screen that does not exist", () => {
    /* A typo in a navigation call would otherwise put a URL in the address
       bar that resolves to nothing on reload. */
    expect(pathForView("quotatoins")).toBe("/");
  });
});

describe("reading a path", () => {
  it("reads the root as home", () => {
    expect(viewForPath("/")).toBe(HOME);
    expect(viewForPath("")).toBe(HOME);
  });

  it("is forgiving about a trailing slash and about case", () => {
    expect(viewForPath("/quotations/")).toBe("quotations");
    expect(viewForPath("/Quotations")).toBe("quotations");
  });

  /* THE PATHS THAT ARE NOT SCREENS. A customer arriving on a portal link
     and a stranger on a registration link are answered before the CRM is
     rendered at all; this must never claim one of them. */
  it("leaves the public links alone", () => {
    expect(viewForPath("/p/Xk3p_QabcdefghijklmnopqrstuvwxyZ01234")).toBe("");
    expect(viewForPath("/r/K7QM2P")).toBe("");
  });

  it("says nothing rather than guessing at a path it does not know", () => {
    expect(viewForPath("/whatever")).toBe("");
    expect(viewForPath("/quotations/42")).toBe("");
    expect(viewForPath("/api/q")).toBe("");
  });

  it("falls back to home when somebody arrives on a path that is not ours", () => {
    expect(viewOnArrival("/whatever")).toBe(HOME);
    expect(viewOnArrival("/quotations")).toBe("quotations");
  });
});

describe("the list stays in step with the screens that exist", () => {
  it("has an address for every screen the workbench can show", () => {
    /* A screen added to the workbench and forgotten here would resolve to
       "/" — no address of its own, nothing for Back to return to, and a
       bookmark that lands on the dashboard. Read from the source rather
       than kept in somebody's head. */
    const source = readFileSync("src/app/Workbench.tsx", "utf8");
    const rendered = [...source.matchAll(/view === "([a-z-]+)"/g)].map((m) => m[1]!);
    expect(rendered.length).toBeGreaterThan(20);
    for (const view of new Set(rendered)) expect(VIEWS).toContain(view);
  });

  it("names no screen the workbench cannot show", () => {
    const source = readFileSync("src/app/Workbench.tsx", "utf8");
    for (const view of VIEWS) {
      if (view === HOME) continue;
      expect(source).toContain(`view === "${view}"`);
    }
  });
});
