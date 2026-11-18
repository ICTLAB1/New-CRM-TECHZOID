import { TEMPLATES } from "./whatsappTemplates.mjs";

/**
 * Turning a record in the database into the facts a template needs.
 *
 * READ FROM THE RECORD, NEVER FROM THE REQUEST. A browser asking to send a
 * quotation message says WHICH quotation; everything the customer then
 * reads — the number, the product, the amount, the date — is fetched here
 * from the row. The alternative is a message whose figures a browser chose,
 * which is a customer being told their invoice is for an amount nobody
 * checked.
 *
 * ONE PLACE FOR ALL EIGHT, so the preview on screen and the message that
 * goes out cannot be built differently. The preview endpoint and the sender
 * both call `factsFor`.
 */

/** Which table each kind of record lives in. */
const TABLES = {
  quote: "quotes",
  proforma: "proformas",
  invoice: "invoices",
  order: "orders",
  bill: "payment_bills",
  subscription: "subscriptions",
  customer: "customers",
};

/** What each template is built from, so a screen can ask for the right thing. */
export const RECORD_FOR = {
  quotation_sent: "quote",
  quotation_followup: "quote",
  proforma_sent: "proforma",
  proforma_followup: "proforma",
  proforma_advance_reminder: "proforma",
  order_delivered: "order",
  licence_delivered: "order",
  payment_due_reminder: "bill",
  payment_overdue_reminder: "bill",
  payment_received: "bill",
  renewal_reminder: "subscription",
  /* THE ODD ONE OUT, and worth saying why. Every other template is about
     a document; this is an introduction, so the recipient is the record.
     That is also what makes it the only one a broadcast can use — there
     is no list of quotations to send an introduction about. */
  company_profile: "customer",
};

/**
 * The other kinds of record a message may also be sent about.
 *
 * A PAYMENT IS RECORDED IN TWO PLACES in this CRM — against a bill in the
 * Payment tracker, and against a tax invoice on Receivables — and a customer
 * who has just paid should be thanked either way. The two tables share
 * nothing, so both are allowed here rather than one of them being left out.
 * What the customer is thanked FOR is passed in by the server that read the
 * payment, not by the browser.
 */
export const ALSO_FOR = {
  payment_received: ["invoice"],
};

