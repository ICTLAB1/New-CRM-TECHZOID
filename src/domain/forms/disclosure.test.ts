import { describe, expect, it } from "vitest";
import { anyFilled, filled } from "./disclosure";

describe("field disclosure", () => {
  it("treats text with something in it as filled", () => {
    expect(filled("www.example.com")).toBe(true);
    expect(filled("")).toBe(false);
    /* Whitespace is what a field looks like after somebody tabs through it
       and hits space. It is not an answer. */
    expect(filled("   ")).toBe(false);
  });

  it("counts a number as data even when it is zero", () => {
    /* A zero advance, a nil-rated line. Blank is what undefined is for, and
       conflating the two hid a deliberate zero behind a toggle. */
    expect(filled(0)).toBe(true);
    expect(filled(12)).toBe(true);
    expect(filled(NaN)).toBe(false);
  });

  it("counts a ticked box and not an unticked one", () => {
    expect(filled(true)).toBe(true);
    expect(filled(false)).toBe(false);
  });

  it("ignores nothing at all", () => {
    expect(filled(null)).toBe(false);
    expect(filled(undefined)).toBe(false);
  });

  it("opens the group when any one field is holding something", () => {
    expect(anyFilled([])).toBe(false);
    expect(anyFilled(["", null, undefined, "  "])).toBe(false);
    expect(anyFilled(["", null, "IT Head"])).toBe(true);
    expect(anyFilled([undefined, 0])).toBe(true);
  });
});
