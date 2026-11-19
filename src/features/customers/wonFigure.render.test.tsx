// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CustomerSheet } from "./CustomerSheet";
import type { Customer } from "../../domain/customers/customer";
import type { SalesDocument } from "../../domain/documents/create";

/**
 * Where a won deal's reported figure can be SEEN and PUT RIGHT.
 *
 * REPORTED FAULT: "Total sales or closed orders values are not getting
 * matched with the order won or invoice." `wonValue` is the figure every
 * revenue total in the CRM counts, and until now there was nowhere in the
 * whole application to look at it. "Deal value" on this sheet is the
 * estimate, so the two being different read as the reports being broken.
 */

const customer = (over: Partial<Customer>): Customer => ({
  id: "c1", ownerId: "u1", company: "Edelweiss", contact: "", email: "", phone: "",
  currency: "INR", country: "India", state: "Delhi", createdAt: 0, updatedAt: 0, ...over,
} as Customer);

/* ₹1,00,000 + 18% GST, Delhi to Delhi. */
const INVOICE_TOTAL = 118000;

const invoice = (): SalesDocument => ({
  id: "i1", number: "TZ/INV/2627/0007", ownerId: "u1", customerId: "c1",
  billName: "Edelweiss", billState: "Delhi", billCountry: "India",
  currency: "INR", taxType: "gst", date: "2026-08-10", status: "Sent",
  items: [{ id: "it", qty: 1, rate: 100000, disc: 0, gst: 18 }],
  terms: [], roundOff: false, createdAt: 0, updatedAt: 0,
} as unknown as SalesDocument);

/* A real client render, not renderToStaticMarkup: the sheet lives in a
   Modal that portals into document.body, which server rendering cannot
   do. The markup is read back off the document for the same reason the
   board tests read it — a rule that is right in the domain and missing
   from the screen is a rule the business never sees. */
afterEach(cleanup);

const sheet = (c: Customer, docs?: { invoices?: SalesDocument[]; quotations?: SalesDocument[] }) => {
  render(
    <CustomerSheet
      customer={c}
      users={[{ id: "u1", name: "Abhinav" }]}
      customFields={[]}
      canReassign={false}
      documents={docs}
      sellerState="Delhi"
      onSave={() => {}}
      onClose={() => {}}
    />,
  );
  return document.body.innerHTML;
};

describe("the won figure on a customer", () => {
  it("is shown at all, on a deal that counts as won", () => {
    const html = sheet(customer({ stage: "won", wonAt: 1, value: 50000, wonValue: 472000 }));
    expect(html).toContain("Reported as revenue");
    expect(html).toContain("472000");
    /* And it says which of the two figures the reports actually count, so
       the one above it stops looking like a contradiction. */
    expect(html).toContain("Every sales total in the CRM counts this one");
  });

  it("is not shown on an open deal, which has no won figure", () => {
    const html = sheet(customer({ stage: "negotiation", value: 50000 }));
    expect(html).not.toContain("Reported as revenue");
  });

  it("is still shown on a won deal with no document behind it", () => {
    /* The field is how somebody corrects a figure by hand, so it cannot
       depend on there being paperwork to compare against. */
    const html = sheet(customer({ stage: "won", wonAt: 1, wonValue: 663750 }));
    expect(html).toContain("Reported as revenue");
    expect(html).toContain("663750");
  });
});

describe("when the paperwork disagrees with it", () => {
  /* Rendered inside each test, not once for the describe: a render at
     collection time leaves its markup in document.body for every test
     that follows, and "not.toContain" would then be reading the previous
     one's output. */
  const disagreeing = () => sheet(
    customer({ stage: "won", wonAt: 1, value: 50000, wonValue: 50000 }),
    { invoices: [invoice()] },
  );

  it("names both figures and the document they came from", () => {
    const html = disagreeing();
    expect(html).toContain("₹50,000");
    expect(html).toContain("₹1,18,000");
    expect(html).toContain("TZ/INV/2627/0007");
  });

  it("offers a button that takes the document's figure", () => {
    const html = disagreeing();
    /* A button somebody presses, not something that happens quietly:
       changing a concluded deal's revenue is a decision, and whose it is
       was the one thing backing.ts was careful about. */
    expect(html).toContain("Use ₹1,18,000 from TZ/INV/2627/0007");
  });
});

describe("when it agrees", () => {
  it("says nothing and offers nothing", () => {
    const html = sheet(
      customer({ stage: "won", wonAt: 1, wonValue: INVOICE_TOTAL }),
      { invoices: [invoice()] },
    );
    expect(html).toContain("Reported as revenue");
    expect(html).not.toContain("Use ₹");
    expect(html).not.toContain("but TZ/INV");
  });
});
