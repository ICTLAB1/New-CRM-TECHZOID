import { addDays, TODAY } from "../dates";
import { buildDocNumber } from "../numbering/docNumber";
import type { Customer } from "../customers/customer";
import type { LineItem } from "../tax/types";
import { DOMESTIC_TERMS, suggestTermsSet } from "./terms";

/**
 * Creating and converting documents.
 *
 * ONE field map, used by every path.
 *
 * v1 lost `billCountry`, `billPan`, `currency` and `taxType` twice: once when
 * a customer was picked in the editor, and again — along with every shipping
 * field — when a proforma was generated from a quotation. Two separate code
 * paths, the same omission, found months apart. They are the same map here,
 * and a test enumerates it, so a field added to a document cannot be quietly
 * missed by one path.
 */

export type DocStatus = "Draft" | "Sent" | "Accepted" | "Rejected" | "Expired";
export type ProformaStatus = "Draft" | "Sent" | "Paid" | "Expired";

export const QUOTE_STATUSES: readonly DocStatus[] = ["Draft", "Sent", "Accepted", "Rejected", "Expired"];
export const PROFORMA_STATUSES: readonly ProformaStatus[] = ["Draft", "Sent", "Paid", "Expired"];

export interface DocSettings {
  quotePrefix?: string;
  quoteSeq?: number;
  proformaPrefix?: string;
  proformaSeq?: number;
  defaultCurrency?: string;
  defaultTaxType?: string;
  defaultGst?: number;
  defaultValidityDays?: number;
  defaultTerms?: readonly string[];
  quoteTemplates?: { id: string; name: string; intro?: string; footer?: string; terms?: readonly string[] }[];
}

export interface SalesDocument {
  id: string;
  number: string;
  ownerId: string;
  customerId: string;
  quoteId?: string;
  quoteNumber?: string;

  billName: string;
  billContact: string;
  billAddress: string;
  billState: string;
  billCountry: string;
  billGstin: string;
  billPan: string;
  billEmail: string;
  billPhone: string;

  shipSameAsBilling: boolean;
  shipName: string;
  shipAddress: string;
  shipState: string;
  shipCountry: string;
  shipGstin: string;
  shipPan: string;
  shipContact: string;
  shipPhone: string;
  shipEmail: string;

  currency: string;
  taxType: string;

  customerCode?: string;
  referenceNo: string;
  enquiryRef?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  revisionNo: number;
  subject: string;
  date: string;
  validUntil: string;
  status: string;
  items: LineItem[];
  terms: string[];
  intro?: string;
  footer?: string;
  notes?: string;
  roundOff: boolean;
  advancePercent?: number;
  paymentHistory?: unknown[];
  bankAccountId?: string;
  templateId?: string;
  preparedBy: string;
  createdAt: number;
  updatedAt: number;
}

const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/**
 * Every document field derived from a customer record.
 *
 * THIS IS THE LIST. Adding a field to a document that should follow the
 * customer means adding it here — not to a call site. `documentFieldsFrom`
 * is the only way a customer reaches a document.
 */
export const CUSTOMER_DERIVED_FIELDS = [
  "customerId", "ownerId",
  "billName", "billContact", "billAddress", "billState", "billCountry",
  "billGstin", "billPan", "billEmail", "billPhone",
  "currency", "taxType",
] as const;

/** The tax regime for a customer: theirs if set, otherwise none for an
 *  export (GST cannot apply) and the configured default at home. */
export function taxTypeFor(customer: Customer | null, settings: DocSettings): string {
  if (customer?.taxType) return customer.taxType;
  const isExport = !!customer?.country && customer.country !== "India";
  return isExport ? "none" : settings.defaultTaxType || "gst";
}

