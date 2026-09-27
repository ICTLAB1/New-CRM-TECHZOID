import { describe, expect, it } from "vitest";
import {
  blankDeal, closesWithin, forecast, isOpenDeal, likelihood, rollUpStage,
  setStage, STAGE_PROBABILITY, weightedValue, type Deal,
} from "./deal";

const deal = (o: Partial<Deal> = {}): Deal => ({
  ...blankDeal("u1", "c1", { currency: "INR" }, new Date("2026-09-27T00:00:00Z")),
  name: "Microsoft 365 E3 renewal", value: 100000, expectedClose: "2026-10-15", ...o,
});

describe("likelihood", () => {
  it("comes from the stage when nobody has said otherwise", () => {
    expect(likelihood(deal({ stage: "qualified" }))).toBe(STAGE_PROBABILITY.qualified);
  });

  it("takes an explicit figure over the stage's", () => {
    expect(likelihood(deal({ stage: "lead", probability: 75 }))).toBe(75);
  });

  it("ignores an explicit figure once the deal is concluded", () => {
    /* Somebody who typed 75% meant it while the deal was open. Reading it
       afterwards would put a lost deal back into the forecast. */
    expect(likelihood(deal({ stage: "lost", probability: 75 }))).toBe(0);
    expect(likelihood(deal({ stage: "won", probability: 75 }))).toBe(100);
  });

  it("refuses a figure outside 0–100 rather than forecasting on it", () => {
    expect(likelihood(deal({ stage: "lead", probability: 400 }))).toBe(100);
    expect(likelihood(deal({ stage: "lead", probability: -20 }))).toBe(0);
    expect(likelihood(deal({ stage: "lead", probability: Number.NaN }))).toBe(STAGE_PROBABILITY.lead);
  });
});

describe("weighted value", () => {
  it("discounts by how likely the deal is", () => {
    expect(weightedValue(deal({ stage: "negotiation", value: 100000 }))).toBe(80000);
  });

  it("counts a won deal in full and a lost one not at all", () => {
    expect(weightedValue(deal({ stage: "won", value: 100000 }))).toBe(100000);
    expect(weightedValue(deal({ stage: "lost", value: 100000 }))).toBe(0);
  });
});

describe("forecast", () => {
  const window = ["2026-10-01", "2026-10-31"] as const;

  it("buckets by expected close, not by when the deal was raised", () => {
    const deals = [deal({ expectedClose: "2026-10-15" }), deal({ id: "d2", expectedClose: "2026-12-01" })];
    expect(forecast(deals, ...window).open[0]?.count).toBe(1);
  });

  it("includes both ends of the window", () => {
    expect(closesWithin({ expectedClose: "2026-10-01" }, ...window)).toBe(true);
    expect(closesWithin({ expectedClose: "2026-10-31" }, ...window)).toBe(true);
    expect(closesWithin({ expectedClose: "2026-09-30" }, ...window)).toBe(false);
  });

  it("never adds one currency to another", () => {
    /* A dollar deal added to a rupee one is wrong by the whole of the
       dollar one and looks authoritative doing it. */
    const deals = [
      deal({ value: 100000, currency: "INR", stage: "negotiation" }),
      deal({ id: "d2", value: 5000, currency: "USD", stage: "negotiation" }),
    ];
    const f = forecast(deals, ...window);
    expect(f.weighted.map((t) => [t.code, t.total])).toEqual([[ "INR", 80000 ], [ "USD", 4000 ]]);
  });

  it("separates what is committed from what is merely hoped for", () => {
    const deals = [
      deal({ id: "w", stage: "won", value: 50000 }),
      deal({ id: "o", stage: "quoted", value: 100000 }),
      deal({ id: "l", stage: "lost", value: 70000 }),
    ];
    const f = forecast(deals, ...window);
    expect(f.won[0]?.total).toBe(50000);
    expect(f.open[0]?.total).toBe(100000);
    expect(f.weighted[0]?.total).toBe(60000);
    expect(f.lost[0]?.total).toBe(70000);
  });
});

describe("the stage shown against a customer who has several deals", () => {
  it("is the furthest-along open one", () => {
    expect(rollUpStage([
      { stage: "lead", concludedAt: null },
      { stage: "negotiation", concludedAt: null },
      { stage: "qualified", concludedAt: null },
    ])).toBe("negotiation");
  });

  it("ignores concluded deals while anything is still open", () => {
    /* THE CASE THE OLD MODEL COULD NOT HOLD. A customer who bought last
       year and is being quoted again is in the pipeline, not Won. */
    expect(rollUpStage([
      { stage: "won", concludedAt: 1_000 },
      { stage: "quoted", concludedAt: null },
    ])).toBe("quoted");
  });

  it("falls back to the most recent conclusion", () => {
    expect(rollUpStage([
      { stage: "lost", concludedAt: 1_000 },
      { stage: "won", concludedAt: 2_000 },
    ])).toBe("won");
  });

  it("prefers a win to a loss concluded at the same moment", () => {
    expect(rollUpStage([
      { stage: "lost", concludedAt: 5_000 },
      { stage: "won", concludedAt: 5_000 },
    ])).toBe("won");
  });

  it("says nothing for a customer with no deals at all", () => {
    expect(rollUpStage([])).toBeNull();
  });
});

describe("moving a deal", () => {
  it("stamps when it was concluded", () => {
    const d = setStage(deal(), "won", 1234);
    expect(d.stage).toBe("won");
    expect(d.concludedAt).toBe(1234);
  });

  it("clears the stamp when a deal is reopened", () => {
    /* Left behind, it would keep the deal out of the open pipeline while
       it sat on the board in Negotiation. */
    const won = setStage(deal(), "won", 1234);
    const reopened = setStage(won, "negotiation", 5678);
    expect(reopened.concludedAt).toBeNull();
    expect(isOpenDeal(reopened)).toBe(true);
  });

  it("drops a lost reason that no longer applies", () => {
    const lost = setStage({ ...deal(), lostReason: "Price too high" }, "lost", 1);
    expect(setStage(lost, "negotiation", 2).lostReason).toBe("");
  });

  it("goes backwards, which the customer board could not", () => {
    /* advance.ts refuses to move a customer back, and had to: one stage
       per company meant a backwards move would overwrite a decision about
       a different deal. A deal is its own record. */
    expect(setStage(deal({ stage: "negotiation" }), "qualified").stage).toBe("qualified");
  });

  it("leaves a deal alone when the stage has not changed", () => {
    const d = deal({ stage: "quoted" });
    expect(setStage(d, "quoted")).toBe(d);
  });
});
