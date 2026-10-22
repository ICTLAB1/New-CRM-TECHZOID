import { describe, expect, it } from "vitest";
import { matchCustomer, draftFromText } from "./fromText";
import { sameCompany, squashCompanyName } from "../customers/nameMatch";
import type { Customer } from "../customers/customer";
import type { CatalogProduct } from "../catalog/types";

const c = (id: string, company: string) => ({ id, ownerId: "u1", company } as Customer);

/**
 * Quoting the same company twice must land on the same customer record.
 *
 * The failure this guards is quiet and expensive: the second quotation does
 * not match, a second customer is filed, and from then on the company's
 * quotations, invoices and payment history are split across two records
 * that nobody notices until somebody chases a bill against the wrong one.
 */
describe("a second quotation finds the customer the first one created", () => {
  it("matches a legal form written the short way", () => {
    expect(matchCustomer("ACME Infotech Pvt Ltd", [c("c1", "ACME Infotech Private Limited")])?.id).toBe("c1");
    expect(matchCustomer("Orient Bell Ltd.", [c("c1", "Orient Bell Limited")])?.id).toBe("c1");
    expect(matchCustomer("Thinvent Technologies", [c("c1", "Thinvent Technologies Private Limited")])?.id).toBe("c1");
  });

  it("matches the long way round too", () => {
    expect(matchCustomer("ACME Infotech Private Limited", [c("c1", "ACME Infotech Pvt Ltd")])?.id).toBe("c1");
  });

  it("still refuses two genuinely different companies", () => {
    /* Loosening the comparison must not make everything match everything. */
    expect(matchCustomer("ACME Infotech", [c("c1", "ACME Logistics")])).toBeNull();
    expect(sameCompany("ACME Infotech", "ACME Logistics")).toBe(false);
  });

  it("still refuses to choose between two that could both be meant", () => {
    const two = [c("c1", "ACME Infotech Pvt Ltd"), c("c2", "ACME Infotech LLP")];
    expect(matchCustomer("ACME Infotech", two)).toBeNull();
  });

  it("does not reduce a name made entirely of legal words to nothing", () => {
    /* "The Limited" would squash to "", and an empty key matches everybody. */
    expect(squashCompanyName("The Limited")).not.toBe("");
    expect(sameCompany("The Limited", "Acme")).toBe(false);
  });

  it("links the second draft to the first customer rather than reporting it unmatched", () => {
    const ctx = {
      settings: { defaultGst: 18 },
      user: { id: "u1", name: "Abhinav" },
      customers: [c("c1", "ACME Infotech Private Limited")],
      catalog: [] as CatalogProduct[],
      today: "2026-01-01",
    };
    const { doc, report } = draftFromText(
      { customer: { company: "ACME Infotech Pvt Ltd" }, items: [{ desc: "x", qty: 1, rate: 1 }] } as never,
      ctx,
    );
    expect(report.matchedCustomer?.id).toBe("c1");
    /* No new record is created when one is matched. */
    expect(report.unmatchedCustomerName).toBe("");
    expect(doc.customerId).toBe("c1");
  });
});
