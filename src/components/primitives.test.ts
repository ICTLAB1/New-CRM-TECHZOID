import { describe, expect, it } from "vitest";
import { cx } from "./primitives";

describe("cx", () => {
  it("joins the truthy parts", () => {
    expect(cx("btn", "btn-primary")).toBe("btn btn-primary");
  });

  it("drops false, null and undefined so conditionals read inline", () => {
    expect(cx("btn", false, null, undefined, "btn-sm")).toBe("btn btn-sm");
  });

  it("returns an empty string rather than undefined", () => {
    expect(cx(false, null)).toBe("");
  });
});