/** Every customer-derived field, in one place. */
export function documentFieldsFrom(customer: Customer | null, settings: DocSettings) {
  if (!customer) {
    return {
      customerId: "", ownerId: "",
      billName: "", billContact: "", billAddress: "", billState: "Delhi", billCountry: "India",
      billGstin: "", billPan: "", billEmail: "", billPhone: "",
      currency: settings.defaultCurrency || "INR",
      taxType: settings.defaultTaxType || "gst",
    };
  }
  return {
    customerId: customer.id,
    ownerId: customer.ownerId,
    billName: customer.company ?? "",
    billContact: customer.contact ?? "",
    billAddress: [customer.address, customer.city, customer.pincode].filter(Boolean).join(", "),
    billState: customer.state ?? "",
    billCountry: customer.country || "India",
    billGstin: customer.gstin ?? "",
    billPan: customer.pan ?? "",
    billEmail: customer.email ?? "",
    billPhone: customer.phone ?? "",
    currency: customer.currency || settings.defaultCurrency || "INR",
    taxType: taxTypeFor(customer, settings),
  };
}

/**
 * Apply a customer to an existing document.
 *
 * New documents are always created with no customer and linked afterwards,
 * so the picker — not the constructor — is the real entry point for these
 * fields. That is exactly why dropping four of them here went unnoticed.
 */
export function applyCustomer<T extends SalesDocument>(doc: T, customer: Customer | null, settings: DocSettings): T {
  return { ...doc, ...documentFieldsFrom(customer, settings), updatedAt: Date.now() };
}

export function blankItem(gst: number | undefined): LineItem {
  return { id: uid(), desc: "", subDesc: "", brand: "", sku: "", hsn: "", qty: 1, unit: "Nos", rate: "", disc: 0, gst: gst ?? 18 };
}

const emptyShipping = () => ({
  shipSameAsBilling: true, shipName: "", shipAddress: "", shipState: "", shipCountry: "",
  shipGstin: "", shipPan: "", shipContact: "", shipPhone: "", shipEmail: "",
});

/** Terms that match the customer: an export quotation carrying GST clauses
 *  and Indian jurisdiction is a real commercial problem. Always editable. */
function termsFor(customer: Customer | null, settings: DocSettings, templateTerms?: readonly string[]): string[] {
  const set = suggestTermsSet(customer?.country);
  if (set.id === "international") return [...set.terms];
  if (templateTerms?.length) return [...templateTerms];
  return [...(settings.defaultTerms ?? DOMESTIC_TERMS)];
}

export interface NewDocOptions {
  settings: DocSettings;
  user: { id: string; name: string };
  customer?: Customer | null;
  today?: string;
}

