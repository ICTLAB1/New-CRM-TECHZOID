import { describe, expect, it } from "vitest";
import { findDuplicate } from "./duplicates";

describe("matching on a phone number", () => {
  const list = [
    { id: "a", company: "Acme Manufacturing Pvt Ltd", phone: "+91 98100 12345" },
    { id: "b", company: "Northline Logistics", phone: "9820011111" },
  ];

  it("catches the same number typed three different ways", () => {
    // The same person reaches the CRM as "+91 98100 12345", "09810012345"
    // and "9810012345" depending on who typed it.
    for (const typed of ["9810012345", "09810012345", "+91 98100 12345", "91-98100-12345"]) {
      expect(findDuplicate({ id: "new", phone: typed }, list)?.match.id, typed).toBe("a");
    }
  });

  it("says which signal fired, because they are not equally certain", () => {
    expect(findDuplicate({ id: "n", phone: "9810012345" }, list)?.reason).toBe("phone");
    expect(findDuplicate({ id: "n", company: "Northline Logistics" }, list)?.reason).toBe("name");
  });

  it("prefers the stronger signal when both match", () => {
    const withGstin = [{ id: "a", company: "Acme", gstin: "07AAPFU0939F1ZX", phone: "9810012345" }];
    const hit = findDuplicate({ id: "n", company: "Acme", gstin: "07AAPFU0939F1ZX", phone: "9810012345" }, withGstin);
    expect(hit?.reason).toBe("gstin");
  });

  it("ignores a number too short to be one", () => {
    expect(findDuplicate({ id: "n", phone: "12345" }, list)).toBeNull();
    expect(findDuplicate({ id: "n", phone: "" }, list)).toBeNull();
  });
});
