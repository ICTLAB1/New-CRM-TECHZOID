import { describe, expect, it } from "vitest";
import { GENERIC_SAVE_ERROR, saveRefusal } from "./refusal";

/**
 * A rule the CRM states in words has to reach the person who broke it.
 * Everything else is ours to read in the log.
 */

const FLOOR =
  "Line li1 (M365-E3) is priced at 2320 against a minimum of 2436.00. "
  + "An Admin has to approve that discount before this quotation can be sent.";

describe("what to say after a save the database refused", () => {
  it("passes on a rule written for the person", () => {
    /* Without this the salesperson sees "please try again" and does exactly
       that, forever — the quotation can never be sent until somebody
       approves the discount, and nothing on screen says so. */
    expect(saveRefusal({ code: "23514", message: FLOOR })).toBe(FLOOR);
  });

  it("passes on the last-Admin guard, which is the same kind of rule", () => {
    const msg = "That is the last Admin in this company — promote somebody else first.";
    expect(saveRefusal({ code: "23514", message: msg })).toBe(msg);
  });

  it("hides Postgres's own constraint wording", () => {
    /* 'new row for relation "quotes" violates check constraint
       "quotes_status_check"' is a bug report, not a sentence. */
    expect(saveRefusal({
      code: "23514",
      message: 'new row for relation "quotes" violates check constraint "quotes_status_check"',
    })).toBe(GENERIC_SAVE_ERROR);
  });

  it("hides everything that is not a deliberate refusal", () => {
    expect(saveRefusal({ code: "42703", message: 'column "widget" does not exist' })).toBe(GENERIC_SAVE_ERROR);
    expect(saveRefusal({ code: "42501", message: "permission denied for table quotes" })).toBe(GENERIC_SAVE_ERROR);
    expect(saveRefusal(new Error("Failed to fetch"))).toBe(GENERIC_SAVE_ERROR);
    expect(saveRefusal(null)).toBe(GENERIC_SAVE_ERROR);
    expect(saveRefusal("23514")).toBe(GENERIC_SAVE_ERROR);
  });

  it("does not show an empty banner when the refusal carried no words", () => {
    expect(saveRefusal({ code: "23514", message: "   " })).toBe(GENERIC_SAVE_ERROR);
  });
});