export function newQuotation({ settings, user, customer = null, today = TODAY() }: NewDocOptions): SalesDocument {
  const template = settings.quoteTemplates?.[0];
  const fields = documentFieldsFrom(customer, settings);
  return {
    id: uid(),
    number: buildDocNumber(settings.quotePrefix ?? "TZ/QT", settings.quoteSeq),
    ...fields,
    ownerId: fields.ownerId || user.id,
    ...emptyShipping(),
    subject: "Quotation for IT products and services",
    referenceNo: "", enquiryRef: "", revisionNo: 0,
    paymentTerms: "As specified", deliveryTerms: "As specified",
    customerCode: "",
    date: today,
    validUntil: addDays(today, settings.defaultValidityDays ?? 15),
    status: "Draft",
    items: [blankItem(settings.defaultGst)],
    templateId: template?.id,
    intro: template?.intro ?? "",
    footer: template?.footer ?? "",
    terms: termsFor(customer, settings, template?.terms),
    notes: "",
    roundOff: true,
    preparedBy: user.name,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

export function newProforma({ settings, user, customer = null, today = TODAY() }: NewDocOptions): SalesDocument {
  const fields = documentFieldsFrom(customer, settings);
  return {
    id: uid(),
    number: buildDocNumber(settings.proformaPrefix ?? "TZ/PI", settings.proformaSeq),
    ...fields,
    ownerId: fields.ownerId || user.id,
    quoteId: "", quoteNumber: "",
    ...emptyShipping(),
    subject: "Proforma invoice for IT products and services",
    referenceNo: "", enquiryRef: "", revisionNo: 0, bankAccountId: "",
    paymentTerms: "As specified", deliveryTerms: "As specified",
    customerCode: "",
    date: today,
    validUntil: addDays(today, settings.defaultValidityDays ?? 15),
    status: "Draft",
    items: [blankItem(settings.defaultGst)],
    terms: termsFor(customer, settings),
    advancePercent: 100,
    notes: "",
    roundOff: true,
    paymentHistory: [],
    preparedBy: user.name,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/**
 * Every field a conversion or duplication carries over.
 *
 * Enumerated rather than spread, because the bug it prevents was a hand-typed
 * field list that forgot four of them. The test asserts this covers every
 * party, shipping and commercial field on the document.
 */
export const CARRIED_FIELDS = [
  "customerId",
  "billName", "billContact", "billAddress", "billState", "billCountry",
  "billGstin", "billPan", "billEmail", "billPhone",
  "shipSameAsBilling", "shipName", "shipAddress", "shipState", "shipCountry",
  "shipGstin", "shipPan", "shipContact", "shipPhone", "shipEmail",
  "currency", "taxType",
  "customerCode", "referenceNo", "enquiryRef", "paymentTerms", "deliveryTerms",
  "subject", "roundOff",
] as const;

function carryOver(source: SalesDocument): Pick<SalesDocument, (typeof CARRIED_FIELDS)[number]> {
  const out = {} as Record<string, unknown>;
  for (const key of CARRIED_FIELDS) out[key] = source[key];
  return out as Pick<SalesDocument, (typeof CARRIED_FIELDS)[number]>;
}

/** A proforma raised against a quotation. Carries everything; keeps the link. */
export function proformaFromQuotation(
  quote: SalesDocument,
  settings: DocSettings,
  user: { name: string },
  today: string = TODAY(),
): SalesDocument {
  return {
    id: uid(),
    number: buildDocNumber(settings.proformaPrefix ?? "TZ/PI", settings.proformaSeq),
    ownerId: quote.ownerId,
    quoteId: quote.id,
    quoteNumber: quote.number,
    ...carryOver(quote),
    date: today,
    validUntil: addDays(today, settings.defaultValidityDays ?? 15),
    status: "Draft",
    revisionNo: 0,
    items: quote.items.map((it) => ({ ...it, id: uid() })),
    terms: [...(quote.terms ?? [])],
    advancePercent: 100,
    notes: "",
    paymentHistory: [],
    bankAccountId: "",
    preparedBy: user.name,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/**
 * Duplicate a quotation: a fresh number, back to Draft, dates refreshed.
 *
 * Copying the number would produce two live documents claiming to be the
 * same one, and copying an Accepted status would claim the customer accepted
 * something they have never seen.
 */
export function duplicateQuotation(
  quote: SalesDocument,
  settings: DocSettings,
  today: string = TODAY(),
): SalesDocument {
  return {
    ...quote,
    id: uid(),
    number: buildDocNumber(settings.quotePrefix ?? "TZ/QT", settings.quoteSeq),
    ...carryOver(quote),
    status: "Draft",
    revisionNo: 0,
    date: today,
    validUntil: addDays(today, settings.defaultValidityDays ?? 15),
    items: quote.items.map((it) => ({ ...it, id: uid() })),
    terms: [...(quote.terms ?? [])],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/** A quotation past its validity reads as Expired without being rewritten —
 *  the stored status is what the salesperson set, this is what is true. */
export function effectiveStatus(doc: Pick<SalesDocument, "status" | "validUntil">, today: string = TODAY()): string {
  if (doc.status === "Sent" && doc.validUntil && doc.validUntil < today) return "Expired";
  return doc.status;
}
