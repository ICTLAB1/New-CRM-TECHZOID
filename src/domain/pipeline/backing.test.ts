import { describe, expect, it } from "vitest";
import { backingFor, backingNote, unbackedWins } from "./backing";

/* The shapes taken from a live workspace, which is where this came from:
   two deals marked won on the same day with nothing raised against either,
   and one that was genuinely delivered. */
const WS = {
  quotations: [{ customerId: "orbit" }, { customerId: "thinvent" }],
  proformas: [{ customerId: "paradise" }, { customerId: "thinvent" }],
  invoices: [{ customerId: "siddhi" }],
  orders: [{ customerId: "thinvent" }, { customerId: "thinvent" }],
};

const won = (id: string, wonAt = 1000) => ({ id, stage: "won", wonAt });

describe("whether a win is backed by anything", () => {
  it("an order backs it", () => {
    const b = backingFor("thinvent", WS);
    expect(b.orders).toBe(2);
    expect(b.backed).toBe(true);
    expect(backingNote(b)).toBe("");
  });

  it("so does a tax invoice on its own", () => {
    expect(backingFor("siddhi", WS).backed).toBe(true);
  });

  /* THE DISTINCTION THAT MATTERS. A quotation is us asking; an order is them
     agreeing. "Quotations sent, not orders closed" is exactly the complaint
     this exists to answer, so a quotation must never count as backing. */
  it("a quotation does NOT back it", () => {
    const b = backingFor("orbit", WS);
    expect(b.quotations).toBe(1);
    expect(b.backed).toBe(false);
    expect(backingNote(b)).toBe("Marked won on a quotation — no order or invoice yet");
  });

  it("nor does a proforma, though it says so differently", () => {
    const b = backingFor("paradise", WS);
    expect(b.backed).toBe(false);
    expect(b.nothingRaised).toBe(false);
    expect(backingNote(b)).toBe("Marked won on a proforma — no order or invoice yet");
  });

  it("names the worst case plainly: nothing was ever raised", () => {
    const b = backingFor("metrro", WS);
    expect(b.nothingRaised).toBe(true);
    expect(backingNote(b)).toBe("Marked won, but nothing was ever raised against it");
  });
});

describe("finding the wins nothing stands behind", () => {
  const customers = [
    won("metrro"), won("oriental"), won("thinvent"), won("siddhi"), won("orbit"),
    { id: "still-open", stage: "quoted" },
    { id: "lost-one", stage: "lost", wonAt: 1000 },
  ];

  it("lists only the unbacked ones", () => {
    expect(unbackedWins(customers, WS).map((r) => r.customer.id))
      .toEqual(["metrro", "oriental", "orbit"]);
  });

  it("ignores a deal that was never won", () => {
    expect(unbackedWins(customers, WS).some((r) => r.customer.id === "still-open")).toBe(false);
  });

  /* countsAsWon() refuses a lost deal, and this reads countsAsWon rather than
     the stage — the question is what the REPORTS are counting, not which
     column a card sits in. */
  it("ignores a lost deal even though it carries a won stamp", () => {
    expect(unbackedWins(customers, WS).some((r) => r.customer.id === "lost-one")).toBe(false);
  });

  /* A customer re-quoted after winning is off the Won column but still
     counted as revenue, so an unbacked one still has to surface. */
  it("catches a re-quoted customer whose win is still being counted", () => {
    const requoted = [{ id: "metrro", stage: "quoted", wonAt: 1000 }];
    expect(unbackedWins(requoted, WS).map((r) => r.customer.id)).toEqual(["metrro"]);
  });

  it("can be limited to recent wins", () => {
    expect(unbackedWins(customers, WS, 5000)).toEqual([]);
  });

  it("says nothing about a workspace with no documents loaded", () => {
    expect(unbackedWins([won("anyone")], {})[0]?.backing.nothingRaised).toBe(true);
  });
});
