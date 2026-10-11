/**
 * Payment Tracker — reading an invoice (PDF or photo) into bill fields.
 *
 * The AI reads the document; this file decides what it is asked, and cleans
 * what comes back. Nothing it returns is saved directly: the browser puts it
 * into the "Add a bill" form for a person to check and press Save. A misread
 * amount that went straight into a reminder would be worse than no scanning.
 */

export const ACCEPTED_TYPES = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif",
]);

/** ~10 MB of file, as base64. */
export const MAX_BASE64 = 14_000_000;

export const EXTRACT_TOOL = {
  name: "record_invoice",
  description: "Record the details read from one sales invoice.",
  input_schema: {
    type: "object",
    properties: {
      is_invoice: { type: "boolean", description: "False if this is not an invoice/bill at all." },
      invoice_no: { type: "string", description: "Invoice number exactly as printed." },
      invoice_date: { type: "string", description: "Invoice date as YYYY-MM-DD." },
      customer_name: { type: "string", description: "The BUYER / Bill-to / Billed-to party — never the seller who issued the invoice." },
      customer_gstin: { type: "string", description: "Buyer's GSTIN if printed." },
      contact_name: { type: "string", description: "Buyer's contact person, if printed." },
      email: { type: "string", description: "Buyer's email, if printed (not the seller's)." },
      phone: { type: "string", description: "Buyer's phone/mobile, if printed (not the seller's)." },
      amount: { type: "number", description: "Grand total payable including all taxes, as a plain number." },
      currency: { type: "string", description: "ISO code, e.g. INR, USD, AED." },
      credit_days: { type: "integer", description: "Credit period in days if stated (e.g. 'Net 30', '45 days')." },
      due_date: { type: "string", description: "Payment due date as YYYY-MM-DD if printed." },
      po_number: { type: "string", description: "Buyer's PO / order reference, if printed." },
      notes: { type: "string", description: "Anything the person checking should know, e.g. a figure that was hard to read." },
    },
    required: ["is_invoice"],
  },
};

export function systemPrompt(sellerNames = []) {
  const seller = sellerNames.filter(Boolean).join(", ");
  return [
    "You read sales invoices for an Indian company's accounts team and record the details with the record_invoice tool.",
    seller ? `The SELLER (who issued the invoice) is: ${seller}. Never record the seller as the customer; the customer is the buyer / bill-to party.` : "The customer is the buyer / bill-to party, never the seller.",
    "Use the grand total payable including GST/taxes and round-off. Indian invoices write 1,18,000.00 for 118000.",
    "Dates on Indian invoices are usually day-first (05/10/2026 is 5 October 2026). Return YYYY-MM-DD.",
    "Leave a field out rather than guess. Only call the tool once.",
  ].join("\n");
}

const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** yyyy-mm-dd, or "" if the value is not a real date. */
export function cleanDate(v) {
  const s = str(v, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const t = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(t)) return "";
  return new Date(t).toISOString().slice(0, 10) === s ? s : "";
}

export function cleanAmount(v) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1e11 ? Math.round(n * 100) / 100 : 0;
}

/** The tool's raw input, made safe to drop into the form. */
export function cleanExtraction(raw = {}) {
  const invoiceDate = cleanDate(raw.invoice_date);
  const dueDate = cleanDate(raw.due_date);
  let creditDays = Number.isInteger(raw.credit_days) && raw.credit_days >= 0 && raw.credit_days <= 730 ? raw.credit_days : null;
  if (creditDays === null && invoiceDate && dueDate && dueDate >= invoiceDate) {
    creditDays = Math.round((Date.parse(dueDate) - Date.parse(invoiceDate)) / 86_400_000);
  }
  const currency = str(raw.currency, 10).toUpperCase();
  const email = str(raw.email, 200);
  return {
    isInvoice: raw.is_invoice !== false,
    invoiceNo: str(raw.invoice_no, 60),
    invoiceDate,
    customerName: str(raw.customer_name, 160),
    customerGstin: str(raw.customer_gstin, 15).toUpperCase(),
    contactName: str(raw.contact_name, 120),
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "",
    phone: str(raw.phone, 30),
    amount: cleanAmount(raw.amount),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "INR",
    creditDays,
    dueDate,
    poNumber: str(raw.po_number, 60),
    notes: str(raw.notes, 400),
  };
}
