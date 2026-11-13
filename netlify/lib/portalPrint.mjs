import { publicLine, isVisibleToCustomer } from "./portalView.mjs";

/**
 * The document itself, for a customer who asks to download it.
 *
 * WHY THERE IS A SECOND ALLOWLIST. portalView.mjs builds what the portal
 * PAGE shows — the lines, the totals, the terms, the customer's own
 * details. A PDF is more than that: it is the piece of paper, with the
 * letterhead, the registration numbers, the signature block and the bank
 * details printed on it. Those are not on the page and must not be added
 * to it. They are on the document, and the document is what this returns.
 *
 * SO THIS IS A WIDER LIST, AND IT IS STILL A LIST. Everything here is
 * named; a field added to settings or to a document next year is invisible
 * to this until somebody adds it, and the test beside this file fails if
 * anything unnamed appears. What it must never carry is what the paper
 * never carried: what we paid for a line, who owns the account, what the
 * deal is worth, the integration secrets in the settings row.
 *
 * BANK DETAILS ARE INCLUDED, and that reverses what the page does on
 * purpose. The page leaves them out because a page is rendered from JSON
 * by anybody holding the link, and account numbers in that payload are an
 * invoice-fraud kit for a link that leaks. But the customer is downloading
 * the document that was emailed to them, which has those details printed
 * on it — that is how they pay. A copy with the bank block missing is not
 * the document, and a customer who cannot pay from it will ask for one
 * that works. The link expires and can be withdrawn; the account numbers
 * are printed on every document this company sends.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v, max = 2000) => String(v ?? "").slice(0, max);
const flag = (v) => !!v;

/** One bank account, as it is printed in the document's bank block. */
function printableBank(account) {
  return {
    name: text(account?.name, 160),
    accountName: text(account?.accountName, 200),
    account: text(account?.account, 60),
    ifsc: text(account?.ifsc, 20),
    swift: text(account?.swift, 20),
    branch: text(account?.branch, 200),
    accountType: text(account?.accountType, 60),
    currency: text(account?.currency, 8),
    id: text(account?.id, 64),
    isDefault: flag(account?.isDefault),
  };
}

/**
 * The settings the renderer reads, and nothing else.
 *
 * Keyed to what src/domain/documents/model.ts actually looks at: the
 * company block, the UAE office banner, the signatory, the partner and
 * certification names, the template, and the bank accounts. The settings
 * row also holds every integration secret in the workspace, the customer
 * numbering counter and the product catalog with its buying prices —
 * which is why this builds a new object rather than deleting keys from
 * that one.
 */
export function printableSettings(settingsRow) {
  const s = settingsRow?.data ?? {};
  const c = s.company ?? {};
  const uae = s.uaeOffice ?? {};
  const accounts = Array.isArray(s.bankAccounts) ? s.bankAccounts : [];

  return {
    company: {
      name: text(c.name, 200),
      tagline: text(c.tagline, 300),
      address: text(c.address, 500),
      city: text(c.city, 120),
      state: text(c.state, 120),
      pincode: text(c.pincode, 20),
      country: text(c.country, 120),
      phone: text(c.phone, 60),
      email: text(c.email, 200),
      website: text(c.website, 200),
      gstin: text(c.gstin, 20),
      pan: text(c.pan, 20),
      cin: text(c.cin, 40),
      logo: typeof c.logo === "string" ? c.logo : (typeof s.logo === "string" ? s.logo : ""),
      logoW: num(c.logoW),
      logoH: num(c.logoH),
    },
    uaeOffice: {
      address: text(uae.address, 500),
      phone: text(uae.phone, 60),
      businessLicense: text(uae.businessLicense, 60),
      taxRegistrationNumber: text(uae.taxRegistrationNumber, 60),
    },
    signatoryName: text(s.signatoryName, 160),
    signatoryDesignation: text(s.signatoryDesignation, 160),
    /* Names, as text. The artwork is not here and never was — see the note
       in domain/integrations/emailTemplate.ts about badges. */
    partnerDesignations: (Array.isArray(s.partnerDesignations) ? s.partnerDesignations : [])
      .slice(0, 40).map((t) => text(t, 160)),
    brandingLogos: (Array.isArray(s.brandingLogos) ? s.brandingLogos : [])
      .slice(0, 40).map((t) => text(t, 160)),
    certLogos: (Array.isArray(s.certLogos) ? s.certLogos : [])
      .slice(0, 40).map((t) => text(t, 160)),
    /* Which sections are printed and what they are called. Presentation. */
    docTemplate: s.docTemplate && typeof s.docTemplate === "object" ? s.docTemplate : null,
    bankAccounts: accounts.slice(0, 20).map(printableBank),
    bank: s.bank && typeof s.bank === "object" ? printableBank(s.bank) : null,
  };
}

/**
 * The document, as it is printed.
 *
 * The page's own payload (publicDocument) is deliberately narrower and
 * cannot be reused: the paper carries the ship-to block, the enquiry
 * reference and the revision number, which the page has no room for.
 * `publicLine` IS reused, because the rule about a line is the same
 * wherever it is shown — the cost of it never leaves.
 */
export function printableDocument(kind, row) {
  const d = row?.data ?? {};
  return {
    id: text(row?.id, 64),
    kind,
    number: text(d.number, 80),
    quoteNumber: text(d.quoteNumber, 80),
    revisionNo: num(d.revisionNo),
    status: text(d.status, 40),
    date: text(d.date, 40),
    validUntil: text(d.validUntil, 40),
    subject: text(d.subject, 300),
    currency: text(d.currency, 8) || "INR",
    taxType: text(d.taxType, 40),
    roundOff: flag(d.roundOff),
    advancePercent: num(d.advancePercent),
    referenceNo: text(d.referenceNo, 120),
    enquiryRef: text(d.enquiryRef, 120),
    customerCode: text(d.customerCode, 60),
    preparedBy: text(d.preparedBy, 120),
    paymentTerms: text(d.paymentTerms, 500),
    deliveryTerms: text(d.deliveryTerms, 500),
    intro: text(d.intro, 4000),
    footer: text(d.footer, 4000),
    terms: (Array.isArray(d.terms) ? d.terms : []).slice(0, 40).map((t) => text(t, 500)),
    items: (Array.isArray(d.items) ? d.items : []).slice(0, 300).map(publicLine),
    bankAccountId: text(d.bankAccountId, 64),
    /* The bill-to and ship-to blocks: the customer's own details, printed
       on the document they were sent. */
    billName: text(d.billName, 200),
    billAddress: text(d.billAddress, 500),
    billState: text(d.billState, 120),
    billCountry: text(d.billCountry, 120),
    billGstin: text(d.billGstin, 20),
    billPan: text(d.billPan, 20),
    billContact: text(d.billContact, 120),
    billEmail: text(d.billEmail, 200),
    billPhone: text(d.billPhone, 60),
    shipSameAsBilling: flag(d.shipSameAsBilling),
    shipName: text(d.shipName, 200),
    shipAddress: text(d.shipAddress, 500),
    shipState: text(d.shipState, 120),
    shipCountry: text(d.shipCountry, 120),
    shipGstin: text(d.shipGstin, 20),
    shipPan: text(d.shipPan, 20),
    shipContact: text(d.shipContact, 120),
    shipEmail: text(d.shipEmail, 200),
    shipPhone: text(d.shipPhone, 60),
  };
}

/** The same visibility rule the page uses: a draft is never downloadable. */
export { isVisibleToCustomer };
