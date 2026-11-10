import { describe, it, expect } from "vitest";
import { findByNumber, searchWorkspace } from "./GlobalSearch";
import type { WorkspaceData } from "../data/useWorkspace";

const data = {
  customers: [{ id: "c1", ownerId: "u", company: "Acme Manufacturing", contact: "Rajesh", phone: "+91 98100 12345" }],
  quotations: [{ id: "q1", number: "TZ/QT/2627/0117", billName: "Acme Manufacturing", status: "Sent" }],
  proformas: [], purchaseOrders: [],
  invoices: [{ id: "i1", number: "TZ/INV/2627/0009", billName: "Northline", status: "Issued" }],
  orders: [{ id: "o1", number: "SO/0042", billName: "Northline" }],
  challans: [], subscriptions: [{ id: "s1", product: "Creative Cloud", vendor: "Adobe", customerName: "Acme" }],
} as unknown as WorkspaceData;

describe("header search", () => {
  it("finds a customer and their documents by name", () => {
    const kinds = searchWorkspace(data, "acme").map((h) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(["Customer", "Quotation", "Subscription"]));
  });
  it("finds a document by its number", () => {
    expect(searchWorkspace(data, "0117")[0]).toMatchObject({ view: "quotations", id: "q1" });
  });
  it("finds a customer by phone, however it was typed", () => {
    expect(searchWorkspace(data, "9810012345")[0]).toMatchObject({ view: "customers", id: "c1" });
  });
  it("waits for two characters", () => {
    expect(searchWorkspace(data, "a")).toEqual([]);
  });
});

describe("opening the document a scanned code names", () => {
  it("opens the one with that number", () => {
    expect(findByNumber(data, "TZ/QT/2627/0117")).toMatchObject({ view: "quotations", id: "q1", kind: "Quotation" });
    expect(findByNumber(data, "TZ/INV/2627/0009")).toMatchObject({ view: "invoices", id: "i1", kind: "Tax invoice" });
  });

  it("ignores case and surrounding space, as a typed number has", () => {
    expect(findByNumber(data, "  tz/qt/2627/0117 ")).toMatchObject({ id: "q1" });
  });

  it("opens nothing on a near miss", () => {
    /* THE DIFFERENCE FROM THE SEARCH BOX. A scan is not a guess: a code
       for a document this workspace does not hold must say so, not open
       the closest thing to it. */
    expect(findByNumber(data, "0117")).toBeNull();
    expect(findByNumber(data, "TZ/QT/2627/011")).toBeNull();
    expect(findByNumber(data, "TZ/QT/2627/0118")).toBeNull();
    expect(findByNumber(data, "")).toBeNull();
    expect(findByNumber(data, null)).toBeNull();
  });

  it("carries the customer and status through, so the scanner can say what it found", () => {
    expect(findByNumber(data, "TZ/QT/2627/0117")!.meta).toContain("Acme Manufacturing");
    expect(findByNumber(data, "TZ/QT/2627/0117")!.meta).toContain("Sent");
  });
});
