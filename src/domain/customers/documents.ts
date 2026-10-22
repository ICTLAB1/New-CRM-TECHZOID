import { computeDocument } from "../tax/compute";
import { effectiveStatus, type SalesDocument } from "../documents/create";
import type { RecordDocument } from "./record";

/**
 * Everything raised for one customer, in one list.
 *
 * Quotations, proformas and tax invoices live in three separate tables
 * because they are three different things with three different lifecycles.
 * That is right for the database and wrong for the person looking at a
 * customer, who wants to know what this company has been sent and what came
 * of it — and was previously having to open three screens and filter each
 * one by name to find out.
 *
 * PURCHASE ORDERS ARE NOT HERE. They face a supplier, not a customer;
 * putting them on a customer's record would show money owed BY us as part of
 * what this company has been quoted.
 *
 * Newest first, because the question is nearly always "what is the latest".
 */

export const DOC_KIND = {
  quotation: "Quotation",
  proforma: "Proforma invoice",
  invoice: "Tax invoice",
} as const;

export type DocSource = keyof typeof DOC_KIND;

/** A document, as the customer's record shows it. */
function toRecord(doc: SalesDocument, kind: string, sellerState: string): RecordDocument {
  const totals = computeDocument(doc, sellerState);
  return {
    id: doc.id,
    number: doc.number || "(no number yet)",
    kind,
    date: doc.date ?? "",
    /* The status a person would say out loud: a quotation past its validity
       is Expired even while the stored field still says Sent. */
    status: effectiveStatus(doc),
    amount: String(totals.grand ?? 0),
    by: doc.ownerId,
  };
}

/**
 * @param customerId whose record is open
 * @param sources the workspace's three document tables
 * @param sellerState our own state, for working out each document's total
 */
/** One row of a customer's document history. */
export type DocumentRow = RecordDocument & { currency?: string; source: DocSource };

export function documentsForCustomer(
  customerId: string,
  sources: { quotations?: SalesDocument[]; proformas?: SalesDocument[]; invoices?: SalesDocument[] },
  sellerState = "Delhi",
): DocumentRow[] {
  if (!customerId) return [];

  const gather = (list: SalesDocument[] | undefined, source: DocSource) =>
    (list ?? [])
      .filter((d) => d.customerId === customerId)
      .map((d) => ({ ...toRecord(d, DOC_KIND[source], sellerState), currency: d.currency, source }));

  return [
    ...gather(sources.quotations, "quotation"),
    ...gather(sources.proformas, "proforma"),
    ...gather(sources.invoices, "invoice"),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
