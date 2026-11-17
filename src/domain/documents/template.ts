/** Document template settings — carried forward from v1 verbatim.
 *  Section order, visibility, column toggles, labels and accent colour are
 *  all admin-configurable; the shapes here are what the live `settings` row
 *  already stores, so they must not be renamed. */

export type SectionKey =
  | "header" | "parties" | "intro" | "items"
  | "moneyBlock" | "notes" | "signature" | "logos" | "footer";

export const SECTION_ORDER_META: Record<SectionKey, { label: string; hint: string }> = {
  header: { label: "Header", hint: "Logo, company details, document title & metadata" },
  parties: { label: "Customer details", hint: "Bill to / billing / shipping address grid" },
  intro: { label: "Salutation / subject", hint: '"Dear Sir / Madam" intro (quotation) or subject line' },
  items: { label: "Items table", hint: "The product/service line-items table" },
  moneyBlock: { label: "Terms & Totals", hint: "Terms & Totals (quotation) or Bank Details & Totals (proforma), side by side" },
  notes: { label: "Notes", hint: "Proforma only — bulleted payment notes" },
  signature: { label: "Signature block", hint: "Signature, stamp, and Customer Acceptance / We Accept" },
  logos: { label: "Partner logo strip", hint: "Microsoft / Adobe / Autodesk etc. + Years of Excellence badge" },
  footer: { label: "Footer", hint: "Contact details and closing line" },
};

export const DEFAULT_SECTION_ORDER: SectionKey[] = [
  "header", "parties", "intro", "items", "moneyBlock", "notes", "signature", "logos", "footer",
];

/** Individually hideable sections. Absent === visible: v1 tested `!== false`
 *  everywhere, so a settings row saved before a toggle existed keeps showing
 *  that section rather than silently losing it. */
export interface SectionToggles {
  uaeOffice?: boolean;
  isoCerts?: boolean;
  terms?: boolean;
  bankDetails?: boolean;
  customerAcceptance?: boolean;
  partnerLogos?: boolean;
  yearsOfExcellence?: boolean;
  notes?: boolean;
  salutation?: boolean;
  amountInWords?: boolean;
  /** The square that opens the document again when scanned. */
  scanCode?: boolean;
}

/** Optional items-table columns. Same `!== false` rule as sections. */
export interface ColumnToggles {
  subDesc?: boolean;
  brand?: boolean;
  sku?: boolean;
  hsn?: boolean;
}

export interface DocLabels {
  salutation: string;
  termsHeading: string;
  bankHeading: string;
  notesHeading: string;
  acceptanceHeading: string;
  sealLabel: string;
  forCompanyPrefix: string;
  weAcceptLabel: string;
  quotedToHeading: string;
  billingHeading: string;
  shippingHeading: string;
  proformaBillHeading: string;
  closingQuote: string;
  closingProforma: string;
  amountInWordsLabel: string;
  grandTotalLabel: string;
}

/**
 * WHICH SHEET THE DOCUMENT IS PRINTED ON.
 *
 * "standard" is the design this CRM has always produced. "boxed" is the
 * dense, fully-ruled grid an Indian distributor's tax invoice uses — the
 * same facts, laid out as labelled cells so a customer's accounts
 * department can check it field by field against a purchase order.
 *
 * Absent means "standard", like every other toggle in this file: a
 * settings row saved before this existed keeps printing what it printed.
 */
export type DocLayout = "standard" | "boxed";

export const DOC_LAYOUTS: ReadonlyArray<readonly [DocLayout, string, string]> = [
  ["standard", "Standard", "The CRM's own design — roomy, with the partner strip and the annexure page."],
  ["boxed", "Boxed tax invoice", "The dense ruled grid distributors print. Every field in its own labelled cell."],
];

export interface DocTemplate {
  accentColor: string;
  layout?: DocLayout;
  sectionOrder: SectionKey[];
  sections: SectionToggles;
  columns: ColumnToggles;
  labels: DocLabels;
}

export const DEFAULT_LABELS: DocLabels = {
  salutation: "Dear Sir / Madam,",
  termsHeading: "Terms & Conditions",
  bankHeading: "Bank Details",
  notesHeading: "Notes",
  acceptanceHeading: "Customer Acceptance",
  sealLabel: "Company Seal",
  forCompanyPrefix: "For",
  weAcceptLabel: "We Accept",
  quotedToHeading: "Quoted To (Bill To)",
  billingHeading: "Billing Address",
  shippingHeading: "Shipping Address (If different)",
  proformaBillHeading: "Bill To",
  closingQuote: "Thank you for the opportunity to submit this quotation.",
  closingProforma: "This is a Proforma Invoice and not a Tax Invoice.",
  amountInWordsLabel: "Amount in Words:",
  grandTotalLabel: "Grand Total",
};

export const DEFAULT_DOC_TEMPLATE: DocTemplate = {
  accentColor: "#2563EB",
  layout: "standard",
  sectionOrder: DEFAULT_SECTION_ORDER,
  sections: {
    /* Off by default: the approved reference quotation carries neither a
       customer-acceptance box nor "We Accept" payment icons — just the plain
       "For {company} / Authorised signatory" block, which always prints. */
    uaeOffice: true, isoCerts: true, terms: true, bankDetails: true,
    customerAcceptance: false, partnerLogos: true, yearsOfExcellence: true,
    notes: true, salutation: true, amountInWords: true, scanCode: true,
  },
  columns: { subDesc: true, brand: true, sku: true, hsn: true },
  labels: DEFAULT_LABELS,
};

/** A section or column is visible unless explicitly switched off. */
export const isOn = (flag: boolean | undefined): boolean => flag !== false;

/** Merge a stored template over the defaults so a partially-saved or older
 *  settings row can never produce an undefined label at render time. */
export function normalizeDocTemplate(saved: Partial<DocTemplate> | null | undefined): DocTemplate {
  const order = saved?.sectionOrder?.length ? saved.sectionOrder : DEFAULT_SECTION_ORDER;
  return {
    accentColor: saved?.accentColor || DEFAULT_DOC_TEMPLATE.accentColor,
    /* Only a layout this build knows how to draw. A settings row holding
       the name of a layout that was renamed, or anything at all, prints the
       standard sheet rather than nothing. */
    layout: DOC_LAYOUTS.some(([key]) => key === saved?.layout)
      ? (saved?.layout as DocLayout)
      : "standard",
    sectionOrder: order,
    sections: { ...DEFAULT_DOC_TEMPLATE.sections, ...(saved?.sections ?? {}) },
    columns: { ...DEFAULT_DOC_TEMPLATE.columns, ...(saved?.columns ?? {}) },
    labels: { ...DEFAULT_LABELS, ...(saved?.labels ?? {}) },
  };
}
