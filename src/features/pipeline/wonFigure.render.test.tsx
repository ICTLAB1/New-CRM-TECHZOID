import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PipelineBoard } from "./PipelineBoard";
import type { Customer } from "../../domain/customers/customer";
import type { SalesDocument } from "../../domain/documents/create";

/**
 * What a won deal SHOWS, on the screen where its stage was set.
 *
 * REPORTED FAULT: "Total sales or closed orders values are not getting
 * matched with the order won or invoice." Three different figures could
 * appear for one deal — the estimate on the card, the frozen snapshot in
 * the reports, and the total on the invoice — and no screen named more
 * than one of them, so there was nothing to compare and nothing to
 * correct. These render the real component, because a rule that is right
 * in the domain and absent from the markup is a rule the business never
 * sees.
 */

const customer = (over: Partial<Customer>): Customer => ({
  id: "c1", ownerId: "u1", company: "Edelweiss", contact: "", email: "", phone: "",
  currency: "INR", createdAt: 0, updatedAt: 0, ...over,
} as Customer);

/* ₹1,00,000 + 18% GST, Delhi to Delhi. */
const INVOICE_TOTAL = 118000;

const invoice = (over: Partial<SalesDocument> = {}): SalesDocument => ({
  id: "i1", number: "TZ/INV/2627/0007", ownerId: "u1", customerId: "c1",
  billName: "Edelweiss", billState: "Delhi", billCountry: "India",
  currency: "INR", taxType: "gst", date: "2026-08-10", status: "Sent",
  items: [{ id: "it", qty: 1, rate: 100000, disc: 0, gst: 18 }],
  terms: [], roundOff: false, createdAt: 0, updatedAt: 0, ...over,
} as unknown as SalesDocument);

const board = (c: Customer, docs: Record<string, SalesDocument[]> = {}) => renderToStaticMarkup(
  <PipelineBoard
    customers={[c]}
    documents={{ invoices: [], orders: [], proformas: [], quotations: [], ...docs }}
    sellerState="Delhi"
    onChange={() => {}}
    onOpen={() => {}}
  />,
);

describe("a won card on the pipeline board", () => {
  it("shows what the deal was WON for, not the estimate typed months earlier", () => {
    /* The card used to read `value` whatever the stage, so a deal won on a
       ₹4,72,000 order sat in the Won column showing ₹50,000. */
    const html = board(customer({ stage: "won", wonAt: 1, value: 50000, wonValue: 472000 }));
    expect(html).toContain("4.72 L");
    expect(html).not.toContain("50.0 K");
  });

  it("still shows the estimate on an open deal, which is all there is", () => {
    const html = board(customer({ stage: "qualified", value: 50000 }));
    expect(html).toContain("50.0 K");
  });

  it("flags a won figure its own invoice disagrees with, naming both", () => {
    const html = board(
      customer({ stage: "won", wonAt: 1, wonValue: 50000 }),
      { invoices: [invoice()] },
    );
    expect(html).toContain("Figure disagrees");
    /* Both numbers and the document, in the tooltip — a flag that does not
       say what the other figure is cannot be acted on. */
    expect(html).toContain("TZ/INV/2627/0007");
    expect(html).toContain("₹50,000");
    expect(html).toContain("₹1,18,000");
  });

  it("says nothing where the figure and the invoice agree", () => {
    const html = board(
      customer({ stage: "won", wonAt: 1, wonValue: INVOICE_TOTAL }),
      { invoices: [invoice()] },
    );
    expect(html).not.toContain("Figure disagrees");
  });

  it("says nothing about an open deal, whatever its estimate", () => {
    const html = board(customer({ stage: "qualified", value: 7 }), { invoices: [invoice()] });
    expect(html).not.toContain("Figure disagrees");
  });

  /* FOUND BY THE TEST ABOVE, not by reading the code: the column heading
     totalled `value` for every column alike, so the Won column's own
     heading disagreed with the dashboard, the revenue report and the cards
     underneath it. Four numbers for one month's sales. */
  it("totals the WON figures in the Won column heading", () => {
    const html = board(customer({ stage: "won", wonAt: 1, value: 50000, wonValue: 472000 }));
    expect(html).toContain("4.72 L");
    expect(html).not.toContain("50.0 K");
  });

  it("still totals the estimates in an open column", () => {
    const html = board(customer({ stage: "qualified", value: 50000 }));
    expect(html).toContain("50.0 K");
  });

  it("renders at all without documents to check against", () => {
    /* The prop is optional and the board is used without it. */
    const html = renderToStaticMarkup(
      <PipelineBoard customers={[customer({ stage: "won", wonAt: 1, wonValue: 472000 })]} onChange={() => {}} onOpen={() => {}} />,
    );
    expect(html).toContain("Edelweiss");
    expect(html).not.toContain("Figure disagrees");
  });
});
