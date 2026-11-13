import { describe, expect, it } from "vitest";
import {
  OUTCOMES, outcomesFor, stageAfterOutcome, statusAfterOutcome, wonValueFor,
} from "./outcome";

/**
 * One fact about a deal, applied in four places. These are the rules that
 * decide what each of them gets.
 */

describe("the status an outcome leaves on the quotation", () => {
  it("writes Accepted for an agreement and for a win", () => {
    /* A win is not a sixth status: the customer accepted the quotation, and
       where the DEAL stands is the customer's stage. */
    expect(statusAfterOutcome("accepted")).toBe("Accepted");
    expect(statusAfterOutcome("won")).toBe("Accepted");
  });

  it("writes Rejected for a loss", () => {
    expect(statusAfterOutcome("lost")).toBe("Rejected");
  });
});

describe("where the customer goes", () => {
  it("records a win and a loss from anywhere, because somebody decided it", () => {
    for (const from of ["", "lead", "quoted", "negotiation", "lost"]) {
      expect(stageAfterOutcome("won", from)).toBe("won");
    }
    for (const from of ["", "lead", "quoted", "negotiation", "won"]) {
      expect(stageAfterOutcome("lost", from)).toBe("lost");
    }
  });

  it("leaves a deal alone when the outcome is the one it already has", () => {
    /* Pressing Won twice must not re-stamp the date it was won. */
    expect(stageAfterOutcome("won", "won")).toBeNull();
    expect(stageAfterOutcome("lost", "lost")).toBeNull();
  });

  it("moves an agreed deal one step along, from wherever it is", () => {
    expect(stageAfterOutcome("accepted", "lead")).toBe("negotiation");
    expect(stageAfterOutcome("accepted", "quoted")).toBe("negotiation");
    expect(stageAfterOutcome("accepted", undefined)).toBe("negotiation");
  });

  it("never drags a deal backwards, and never reopens a concluded one", () => {
    /* Tidying up an old quotation must not put a won customer back on the
       board, nor pull somebody out of Negotiation. */
    expect(stageAfterOutcome("accepted", "negotiation")).toBeNull();
    expect(stageAfterOutcome("accepted", "won")).toBeNull();
    expect(stageAfterOutcome("accepted", "lost")).toBeNull();
  });
});

describe("which buttons a row offers", () => {
  it("offers all three on a quotation nobody has decided", () => {
    expect(outcomesFor({ status: "Sent" }, "quoted")).toEqual(OUTCOMES);
    expect(outcomesFor({ status: "Draft" }, undefined)).toEqual(OUTCOMES);
  });

  it("drops the one already recorded", () => {
    expect(outcomesFor({ status: "Accepted" }, "negotiation")).toEqual(["won", "lost"]);
    expect(outcomesFor({ status: "Accepted" }, "won")).toEqual(["lost"]);
    expect(outcomesFor({ status: "Rejected" }, "lost")).toEqual(["accepted", "won"]);
  });

  it("still offers a win on a quotation marked rejected", () => {
    /* The commonest correction there is: marked lost, then the purchase
       order turns up. */
    expect(outcomesFor({ status: "Rejected" }, "quoted")).toContain("won");
    expect(outcomesFor({ status: "Rejected" }, "quoted")).toContain("lost");
  });
});

describe("what a win is worth", () => {
  it("keeps a figure somebody typed about the deal", () => {
    expect(wonValueFor({ value: 250000 }, 90000)).toBe(250000);
    expect(wonValueFor({ value: "250000" }, 90000)).toBe(250000);
  });

  it("falls back to the quotation's total, so the win is not worth nothing", () => {
    /* Every customer created from a quotation has no value of its own. A
       win snapshotted at zero is three won deals and an empty revenue
       report, which is exactly what this stops. */
    expect(wonValueFor({}, 429992)).toBe(429992);
    expect(wonValueFor(null, 429992)).toBe(429992);
    expect(wonValueFor({ value: 0 }, 429992)).toBe(429992);
  });

  it("freezes nothing when there is no number anywhere", () => {
    /* Undefined lets the live value through later; a zero would block it
       for ever. */
    expect(wonValueFor({}, 0)).toBeUndefined();
    expect(wonValueFor({ value: "" }, 0)).toBeUndefined();
  });
});
