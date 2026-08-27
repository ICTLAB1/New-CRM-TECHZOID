import { describe, expect, it } from "vitest";
import { advancesPipeline, concludedAt, isConcluded, stageAfterQuotation } from "./advance";
import { applyStage, countsAsWon, wonAmount } from "./stages";

/** The shape applyStage reads and writes. Spelled out so the tests can
 *  assert on stamps a bare object literal would not be typed to carry. */
interface Deal {
  stage?: string;
  value?: number | string;
  wonAt?: number;
  wonValue?: number;
  lostAt?: number;
}
const deal = (d: Deal): Deal => d;

/** A timestamp N days into an arbitrary but fixed month, so the tests read
 *  as "this happened before that" rather than as arithmetic. */
const day = (n: number): number => Date.UTC(2026, 0, n);

describe("moving a customer when a quotation goes out", () => {
  it("moves everyone who has not been quoted yet", () => {
    expect(stageAfterQuotation("lead")).toBe("quoted");
    expect(stageAfterQuotation("contacted")).toBe("quoted");
    expect(stageAfterQuotation("qualified")).toBe("quoted");
  });

  it("treats a record with no stage as a lead", () => {
    // Legacy rows predate some of these ids, and the board already reads
    // them as Lead.
    expect(stageAfterQuotation(undefined)).toBe("quoted");
    expect(stageAfterQuotation(null)).toBe("quoted");
    expect(stageAfterQuotation("")).toBe("quoted");
    expect(stageAfterQuotation("something-else")).toBe("quoted");
  });

  it("leaves a customer who is already there", () => {
    expect(stageAfterQuotation("quoted")).toBeNull();
  });

  it("NEVER drags a deal backwards", () => {
    // A revised quotation for a deal in Negotiation is normal. Pulling it
    // back to Quotation Sent would rewrite where the deal actually is.
    expect(stageAfterQuotation("negotiation")).toBeNull();
  });

  it("leaves the quotation that closed the deal alone", () => {
    // The document raised BEFORE the win is the paperwork of the won deal.
    // Re-sending it must not drag the customer out of Won.
    const won = { concludedAt: day(10), quotedAt: day(3) };
    expect(stageAfterQuotation("won", won)).toBeNull();
    expect(stageAfterQuotation("lost", { concludedAt: day(10), quotedAt: day(3) })).toBeNull();
  });

  it("puts an existing client back on the board when they are quoted again", () => {
    // THE BUG THIS FILE EXISTS FOR, second time round: a quotation raised
    // for a client we have already sold to is new business, and under the
    // old rule it was the one quotation that never showed up anywhere.
    expect(stageAfterQuotation("won", { concludedAt: day(3), quotedAt: day(10) })).toBe("quoted");
  });

  it("revives a lost customer who is quoted again", () => {
    expect(stageAfterQuotation("lost", { concludedAt: day(3), quotedAt: day(10) })).toBe("quoted");
  });

  it("treats a conclusion with no date as long ago", () => {
    // Records closed before wonAt/lostAt were stamped. Quoting them today
    // is new business — the alternative is that the oldest clients in the
    // database are the ones the board can never show.
    expect(stageAfterQuotation("won", { quotedAt: day(10) })).toBe("quoted");
    expect(stageAfterQuotation("lost", { concludedAt: null, quotedAt: day(1) })).toBe("quoted");
  });

  it("stays put when neither date is known", () => {
    // No quotation date means nothing to compare, and moving a concluded
    // deal on no evidence is the behaviour this rule replaced.
    expect(stageAfterQuotation("won")).toBeNull();
    expect(stageAfterQuotation("lost")).toBeNull();
  });
});

describe("when a deal was concluded", () => {
  it("reads wonAt for a win and lostAt for a loss", () => {
    expect(concludedAt({ stage: "won", wonAt: day(4), lostAt: day(9) })).toBe(day(4));
    expect(concludedAt({ stage: "lost", wonAt: day(4), lostAt: day(9) })).toBe(day(9));
  });

  it("is nothing for a deal still open", () => {
    expect(concludedAt({ stage: "quoted", wonAt: day(4) })).toBeNull();
    expect(concludedAt(null)).toBeNull();
  });

  it("is nothing when the stamp was never made", () => {
    expect(concludedAt({ stage: "won" })).toBeNull();
  });
});

describe("which stages are conclusions", () => {
  it("names won and lost, and nothing else", () => {
    expect(isConcluded("won")).toBe(true);
    expect(isConcluded("lost")).toBe(true);
    expect(isConcluded("negotiation")).toBe(false);
    expect(isConcluded(undefined)).toBe(false);
  });
});

describe("which documents count", () => {
  it("counts what asks a customer to decide", () => {
    expect(advancesPipeline("quotation")).toBe(true);
    expect(advancesPipeline("proforma")).toBe(true);
  });

  it("leaves out what does not", () => {
    // An invoice means the deal is already won; a purchase order faces a
    // supplier and has no place on this board.
    expect(advancesPipeline("invoice")).toBe(false);
    expect(advancesPipeline("purchase_order")).toBe(false);
  });
});

describe("what a stage change carries with it", () => {
  it("stamps when a deal was won, once, and what it was worth then", () => {
    const won = applyStage(deal({ stage: "quoted", value: 400000 }), "won", day(5));
    expect(won.wonAt).toBe(day(5));
    expect(won.wonValue).toBe(400000);

    // Re-winning must not move the date into the current month, or the
    // trailing revenue chart says the sale happened twice.
    const again = applyStage(won, "won", day(30));
    expect(again.wonAt).toBe(day(5));
    expect(again.wonValue).toBe(400000);
  });

  it("keeps the win when the customer moves on", () => {
    // Quoting an existing client again moves them off Won. What they bought
    // in January still happened in January.
    const won = applyStage(deal({ stage: "quoted", value: 400000 }), "won", day(5));
    const requoted = applyStage({ ...won, value: 900000 }, "quoted", day(20));
    expect(requoted.wonAt).toBe(day(5));
    expect(requoted.wonValue).toBe(400000);
    expect(countsAsWon(requoted)).toBe(true);
    expect(wonAmount(requoted)).toBe(400000);
  });

  it("dates every loss, so a revival can be told from the loss itself", () => {
    const lost = applyStage(deal({ stage: "quoted" }), "lost", day(5));
    expect(lost.lostAt).toBe(day(5));
    const lostAgain = applyStage(lost, "lost", day(40));
    expect(lostAgain.lostAt).toBe(day(40));
  });

  it("counts nothing for a customer who has never been won", () => {
    expect(countsAsWon({ stage: "lead" })).toBe(false);
    expect(countsAsWon({ stage: "lost" })).toBe(false);
    expect(wonAmount({ value: "250000" })).toBe(250000);
  });

  it("falls back to the current value for a win stamped before wonValue existed", () => {
    expect(wonAmount({ value: 175000 })).toBe(175000);
    expect(wonAmount({ value: 175000, wonValue: 120000 })).toBe(120000);
    expect(wonAmount({})).toBe(0);
  });
});
