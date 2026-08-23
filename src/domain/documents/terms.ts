/**
 * Default commercial terms.
 *
 * These are commercial boilerplate, not legal advice. They should be reviewed
 * by a legal adviser before being relied on for significant contracts —
 * particularly the liability, warranty and dispute-resolution clauses, which
 * are the ones tested when something goes wrong. Settings shows that notice.
 *
 * Both sets are always selectable and fully editable per document; the export
 * set is suggested automatically when the customer sits outside India.
 */

/**
 * Domestic (India) — the fourteen clauses supplied with the approved
 * quotation design, used verbatim.
 *
 * NOTE, deliberately recorded: v1's domestic terms carried a clause making
 * licence keys, activation codes and subscriptions non-returnable once
 * delivered or activated. The approved design's terms omit it and its spec
 * says not to mention licence keys, activation or provisioning at all. That
 * removes the clause that covered the company's main product line on returns.
 * Retained here as supplied, on an explicit decision — see
 * docs/DEVIATIONS.md before restoring it.
 */
export const DOMESTIC_TERMS: readonly string[] = [
  "Quotation is valid for 30 days from the date of issue unless otherwise specified.",
  "Prices are exclusive of applicable GST, taxes, duties, freight and other charges unless specifically stated otherwise.",
  "Product, service and availability are subject to confirmation at the time of order.",
  "Order confirmation is subject to receipt and acceptance of a valid Purchase Order and/or payment, as applicable.",
  "Payment terms shall be as specified in this quotation and are subject to TechZoid's approved commercial terms.",
  "Delivery timelines are indicative and may vary depending on product availability, manufacturer/distributor schedules and logistics.",
  "Product specifications, models and availability may be subject to change by the respective manufacturer without prior notice.",
  "Hardware products are subject to the applicable manufacturer's warranty and support terms.",
  "Any installation, configuration, deployment or other professional services are included only where specifically mentioned in this quotation.",
  "Any cancellation, modification or change to an order after confirmation shall be subject to applicable commercial and supplier terms.",
  "The customer is responsible for providing accurate billing, delivery and order-related information required for fulfilment.",
  "TechZoid Technologies Private Limited shall not be responsible for delays caused by circumstances beyond its reasonable control, including manufacturer, distributor, logistics or regulatory delays.",
  "Acceptance of this quotation constitutes acceptance of the applicable terms and conditions stated herein, unless otherwise agreed in writing.",
  "All disputes shall be subject to the jurisdiction of the courts at New Delhi, India.",
];

/**
 * International / export.
 *
 * A domestic Indian sale and an export differ in law, not just in wording:
 * GST versus zero-rated export, Indian courts versus arbitration, no customs
 * versus Incoterms and duties, INR versus exchange-rate risk, and
 * cross-border data and sanctions obligations.
 */
export const INTERNATIONAL_TERMS: readonly string[] = [
  "All prices are quoted in the currency stated on this quotation and are exclusive of all taxes, duties, levies and charges applicable outside India.",
  "This supply is an export from India and is zero-rated under the Integrated Goods and Services Tax Act. Any tax, duty or levy applicable in the country of import is to the customer's account.",
  "Delivery is on the Incoterms 2020 basis stated on this quotation. Where none is stated, delivery is Ex Works (EXW) New Delhi, India.",
  "The customer is the importer of record and is responsible for customs clearance, import licences, duties and all regulatory approvals in the destination country.",
  "Quoted prices are based on exchange rates prevailing at the date of quotation. Material variation before payment may require the price to be revised by agreement.",
  "Payment shall be made by irrevocable letter of credit or telegraphic transfer in the quoted currency, free of all bank charges to TechZoid Technologies Private Limited.",
  "Product specifications, models and availability may be subject to change by the respective manufacturer without prior notice.",
  "Hardware products are subject to the applicable manufacturer's warranty and support terms. Warranty service outside India is subject to the manufacturer's regional coverage.",
  "The goods and services supplied are subject to export control and sanctions laws. The customer warrants that it will not re-export or divert them in breach of any applicable law.",
  "Each party shall comply with applicable data protection law in respect of any personal data exchanged under this quotation.",
  "The total liability of TechZoid Technologies Private Limited arising out of or in connection with this quotation shall not exceed the value of the goods or services supplied.",
  "The United Nations Convention on Contracts for the International Sale of Goods (CISG) is excluded.",
  "Any dispute shall be finally resolved by arbitration seated in New Delhi, India, under the Arbitration and Conciliation Act, 1996, in the English language.",
  "Acceptance of this quotation constitutes acceptance of the terms stated herein, unless otherwise agreed in writing.",
];

export interface TermsSet {
  id: "domestic" | "international";
  label: string;
  hint: string;
  terms: readonly string[];
}

export const TERMS_SETS: readonly TermsSet[] = [
  { id: "domestic", label: "Domestic (India)", hint: "GST, Indian jurisdiction, INR pricing", terms: DOMESTIC_TERMS },
  { id: "international", label: "International / Export", hint: "Incoterms, customs, arbitration, export control", terms: INTERNATIONAL_TERMS },
];

/** Suggested from the customer's country. Both sets stay selectable, and the
 *  suggestion is applied automatically only for a NEW export quotation. */
export function suggestTermsSet(country: string | null | undefined): TermsSet {
  const isExport = !!(country || "").trim() && (country || "").trim() !== "India";
  return (isExport ? TERMS_SETS[1] : TERMS_SETS[0]) as TermsSet;
}

export const LEGAL_NOTICE =
  "These are commercial boilerplate terms, not legal advice. Have your legal adviser review them before relying on them for significant contracts.";
