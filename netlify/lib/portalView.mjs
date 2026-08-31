/**
 * What a customer is allowed to see.
 *
 * THIS FILE IS AN ALLOWLIST, AND IT HAS TO STAY ONE. Every other way of
 * writing it — spread the row and delete a few keys, strip a list of "internal"
 * fields — fails the same way: somebody adds a column six months from now and
 * it ships to customers because nobody remembered to add it to the deny list.
 * That is not hypothetical here. `LineItem.cost` was added to this codebase
 * earlier the same day this file was written, for the margin feature. Under a
 * deny list, the buying price of every line would now be sitting in the JSON
 * behind a link the customer was emailed.
 *
 * So: nothing reaches a customer unless it is named below. A new field is
 * invisible to the portal by default, and the test beside this file fails if
 * anything unnamed ever appears in the output.
 *
 * The rule for deciding whether a field belongs here is not "is it secret" —
 * it is "is this already on the piece of paper we sent them". A quotation PDF
 * has the line items, the totals and the terms on it. It does not have what we
 * paid, who owns the account, what stage the deal is at, or what the
 * salesperson wrote in their notes.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v, max = 2000) => String(v ?? "").slice(0, max);

/**
 * One line of a document, as it is printed.
 *
 * `cost` is absent, deliberately and permanently. So is anything else the
 * catalog may hang off a line in future: this builds a new object rather than
 * copying one.
 */
function publicLine(item) {
  return {
    id: text(item?.id, 64),
    desc: text(item?.desc, 500),
    subDesc: text(item?.subDesc, 500),
    brand: text(item?.brand, 120),
    sku: text(item?.sku, 120),
    hsn: text(item?.hsn, 40),
    qty: num(item?.qty),
    unit: text(item?.unit, 40),
    rate: num(item?.rate),
    disc: num(item?.disc),
    gst: num(item?.gst),
  };
}

/**
 * A payment already recorded against a proforma or invoice.
 *
 * The customer knows what they paid; showing it back is the single most
 * useful thing on the page — "did you get our transfer" is a phone call this
 * answers. The internal remark on the entry is not included: that field is
 * where somebody writes "cheque bounced, chasing".
 */
function publicPayment(entry) {
  return {
    date: text(entry?.date, 40),
    amount: num(entry?.amount),
    mode: text(entry?.mode, 60),
    reference: text(entry?.reference ?? entry?.ref, 120),
  };
}

/** Which statuses a customer may see a document in, per kind.
 *
 *  A DRAFT IS NEVER LISTED. A draft quotation is a half-priced, half-typed
 *  thing on somebody's screen, and the whole reason the portal is safe to
 *  hand out is that it shows only what was deliberately sent. */
const VISIBLE = {
  quotation: ["sent", "accepted", "rejected", "expired"],
  proforma: ["sent", "paid", "expired"],
  invoice: ["issued", "cancelled"],
};

export function isVisibleToCustomer(kind, status) {
  const allowed = VISIBLE[kind];
  if (!allowed) return false;
  return allowed.includes(String(status ?? "").trim().toLowerCase());
}

/**
 * A document, reduced to what is on its face.
 *
 * `kind` is passed in rather than read off the row, because it is decided by
 * which table the row came out of — a value inside `data` is not evidence of
 * anything.
 */
export function publicDocument(kind, row) {
  const d = row?.data ?? {};
  return {
    id: text(row?.id, 64),
    kind,
    number: text(d.number, 80),
    status: text(d.status, 40),
    date: text(d.date, 40),
    validUntil: text(d.validUntil, 40),
    subject: text(d.subject, 300),
    currency: text(d.currency, 8) || "INR",
    taxType: text(d.taxType, 40),
    referenceNo: text(d.referenceNo, 120),
    paymentTerms: text(d.paymentTerms, 500),
    deliveryTerms: text(d.deliveryTerms, 500),
    /* Who to reply to. A name, because it is signed on the document
       already — not an email or a phone number, which would turn a link
       forwarded around a customer's office into a contact list. */
    preparedBy: text(d.preparedBy, 120),
    intro: text(d.intro, 4000),
    footer: text(d.footer, 4000),
    terms: (Array.isArray(d.terms) ? d.terms : []).slice(0, 40).map((t) => text(t, 500)),
    items: (Array.isArray(d.items) ? d.items : []).slice(0, 300).map(publicLine),
    roundOff: !!d.roundOff,
    advancePercent: num(d.advancePercent),
    payments: (Array.isArray(d.paymentHistory) ? d.paymentHistory : []).slice(0, 100).map(publicPayment),
    updatedAt: num(d.updatedAt) || null,
  };
}

/**
 * The customer, as they would describe themselves.
 *
 * Their own contact details and tax numbers — things they told us, shown back
 * so they can see we have them right, which is worth the space because a wrong
 * GSTIN on an invoice is a credit note and a phone call. Nothing about how the
 * account is run: no owner, no stage, no deal value, no notes, no source, no
 * next follow-up date.
 */
export function publicCustomer(row) {
  const c = row?.data ?? {};
  return {
    code: text(c.code, 60),
    company: text(c.company, 200),
    contact: text(c.contact, 120),
    email: text(c.email, 200),
    phone: text(c.phone, 60),
    gstin: text(c.gstin, 20),
    address: text(c.address, 500),
    city: text(c.city, 120),
    state: text(c.state, 120),
    country: text(c.country, 120),
    pincode: text(c.pincode, 20),
  };
}

/**
 * The company's own letterhead.
 *
 * The same subset the public registration form already gets, for the same
 * reason: it is on the website. NOT the settings row, which carries bank
 * details, the company GSTIN and every integration secret in the workspace.
 *
 * Bank details are the interesting omission. They are printed on a proforma
 * on purpose — that is how a customer pays — but a portal page is a different
 * surface from a PDF that was emailed to a known address, and a link that
 * leaks becomes an invoice-fraud kit the moment it carries account numbers.
 * The PDF the customer already has is where they get them.
 */
export function publicCompany(settingsRow) {
  const s = settingsRow?.data ?? {};
  const company = s.company ?? {};
  const template = s.docTemplate ?? {};
  return {
    name: text(company.name, 200),
    tagline: text(company.tagline, 300),
    website: text(company.website, 200),
    logo: typeof s.logo === "string" ? s.logo : null,
    accentColor: text(template.accentColor, 20) || "#2563EB",
  };
}
