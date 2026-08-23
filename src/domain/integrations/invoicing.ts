import { fmtCurrency } from "../currency/format";
import type { DocumentTotals } from "../tax/types";
import type { SalesDocument } from "../documents/create";

/**
 * "Send for invoicing" — handing a signed-off quotation or proforma to
 * accounts so they can raise the tax invoice.
 *
 * The message is built here, away from the dialog, because it is the part
 * that must be right: it names the currency the document was priced in, not
 * rupees by assumption. A quotation in USD that arrives at accounts reading
 * "₹18,400" is the same class of mistake as the PDF that printed
 * "Currency: INR" on every export.
 */

export interface InvoicingAddresses {
  invoicingEmail?: string;
  invoicingCc?: string;
}

export interface InvoicingRequest {
  doc: SalesDocument;
  docType: "quotation" | "proforma";
  totals: DocumentTotals;
  note?: string;
  settings: InvoicingAddresses;
}

export interface InvoicingEmail {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

export const docLabel = (docType: "quotation" | "proforma"): string =>
  docType === "proforma" ? "Proforma Invoice" : "Quotation";

/** Null when there is nowhere to send it — the caller says so rather than
 *  sending into the void. */
export const invoicingAddress = (settings: InvoicingAddresses): string =>
  (settings.invoicingEmail ?? "").trim();

export function buildInvoicingEmail({ doc, docType, totals, note, settings }: InvoicingRequest): InvoicingEmail {
  const label = docLabel(docType);
  const lines = [
    "Please raise a tax invoice for the following:",
    "",
    `${label} No.: ${doc.number}`,
    `Customer: ${doc.billName || "—"}`,
    doc.billGstin ? `Customer GSTIN: ${doc.billGstin}` : "",
    /* The document's own currency. Never assumed. */
    `Value: ${fmtCurrency(totals.grand, doc.currency)}`,
    /* v1 read `doc.billPo` here — a field nothing ever wrote, so the
       customer's PO number never once reached accounts. The field that
       actually holds it is `referenceNo`, the editor's "Customer Reference". */
    doc.referenceNo ? `Customer PO: ${doc.referenceNo}` : "",
    `Prepared by: ${doc.preparedBy || "—"}`,
    "",
    note?.trim() ? `Note: ${note.trim()}\n` : "",
    `The ${label.toLowerCase()} is attached.`,
  ].filter((l) => l !== "");

  return {
    to: invoicingAddress(settings),
    cc: (settings.invoicingCc ?? "").trim(),
    subject: `Invoicing request — ${label} ${doc.number} — ${doc.billName || ""}`.trim(),
    body: lines.join("\n"),
  };
}
