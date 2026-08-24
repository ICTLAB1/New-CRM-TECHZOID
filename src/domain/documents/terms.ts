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

/**
 * Purchase order — the terms WE impose on a SUPPLIER.
 *
 * These face the opposite way from the two sets above, which is why they are
 * a separate list rather than a variation. On a quotation the company is the
 * seller and the clauses limit what it promises; on a purchase order the
 * company is the buyer and the clauses are what the supplier must meet. A
 * warranty clause written for a quotation disclaims; the same clause on a
 * purchase order demands.
 *
 * Same caveat as the rest of this file, and it matters more here: these are
 * commercial boilerplate, not legal advice. The liquidated-damages,
 * indemnity, title and jurisdiction clauses in particular should be reviewed
 * by a legal adviser before being relied on for a significant order — they
 * are the ones that get tested when a supplier fails to deliver.
 */
export const PURCHASE_ORDER_TERMS: readonly string[] = [
  "This purchase order is placed subject to the terms and conditions stated herein. Commencement of supply, acknowledgement, or delivery against this order constitutes acceptance of these terms in full.",
  "Any terms proposed by the supplier, whether in a quotation, acknowledgement, invoice or otherwise, that conflict with or add to these terms shall have no effect unless accepted by TechZoid Technologies Private Limited in writing.",
  "The prices stated in this purchase order are firm and inclusive of packing, marking and loading. No escalation, surcharge or additional charge of any kind shall be payable unless agreed in writing before despatch.",
  "Goods and services shall be supplied strictly in the quantities, specifications, makes, models and part numbers stated in this purchase order. Any substitution requires prior written approval.",
  "Delivery shall be completed by the delivery date stated in this purchase order. Time is of the essence. The supplier shall notify any anticipated delay immediately on becoming aware of it.",
  "Where delivery is delayed beyond the agreed date without written agreement, TechZoid Technologies Private Limited reserves the right to claim liquidated damages, to procure the goods or services elsewhere at the supplier's cost, or to cancel the undelivered balance without liability.",
  "Goods shall be securely packed for the mode of transport used, and each consignment shall carry this purchase order number on the packing list and on all outer packaging.",
  "All goods are subject to inspection on receipt. Goods found short, damaged, defective or not conforming to this purchase order may be rejected and returned at the supplier's risk and cost, and payment for them may be withheld.",
  "Title and risk in the goods shall pass to TechZoid Technologies Private Limited on delivery at the stated ship-to address and acceptance following inspection, notwithstanding any earlier payment.",
  "The supplier warrants that all goods are new, unused, free from defects in material and workmanship, of merchantable quality, and free from any lien or encumbrance, and that all services will be performed with reasonable skill and care.",
  "The supplier warrants that the goods and services do not infringe any third-party intellectual property right, and shall indemnify TechZoid Technologies Private Limited against any claim, loss or expense arising from such infringement.",
  "The manufacturer's standard warranty shall pass to TechZoid Technologies Private Limited and, where applicable, to its customer. Warranty documentation, licence keys and entitlement details shall be supplied with the goods.",
  "A GST-compliant tax invoice quoting this purchase order number, the correct HSN/SAC codes and the GSTIN of TechZoid Technologies Private Limited shall accompany every despatch. Payment cannot be processed against a non-compliant invoice.",
  "The supplier shall report the supply correctly and on time in its GST returns so that input tax credit is available to TechZoid Technologies Private Limited. Any credit lost or reversed on account of the supplier's default, together with interest and penalty, shall be recoverable from the supplier.",
  "The supplier shall provide the e-way bill, delivery challan, lorry receipt and any other statutory or transport documentation required for lawful movement of the goods.",
  "Payment shall be made in accordance with the payment terms stated in this purchase order, calculated from the date of receipt of both the goods and a compliant invoice, whichever is later.",
  "TechZoid Technologies Private Limited may set off any amount owed by the supplier against any amount payable under this or any other purchase order.",
  "This purchase order may be cancelled in whole or in part, without liability, at any time before despatch, and at any time where the supplier commits a material breach or becomes insolvent.",
  "The supplier shall not assign or subcontract this purchase order, in whole or in part, without prior written consent.",
  "The supplier shall keep confidential all information disclosed in connection with this purchase order, including customer identities and pricing, and shall not use it for any other purpose.",
  "The supplier shall comply with all applicable laws, including those relating to labour, health and safety, environmental protection, anti-bribery and anti-corruption, and shall not offer any inducement to any employee of TechZoid Technologies Private Limited.",
  "Neither party shall be liable for failure to perform caused by circumstances beyond its reasonable control, provided the affected party notifies the other promptly and resumes performance as soon as practicable.",
  "Nothing in this purchase order creates a partnership, joint venture, agency or employment relationship between the parties.",
  "This purchase order, together with any document expressly referred to in it, constitutes the entire agreement between the parties in respect of the goods and services ordered.",
  "This purchase order shall be governed by the laws of India, and all disputes shall be subject to the exclusive jurisdiction of the courts at New Delhi, India.",
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
