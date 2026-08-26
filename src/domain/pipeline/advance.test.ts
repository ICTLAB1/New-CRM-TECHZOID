import { describe, expect, it } from "vitest";
import { advancesPipeline, stageAfterQuotation } from "./advance";

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

  it("never touches a deal somebody has concluded", () => {
    // Won and Lost are decisions. An automatic rule does not get to
    // overwrite a decision.
    expect(stageAfterQuotation("won")).toBeNull();
    expect(stageAfterQuotation("lost")).toBeNull();
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
