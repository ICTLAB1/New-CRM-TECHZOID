import { describe, expect, it } from "vitest";
import { applyCountry, applyGstin, blankCustomer, type Customer } from "./customer";
import { findDuplicate, normalizeCompanyName } from "./duplicates";
import { cascadeReassign, type Workspace } from "./cascade";
import { applyStage, stageNeedsReason, stageOf } from "../pipeline/stages";

const cust = (o: Partial<Customer> = {}): Customer => ({ ...blankCustomer("u1", "c1"), ...o });

describe("company name normalisation", () => {
  it.each([
    ["Acme Industries Pvt Ltd", "acme industries"],
    ["Acme Industries Private Limited", "acme industries"],
    ["ACME INDUSTRIES LLP", "acme industries"],
    ["Acme Industries Inc.", "acme industries"],
    ["  Acme Industries  ", "acme industries"],
    ["Acme Industries Corp", "acme industries"],
  ])("reduces %s", (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });

  it("strips stacked legal suffixes, not just the last one", () => {
    // One pass over "Acme Pvt Ltd" leaves "acme pvt".
    expect(normalizeCompanyName("Acme Pvt Ltd")).toBe("acme");
    expect(normalizeCompanyName("Acme Private Limited")).toBe("acme");
  });

  it("leaves a name with no suffix alone", () => {
    expect(normalizeCompanyName("Northline Logistics")).toBe("northline logistics");
  });

  it("does not strip a suffix that is part of the name", () => {
    expect(normalizeCompanyName("Limited Edition Prints Pvt Ltd")).toBe("limited edition prints");
  });

  it("handles empty input", () => {
    expect(normalizeCompanyName("")).toBe("");
    expect(normalizeCompanyName(null)).toBe("");
  });
});

describe("duplicate detection", () => {
  const existing = [
    { id: "a", company: "Acme Industries Pvt Ltd", gstin: "07AAPFU0939F1ZV" },
    { id: "b", company: "Northline Logistics", gstin: "" },
  ];

  it("matches on GSTIN, the stronger signal", () => {
    const hit = findDuplicate({ id: "new", company: "Completely Different Name", gstin: "07AAPFU0939F1ZV" }, existing);
    expect(hit?.match.id).toBe("a");
    expect(hit?.byGstin).toBe(true);
  });

  it("matches on a normalised name when no GSTIN matches", () => {
    const hit = findDuplicate({ id: "new", company: "ACME INDUSTRIES LIMITED" }, existing);
    expect(hit?.match.id).toBe("a");
    expect(hit?.byGstin).toBe(false);
  });

  it("prefers the GSTIN match when both would hit", () => {
    const hit = findDuplicate({ id: "new", company: "Northline Logistics", gstin: "07AAPFU0939F1ZV" }, existing);
    expect(hit?.match.id).toBe("a");
    expect(hit?.byGstin).toBe(true);
  });

  it("ignores case and whitespace on the GSTIN", () => {
    expect(findDuplicate({ id: "n", gstin: " 07aapfu0939f1zv " }, existing)?.byGstin).toBe(true);
  });

  it("finds nothing for a genuinely new customer", () => {
    expect(findDuplicate({ id: "n", company: "Vertex Analytics", gstin: "27AAPFU0939F1ZW" }, existing)).toBeNull();
  });

  it("never matches a record against itself", () => {
    // Editing an existing customer must not raise a duplicate-of-itself alarm.
    expect(findDuplicate(existing[0]!, existing, "a")).toBeNull();
  });

  it("does not match on an empty GSTIN or empty name", () => {
    expect(findDuplicate({ id: "n", company: "", gstin: "" }, existing)).toBeNull();
    // Northline has no GSTIN; a new customer with no GSTIN must not match it.
    expect(findDuplicate({ id: "n", company: "Someone Else", gstin: "" }, existing)).toBeNull();
  });
});

describe("GSTIN auto-fill", () => {
  const GSTIN = "27AAPFU0939F1ZV";

  it("fills state and PAN from a valid GSTIN", () => {
    const out = applyGstin(cust({ state: "", pan: "" }), GSTIN);
    expect(out.state).toBe("Maharashtra");
    expect(out.pan).toBe("AAPFU0939F");
    expect(out.country).toBe("India");
  });

  it("NEVER overwrites a PAN already typed", () => {
    // Someone who typed a PAN has a reason; the GSTIN may be the wrong one.
    const out = applyGstin(cust({ pan: "ZZZZZ9999Z" }), GSTIN);
    expect(out.pan).toBe("ZZZZZ9999Z");
    expect(out.state).toBe("Maharashtra");
  });

  it("stores the cleaned, upper-cased GSTIN", () => {
    expect(applyGstin(cust(), " 27aapfu0939f1zv ").gstin).toBe(GSTIN);
  });

  it("fills nothing from an invalid GSTIN but keeps what was typed", () => {
    const out = applyGstin(cust({ state: "Delhi", pan: "" }), "27AAPFU0939F1ZW");
    expect(out.gstin).toBe("27AAPFU0939F1ZW");
    expect(out.state).toBe("Delhi");
    expect(out.pan).toBe("");
  });

  it("leaves the state alone when the GSTIN's state code is unknown", () => {
    const out = applyGstin(cust({ state: "Delhi" }), "");
    expect(out.state).toBe("Delhi");
  });
});

