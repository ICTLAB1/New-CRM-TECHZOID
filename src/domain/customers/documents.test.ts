import { describe, expect, it } from "vitest";
import { documentsForCustomer } from "./documents";
import type { SalesDocument } from "../documents/create";

const doc = (o: Partial<SalesDocument>): SalesDocument => ({
  id: "d1", number: "TZ/QT/2627/0001", ownerId: "u1", customerId: "c1",
  date: "2026-08-01", status: "Sent", currency: "INR", validUntil: "2099-01-01",
  items: [{ id: "i1", qty: 1, rate: 1000, gst: 18 }],
  billState: "Delhi",
  ...o,
} as unknown as SalesDocument);

describe("everything raised for one customer", () => {
  const sources = {
    quotations: [
      doc({ id: "q1", number: "QT-1", date: "2026-08-01" }),
      doc({ id: "q2", number: "QT-2", date: "2026-09-15" }),
      doc({ id: "q3", number: "QT-3", date: "2026-07-01", customerId: "SOMEBODY-ELSE" }),
    ],
    proformas: [doc({ id: "p1", number: "PI-1", date: "2026-09-01" })],
    invoices: [doc({ id: "i1", number: "INV-1", date: "2026-10-01" })],
  };

  it("gathers quotations, proformas and invoices into one list", () => {
    const rows = documentsForCustomer("c1", sources);
    expect(rows.map((r) => r.number)).toEqual(["INV-1", "QT-2", "PI-1", "QT-1"]);
  });

  it("says what each one is", () => {
    const rows = documentsForCustomer("c1", sources);
    expect(rows.find((r) => r.number === "QT-1")?.kind).toBe("Quotation");
    expect(rows.find((r) => r.number === "PI-1")?.kind).toBe("Proforma invoice");
    expect(rows.find((r) => r.number === "INV-1")?.kind).toBe("Tax invoice");
  });

  it("leaves out another customer's documents", () => {
    const rows = documentsForCustomer("c1", sources);
    expect(rows.find((r) => r.number === "QT-3")).toBeUndefined();
  });

  it("is newest first, because the question is what is the latest", () => {
    const rows = documentsForCustomer("c1", sources);
    expect(rows[0]?.date).toBe("2026-10-01");
    expect(rows[rows.length - 1]?.date).toBe("2026-08-01");
  });

  it("works the total out rather than trusting a stored one", () => {
    /* 1000 + 18% = 1180. A figure typed into the row once and never
       recomputed is how a customer's record disagrees with the document. */
    const rows = documentsForCustomer("c1", { quotations: [doc({ id: "q1" })] });
    expect(Number(rows[0]?.amount)).toBeCloseTo(1180, 2);
  });

  it("shows a quotation past its validity as expired, whatever the stored status says", () => {
    const rows = documentsForCustomer("c1", {
      quotations: [doc({ id: "q1", status: "Sent", validUntil: "2020-01-01" })],
    });
    expect(rows[0]?.status).toBe("Expired");
  });

  it("is empty for a customer with nothing, and for no customer at all", () => {
    expect(documentsForCustomer("nobody", sources)).toEqual([]);
    expect(documentsForCustomer("", sources)).toEqual([]);
  });

  it("never includes purchase orders, which face a supplier", () => {
    /* Money owed BY us has no place in what this company has been quoted. */
    const rows = documentsForCustomer("c1", sources as never);
    expect(rows.every((r) => r.kind !== "Purchase order")).toBe(true);
  });
});