const text = (v) => (v === null || v === undefined ? "" : String(v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The customer's display name, however the record spells it. */
export const nameOf = (customer) => {
  const d = customer?.data ?? customer ?? {};
  return text(d.contact).trim() || text(d.company).trim() || text(customer?.customer_name).trim() || "";
};

/**
 * Read one record, with the customer it belongs to.
 *
 * Returns `{ record, customer, companyId }`, or `{ error }` when it is not
 * there — which happens when somebody deletes a quotation between pressing
 * the button and the send going out.
 */
export async function loadRecord(admin, { recordType, recordId }) {
  const table = TABLES[recordType];
  if (!table) return { error: `There is no such record type as ${recordType}.` };
  if (!recordId) return { error: "No record was named." };

  const { data: record, error } = await admin.from(table).select("*").eq("id", recordId).maybeSingle();
  if (error) return { error: error.message };
  if (!record) return { error: "That record no longer exists." };

  let customer = null;
  const customerId = text(record.customer_id) || text(record.data?.customerId);
  if (recordType === "customer") {
    customer = record;
  } else if (customerId) {
    const { data } = await admin.from("customers").select("*").eq("id", customerId).maybeSingle();
    customer = data ?? null;
  }

  return { record, customer, companyId: record.company_id ?? customer?.company_id ?? null };
}

/**
 * The named facts for one template, from one record.
 *
 * Everything optional: `buildParams` fills a blank with the template's own
 * fallback and reports it as missing, so a record with a hole in it still
 * sends a sensible message and the preview says which hole it had.
 */
export function factsFor(templateName, { record, customer, extra = {} }) {
  const d = record?.data ?? {};
  const customerName = nameOf(customer) || text(record?.customer_name) || text(d.billName);

  switch (templateName) {
    case "quotation_sent":
      return {
        customer: customerName,
        quoteNo: text(d.number) || text(record?.number),
        product: productOf(d),
        validTill: text(d.validUntil) || text(d.validTill),
      };

    case "quotation_followup":
      return {
        customer: customerName,
        quoteNo: text(d.number) || text(record?.number),
        product: productOf(d),
        /* The day it was actually sent, when the CRM recorded one —
           "shared on" is about the conversation, not about when somebody
           first typed the quotation. */
        sharedOn: text(d.sentAt) || text(d.date) || text(record?.created_at)?.slice(0, 10),
      };

    /* ── the proforma three ─────────────────────────────────────────
       THE AMOUNT IS THE ONE FACT NOT READ FROM THE ROW, and that is worth
       stating because the rule everywhere else in this file is the
       opposite. A document's total is not stored: it is computed from its
       lines, its tax type, the seller's state, the discount and the
       round-off, by code that runs where the document is drawn. The server
       has no renderer and no second copy of that arithmetic — and a second
       copy is precisely how a customer ends up reading one figure in a
       message and a different one on the PDF attached to it.

       So `extra.amount` is the figure the browser has just put on the
       document it is sending, handed over with it. That is not a number a
       request chose: it is the number on the page the customer is about to
       open, which is the only one that can be right. Where it is missing,
       `buildParams` reports the blank and the send is refused rather than
       guessed at. */
    case "proforma_sent":
      return {
        customer: customerName,
        proformaNo: text(d.number) || text(record?.number),
        amount: extra.amount,
        validTill: text(d.validUntil) || text(d.validTill),
      };

    case "proforma_followup":
      return {
        customer: customerName,
        proformaNo: text(d.number) || text(record?.number),
        product: productOf(d),
        sharedOn: text(d.sentAt) || text(d.date) || text(record?.created_at)?.slice(0, 10),
      };

    case "proforma_advance_reminder":
      return {
        customer: customerName,
        proformaNo: text(d.number) || text(record?.number),
        amount: extra.amount,
        sharedOn: text(d.sentAt) || text(d.date) || text(record?.created_at)?.slice(0, 10),
      };

    case "order_delivered":
      return {
        customer: customerName,
        orderNo: text(d.number) || text(record?.number),
        items: Array.isArray(d.items) ? d.items : [],
        deliveredOn: text(d.deliveredOn) || text(d.deliveryDate) || text(extra.today),
      };

    case "licence_delivered":
      return {
        customer: customerName,
        product: productOf(d),
        orderNo: text(d.number) || text(record?.number),
        /* Where the keys were actually emailed, which is the question a
           customer asks when they cannot find them. */
        sentTo: text(extra.sentTo) || text(d.licenceSentTo) || text(customer?.data?.email) || text(d.billEmail),
      };

    case "payment_due_reminder":
    case "payment_overdue_reminder": {
      const outstanding = num(record?.amount) - num(record?.amount_paid);
      return {
        customer: customerName || text(record?.customer_name),
        invoiceNo: text(record?.invoice_no),
        amount: outstanding > 0 ? outstanding : num(record?.amount),
        dueOn: text(record?.due_date),
        daysOverdue: extra.daysOverdue ?? daysBetween(text(record?.due_date), text(extra.today)),
      };
    }

    case "payment_received": {
      const paid = num(extra.amount) || num(record?.amount_paid);
      return {
        customer: customerName || text(record?.customer_name) || text(d.billName),
        amount: paid,
        /* "invoice TZ/INV/0042" or "order TZ/SO/0007" — the words are the
           business's, and the approved template expects one phrase. */
        against: text(extra.against)
          || (text(record?.invoice_no) ? `invoice ${text(record.invoice_no)}` : "")
          /* A tax invoice keeps its number in the document itself. */
          || (text(d.number) ? `invoice ${text(d.number)}` : ""),
      };
    }

    /* The recipient's own name, and ours. Nothing from a document,
       because there is no document — see RECORD_FOR above. The sending
       company's name comes from `extra`: it is the same for everybody in
       a broadcast and reading the settings row once per recipient would
       be a query per message for a value that cannot change mid-send. */
    case "company_profile":
      return {
        /* A pasted number may arrive with no name at all, and an empty
           blank fails the whole message at Meta. So this one has a
           stand-in — and it is worth saying why that is allowed here when
           it is refused everywhere else in this file.

           The stand-in that was taken out was "(number to follow)" in
           place of a quotation number: a customer reading a sentence about
           a document whose identity the sender did not know. "Hello
           there," is not that. It is an ordinary greeting, complete and
           true, and the only alternative is refusing to send an
           introduction to somebody whose name we were never given — which
           is most of a pasted list. */
        customer: customerName || text(extra.customerName) || "there",
        senderCompany: text(extra.senderCompany),
      };

    case "renewal_reminder":
      return {
        customer: customerName || text(record?.data?.customerName),
        product: text(d.product) || text(d.vendor),
        renewsOn: text(d.expiryDate),
      };

    default:
      return {};
  }
}

/** What the document is for, in a few words a customer will recognise. */
function productOf(d) {
  const items = Array.isArray(d?.items) ? d.items : [];
  if (!items.length) return text(d?.subject) || text(d?.title);
  /* The list itself: buildParams flattens it onto one line and names three
     before counting the rest. */
  return items;
}

/** Whole days from a due date to today. Negative before it falls due. */
export function daysBetween(dueDate, today) {
  if (!dueDate) return 0;
  const a = new Date(`${String(dueDate).slice(0, 10)}T00:00:00`);
  const b = new Date(`${String(today || new Date().toISOString()).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Does this template exist, and is this the kind of record it is built from? */
export function checkRecordType(templateName, recordType) {
  if (!TEMPLATES[templateName]) return `There is no WhatsApp template called ${templateName}.`;
  const wanted = RECORD_FOR[templateName];
  const also = ALSO_FOR[templateName] ?? [];
  if (wanted && recordType && recordType !== wanted && !also.includes(recordType)) {
    const allowed = [wanted, ...also].join(" or a ");
    return `“${TEMPLATES[templateName].label}” is sent about a ${allowed}, not a ${recordType}.`;
  }
  return "";
}
