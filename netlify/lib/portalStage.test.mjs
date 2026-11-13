import { describe, expect, it } from "vitest";
import { stageAfterPortalAnswer } from "./portalStage.mjs";
import { stageAfterOutcome } from "../../src/domain/documents/outcome.ts";
import { ANSWERS } from "../functions/portal-respond.mjs";

/**
 * The same fact arriving by two doors has to land in the same place.
 */

describe("where a portal answer moves the deal", () => {
  /* THE WORDS THE ENDPOINT ACTUALLY PASSES. It writes the document's own
     status — "Accepted", capitalised — and the first version of this rule
     compared it with "accepted" and so did nothing at all, silently. */
  it("reads the value portal-respond actually hands it", () => {
    expect(stageAfterPortalAnswer(ANSWERS.accept.status, "quoted")).toBe("negotiation");
    expect(stageAfterPortalAnswer(ANSWERS.decline.status, "quoted")).toBeNull();
  });

  it("moves an agreed deal to Negotiation, from anywhere open below it", () => {
    for (const from of ["", "lead", "contacted", "qualified", "quoted", undefined]) {
      expect(stageAfterPortalAnswer("Accepted", from)).toBe("negotiation");
    }
  });

  it("never drags a deal backwards or reopens a concluded one", () => {
    expect(stageAfterPortalAnswer("accepted", "negotiation")).toBeNull();
    expect(stageAfterPortalAnswer("accepted", "won")).toBeNull();
    expect(stageAfterPortalAnswer("accepted", "lost")).toBeNull();
  });

  it("moves nobody when a quotation is declined", () => {
    /* One quotation turned down is not a lost customer — they may have two
       others open. That call belongs to the salesperson. */
    for (const from of ["", "lead", "quoted", "negotiation", "won", "lost"]) {
      expect(stageAfterPortalAnswer("rejected", from)).toBeNull();
    }
  });

  it("agrees with the rule the CRM applies to the same event", () => {
    /* These two are deliberately separate files — one runs in a Netlify
       function, one in the browser — and a disagreement between them would
       show as a board that depends on which door the answer came through. */
    for (const from of ["", "lead", "contacted", "qualified", "quoted", "negotiation", "won", "lost"]) {
      expect(stageAfterPortalAnswer("accepted", from)).toBe(stageAfterOutcome("accepted", from));
    }
  });
});
