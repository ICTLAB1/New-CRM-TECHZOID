import { describe, it, expect } from "vitest";
import { searchWorkspace } from "./GlobalSearch";
import type { WorkspaceData } from "../data/useWorkspace";

const data = {
  customers: [{ id: "c1", ownerId: "u", company: "Acme Manufacturing", contact: "Rajesh", phone: "+91 98100 12345" }],
  quotations: [{ id: "q1", number: "TZ/QT/2627/0117", billName: "Acme Manufacturing", status: "Sent" }],
  proformas: [], purchaseOrders: [], invoices: [],
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