describe("changing country", () => {
  it("clears a stale Indian state", () => {
    // Leaving "Delhi" on a UAE customer put an Indian state on export
    // documents and made the tax engine treat the sale as intra-state.
    const out = applyCountry(cust({ state: "Delhi" }), "United Arab Emirates");
    expect(out.state).toBe("");
  });

  it("drops GST when leaving India, since GST cannot apply to an export", () => {
    expect(applyCountry(cust({ taxType: "gst" }), "Singapore").taxType).toBe("none");
  });

  it("leaves a non-GST regime alone", () => {
    expect(applyCountry(cust({ taxType: "vat" }), "Germany").taxType).toBe("vat");
  });

  it("restores a default state coming back to India", () => {
    const abroad = applyCountry(cust(), "Germany");
    expect(applyCountry(abroad, "India").state).toBe("Delhi");
  });
});

describe("stage changes", () => {
  it("stamps wonAt on the first move to Won", () => {
    const out = applyStage(cust(), "won", 1000);
    expect(out.wonAt).toBe(1000);
  });

  it("never re-stamps wonAt while the deal stays won", () => {
    // Trailing revenue reads this timestamp; marking an already-won deal Won
    // again must not move it into the current month.
    const won = applyStage(cust(), "won", 1000);
    expect(applyStage(won, "won", 3000).wonAt).toBe(1000);
  });

  it("keeps the original date through a re-quote", () => {
    // A new quotation to a won customer puts them back on the board without
    // rewriting history — January's sale still happened in January.
    const won = applyStage(cust(), "won", 1000);
    const requoted = applyStage(won, "negotiation", 2000, { requote: true });
    expect(applyStage(requoted, "won", 3000).wonAt).toBe(1000);
  });

  it("but a win taken back by hand and won again is dated the second time", () => {
    // Dragging a won deal back to an open stage says the win was wrong. What
    // follows is a NEW sale, and dating it to the mistake would put revenue
    // in a month nothing happened in.
    const won = applyStage(cust(), "won", 1000);
    const corrected = applyStage(won, "negotiation", 2000);
    expect(corrected.wonAt).toBeUndefined();
    expect(applyStage(corrected, "won", 3000).wonAt).toBe(3000);
  });

  it("asks for a reason only when moving to Lost", () => {
    expect(stageNeedsReason("lost")).toBe(true);
    for (const s of ["lead", "contacted", "qualified", "quoted", "negotiation", "won"] as const) {
      expect(stageNeedsReason(s), s).toBe(false);
    }
  });

  it("reads an unknown or missing stage as Lead", () => {
    expect(stageOf(undefined).id).toBe("lead");
    expect(stageOf("archived").id).toBe("lead");
  });
});

describe("cascade reassignment", () => {
  const ws: Workspace = {
    quotes: [{ id: "q1", ownerId: "old", customerId: "c1" }, { id: "q2", ownerId: "old", customerId: "other" }],
    proformas: [{ id: "p1", ownerId: "old", customerId: "c1" }],
    orders: [{ id: "o1", ownerId: "old", customerId: "c1" }, { id: "o2", ownerId: "old", customerId: "other" }],
    challans: [{ id: "d1", ownerId: "old", orderId: "o1" }, { id: "d2", ownerId: "old", orderId: "o2" }],
    subscriptions: [{ id: "s1", ownerId: "old", customerId: "c1" }],
  };

  it("moves every record tied to the customer", () => {
    const { workspace, moved } = cascadeReassign(ws, "c1", "new");
    expect(workspace.quotes[0]?.ownerId).toBe("new");
    expect(workspace.proformas[0]?.ownerId).toBe("new");
    expect(workspace.orders[0]?.ownerId).toBe("new");
    expect(workspace.subscriptions[0]?.ownerId).toBe("new");
    expect(moved).toBe(5); // q1, p1, o1, d1, s1
  });

  it("moves challans by the orders that moved, not by customer", () => {
    // Challans hang off orders; they carry no customerId of their own.
    const { workspace } = cascadeReassign(ws, "c1", "new");
    expect(workspace.challans.find((c) => c.id === "d1")?.ownerId).toBe("new");
    expect(workspace.challans.find((c) => c.id === "d2")?.ownerId).toBe("old");
  });

  it("leaves other customers' records untouched", () => {
    const { workspace } = cascadeReassign(ws, "c1", "new");
    expect(workspace.quotes.find((q) => q.id === "q2")?.ownerId).toBe("old");
    expect(workspace.orders.find((o) => o.id === "o2")?.ownerId).toBe("old");
  });

  it("reports nothing moved for a customer with no records", () => {
    expect(cascadeReassign(ws, "nobody", "new").moved).toBe(0);
  });

  it("does not mutate the workspace it was given", () => {
    cascadeReassign(ws, "c1", "new");
    expect(ws.quotes[0]?.ownerId).toBe("old");
  });
});
