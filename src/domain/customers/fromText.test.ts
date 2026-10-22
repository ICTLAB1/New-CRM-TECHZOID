import { describe, expect, it } from "vitest";
import { customerFromText } from "./fromText";

describe("a customer from dictated details", () => {
  it("takes the details as given", () => {
    const c = customerFromText(
      { company: "ACME Infotech", contact: "Rahul Verma", email: "rahul@acme.in", phone: "9810012345" },
      "u1", "id1",
    );
    expect(c.company).toBe("ACME Infotech");
    expect(c.contact).toBe("Rahul Verma");
    expect(c.email).toBe("rahul@acme.in");
    expect(c.ownerId).toBe("u1");
  });

  it("reads the state out of the GSTIN rather than believing the sentence", () => {
    /* 27 is Maharashtra. Someone saying "Delhi" while giving a Maharashtra
       GSTIN would otherwise be charged CGST+SGST where IGST is due, on
       every invoice they are ever sent. */
    const c = customerFromText(
      { company: "X", state: "Delhi", gstin: "27AAPFU0939F1ZV" },
      "u1", "id1",
    );
    expect(c.state).toBe("Maharashtra");
    expect(c.country).toBe("India");
  });

  it("fills the PAN from the GSTIN, since it is inside it", () => {
    const c = customerFromText({ company: "X", gstin: "27AAPFU0939F1ZV" }, "u1", "id1");
    expect(c.pan).toBe("AAPFU0939F");
  });

  it("keeps a dictated state when there is no GSTIN to contradict it", () => {
    const c = customerFromText({ company: "X", state: "Karnataka" }, "u1", "id1");
    expect(c.state).toBe("Karnataka");
  });

  it("leaves unmentioned fields on the workspace defaults", () => {
    /* Empty is honest. A guessed value is wrong on every document. */
    const c = customerFromText({ company: "X" }, "u1", "id1");
    expect(c.gstin).toBe("");
    expect(c.email).toBe("");
    expect(c.currency).toBe("INR");
    expect(c.stage).toBe("lead");
  });

  it("ignores an invalid GSTIN rather than deriving nonsense from it", () => {
    const c = customerFromText({ company: "X", state: "Kerala", gstin: "NOT-A-GSTIN" }, "u1", "id1");
    expect(c.state).toBe("Kerala");
  });
});
