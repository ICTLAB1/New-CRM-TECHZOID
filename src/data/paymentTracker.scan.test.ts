import { describe, expect, it } from "vitest";
import { billFromScan, type ScannedInvoice } from "./paymentTracker";

const scan = (over: Partial<ScannedInvoice> = {}): ScannedInvoice => ({
  invoiceNo: "TZ/1", invoiceDate: "2026-10-01", customerName: "Arcadia Design Studio Pvt Ltd", customerGstin: "",
  contactName: "", email: "", phone: "", amount: 1000, currency: "INR", creditDays: null, dueDate: "", poNumber: "", notes: "", ...over,
});
const customers = [
  { id: "c1", company: "Arcadia Design Studio", contact: "Priya", email: "priya@a.in", phone: "9811122334", gstin: "07AAA" },
  { id: "c2", company: "Nimbus Infra", gstin: "07NIM" },
];

describe("a bill from a scanned invoice", () => {
  it("matches a CRM customer by name and fills missing contact details", () => {
    const { bill, matched } = billFromScan(scan(), customers, "u1", null);
    expect(matched).toBe("Arcadia Design Studio");
    expect(bill).toMatchObject({ customerId: "c1", email: "priya@a.in", contactName: "Priya", phone: "9811122334" });
  });
  it("GSTIN beats the name", () => {
    expect(billFromScan(scan({ customerName: "Something Else", customerGstin: "07NIM" }), customers, "u1", null).bill.customerId).toBe("c2");
  });
  it("details printed on the invoice win over the CRM", () => {
    expect(billFromScan(scan({ email: "ap@arcadia.in" }), customers, "u1", null).bill.email).toBe("ap@arcadia.in");
  });
  it("defaults to 30 days credit when the invoice says nothing", () => {
    const { bill } = billFromScan(scan({ customerName: "Unknown Co" }), customers, "u1", null);
    expect(bill.creditDays).toBe(30);
    expect(bill.dueDate).toBe("2026-10-31");
    expect(bill.customerId).toBeNull();
  });
  it("uses a printed due date", () => {
    const { bill } = billFromScan(scan({ dueDate: "2026-11-30" }), customers, "u1", null);
    expect(bill.creditDays).toBe(60);
    expect(bill.dueDate).toBe("2026-11-30");
  });
});
