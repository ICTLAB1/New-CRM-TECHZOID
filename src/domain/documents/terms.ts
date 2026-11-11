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
 * THE SELLER'S OWN NAME, AS A TOKEN.
 *
 * Every set below names the company whose document it is — in the delay
 * clause, the payment clause, the liability cap. That name was written into
 * the text, which was harmless while there was one company in this CRM and
 * wrong the moment there were two: Vertex's invoice would have carried
 * TechZoid's name in its own terms, promising and disclaiming on behalf of
 * a different business. It is the same mistake as the TZ/ prefix on
 * Vertex's first quotation number.
 *
 * Substituted when a set is applied to a document, never stored as a token:
 * a document already saved keeps the text it was saved with, and for
 * TechZoid the result is character-for-character what it was before.
 */
import { partitionClauses } from "./clauses";

export const SELLER_TOKEN = "{{company}}";

/** A set with the seller's name filled in. Falls back to a neutral phrase
 *  rather than any company's name when settings have none — a term naming
 *  the wrong business is worse than one naming none. */
export function forCompany(terms: readonly string[], company: string | null | undefined): string[] {
  const name = (company ?? "").trim() || "the Company";
  return terms.map((t) => t.split(SELLER_TOKEN).join(name));
}

/**
 * Domestic (India) — the terms supplied by the company, used verbatim.
 *
 * Replaces the fourteen clauses of the original approved design. These are
 * longer, they carry run-in headings, and they cover the things that set
 * this business apart from a generic reseller: TDS on software licences,
 * licence activation and delivery, subscription renewal, price variation
 * on foreign-currency subscriptions, and the precedence of GeM bid
 * conditions on government orders.
 *
 * THREE THINGS WERE NOT COPIED LITERALLY, and each is deliberate:
 *
 *  - The company's own name, in the force majeure clause, is the
 *    {{company}} token. The supplied text names TechZoid; this CRM also
 *    raises documents for a second company, and a force majeure clause
 *    naming the wrong business excuses the wrong one. See SELLER_TOKEN.
 *
 *  - The GeM note is the last entry rather than a twenty-first clause. It
 *    says the GeM conditions PREVAIL over these terms, so numbering it
 *    among them would make it one of the things it overrides. It is
 *    recognised by its "Important Note" label and printed after the
 *    numbered list — see clauses.ts.
 *
 *  - Nothing else. The clause wording, including the citation in the TDS
 *    clause, is the company's own and is reproduced exactly.
 *
 * Standing caveat, and it applies with more force to a set this specific:
 * these are commercial terms supplied by the company, not legal advice
 * from this CRM. The TDS, limitation of liability, cancellation and
 * jurisdiction clauses are the ones tested when something goes wrong.
 */
export const DOMESTIC_TERMS: readonly string[] = [
  "Quotation Validity: This quotation is valid for 7 days from the date of issue, unless otherwise specified. Prices and product availability are subject to change thereafter.",
  "Taxes & GST: All applicable taxes shall be charged at the rates prevailing on the date of invoicing. Currently, GST at 18% is applicable wherever applicable and shall be charged extra unless specifically included in the quotation.",
  "TDS on Software Licenses: No TDS shall be deducted on the purchase of software licenses wherever the transaction qualifies for exemption under applicable provisions of the Income-tax Act, 1961, read with CBDT Notification No. 21/2012 [F. No. 142/10/2012-SO (TPL)], S.O. 1323(E), dated 13 June 2012, effective from 1 July 2012. The exemption shall be subject to fulfilment of the prescribed conditions under the applicable law.",
  "Payment Terms: Payment shall be made as per the terms specified in the quotation. Unless otherwise agreed in writing, advance payment shall be required before processing the order.",
  "Order Confirmation: Orders shall be considered confirmed only upon receipt of an official Purchase Order (PO) and/or advance payment, as applicable.",
  "Delivery Timeline: Delivery and execution timelines are indicative and subject to product availability, vendor approvals, licensing activation and other dependencies beyond our reasonable control.",
  "Software Licensing: All software licenses and subscriptions are subject to the respective manufacturer's licensing terms, conditions, usage policies and End User License Agreement (EULA).",
  "License Activation & Delivery: Software licenses, activation keys, subscription entitlements and digital products shall be delivered electronically or through the manufacturer's designated portal, wherever applicable. Customers are responsible for providing accurate account, tenant and user details required for activation.",
  "Cancellation & Refund: Once software licenses, subscriptions, activation keys or digital entitlements have been procured, issued or activated, orders shall be non-cancellable and non-refundable, except where required by applicable law or expressly approved by the manufacturer.",
  "Subscription & Renewal: Subscription licenses are valid for the period specified in the quotation. Renewal, extension or continuation beyond the subscription period shall be subject to fresh commercial terms and prevailing manufacturer pricing. Auto-renewal shall not be assumed unless expressly agreed.",
  "Hardware Warranty: Hardware products shall carry the manufacturer's standard warranty, wherever applicable. Warranty claims shall be governed by the respective manufacturer's warranty policies and procedures.",
  "Technical Support: Installation, configuration, implementation, migration, training and technical support are excluded unless specifically mentioned in the quotation.",
  "Price Variation: Prices for software licenses, imported products and foreign-currency-denominated subscriptions are subject to manufacturer price revisions, exchange-rate fluctuations and changes in applicable duties and taxes until order confirmation.",
  "Third-Party Dependencies: We shall not be responsible for delays or disruptions caused by manufacturers, distributors, cloud service providers, licensing portals or other third parties beyond our reasonable control.",
  "Customer Responsibilities: The customer shall ensure that all information, email IDs, domain details, tenant information, technical specifications and other details provided for order processing are accurate and complete. Any delay arising from incorrect or incomplete information shall be the customer's responsibility.",
  "Limitation of Liability: To the extent permitted by applicable law, our liability arising from any transaction shall be limited to the amount received against the specific product or service giving rise to the claim. We shall not be liable for indirect, incidental, special or consequential losses.",
  "Force Majeure: {{company}} shall not be held liable for delays or failure to perform obligations due to circumstances beyond its reasonable control, including natural disasters, government restrictions, strikes, war, internet outages or manufacturer disruptions.",
  "Confidentiality: The pricing, commercial terms and contents of this quotation are confidential and intended solely for the addressed customer. They shall not be disclosed to third parties without prior written consent.",
  "Governing Law & Jurisdiction: All transactions shall be governed by the laws of India. Courts at New Delhi shall have jurisdiction over disputes arising out of this quotation and the resulting transaction, subject to applicable law.",
  "Acceptance of Terms: Placement of a Purchase Order, written acceptance or payment against this quotation shall constitute acceptance of the applicable commercial terms and conditions.",
  "Important Note: For Government and GeM transactions, the applicable GeM bid conditions, contract terms, SLA and statutory requirements shall prevail over these standard quotation terms wherever there is any inconsistency.",
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
  "Payment shall be made by irrevocable letter of credit or telegraphic transfer in the quoted currency, free of all bank charges to {{company}}.",
  "Product specifications, models and availability may be subject to change by the respective manufacturer without prior notice.",
  "Hardware products are subject to the applicable manufacturer's warranty and support terms. Warranty service outside India is subject to the manufacturer's regional coverage.",
  "The goods and services supplied are subject to export control and sanctions laws. The customer warrants that it will not re-export or divert them in breach of any applicable law.",
  "Each party shall comply with applicable data protection law in respect of any personal data exchanged under this quotation.",
  "The total liability of {{company}} arising out of or in connection with this quotation shall not exceed the value of the goods or services supplied.",
  "The United Nations Convention on Contracts for the International Sale of Goods (CISG) is excluded.",
  "Any dispute shall be finally resolved by arbitration seated in New Delhi, India, under the Arbitration and Conciliation Act, 1996, in the English language.",
  "Acceptance of this quotation constitutes acceptance of the terms stated herein, unless otherwise agreed in writing.",
];

/**
 * Proforma invoice — the same terms, speaking as a proforma.
 *
 * WHY THIS SET EXISTS. A proforma was being given the quotation's terms,
 * so a proforma invoice went out saying "This quotation is valid for 7
 * days", "unless specifically included in the quotation" and "payment
 * against this quotation shall constitute acceptance". It is the same
 * fault the tax invoice had and that INVOICE_TERMS fixed; the proforma
 * was simply missed, because it sits between the two and nothing made
 * it choose.
 *
 * DERIVED, NOT RETYPED. The company supplied one set of commercial
 * terms and these are those terms — the same TDS clause, the same
 * cancellation clause, the same force majeure clause — with the words
 * that name the document changed and the two clauses that only make
 * sense on an offer rewritten. Deriving rather than copying is what
 * keeps the two in step: a clause edited in DOMESTIC_TERMS appears here
 * next time this module is loaded, and only the differences below are
 * maintained by hand.
 *
 * WHAT A PROFORMA ADDS. It is not a tax invoice and no input tax credit
 * can be claimed against it — stated in the terms as well as the footer,
 * because the footer is the line a busy accounts department skips.
 */

/** The clauses a proforma says differently, longest match first. */
const PROFORMA_REWRITES: ReadonlyArray<readonly [string, string]> = [
  [
    "Quotation Validity: This quotation is valid for",
    "Validity: This proforma invoice is valid for",
  ],
  [
    "Acceptance of Terms: Placement of a Purchase Order, written acceptance or payment against this quotation shall constitute",
    "Acceptance of Terms: Payment against this proforma invoice, or a Purchase Order referring to it, shall constitute",
  ],
  [
    "Acceptance of this quotation constitutes acceptance",
    "Payment against this proforma invoice constitutes acceptance",
  ],
  /* The GeM note says the bid conditions prevail over "these standard
     quotation terms". On a proforma they are simply these terms. */
  ["these standard quotation terms", "these standard terms"],
];

/** "the quotation" and "this quotation" name the document, and on a
 *  proforma the document is a proforma invoice. Everything else — the
 *  quoted currency, quoted prices — is left alone. */
export function asProformaWording(clause: string): string {
  let out = clause;
  for (const [from, to] of PROFORMA_REWRITES) out = out.split(from).join(to);
  return out
    .split("the date of quotation").join("the date of this proforma invoice")
    .split("this quotation").join("this proforma invoice")
    .split("the quotation").join("this proforma invoice");
}

const NOT_A_TAX_INVOICE =
  "This Document: This is a proforma invoice issued for payment purposes. It is not a tax invoice, and no "
  + "input tax credit may be claimed against it. A GST tax invoice will be issued on realisation of payment.";

/** The supplied set as a proforma says it, with the proforma's own
 *  clause last and any note after that — see partitionClauses. */
function asProformaSet(terms: readonly string[]): readonly string[] {
  const { numbered, notes } = partitionClauses(terms.map(asProformaWording));
  return [...numbered, NOT_A_TAX_INVOICE, ...notes];
}

export const PROFORMA_TERMS: readonly string[] = asProformaSet(DOMESTIC_TERMS);

/** The export set the same way. A proforma raised on a customer outside
 *  India still needs Incoterms, the importer of record and arbitration;
 *  it just is not a quotation. */
export const PROFORMA_EXPORT_TERMS: readonly string[] = asProformaSet(INTERNATIONAL_TERMS);

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
  "Any terms proposed by the supplier, whether in a quotation, acknowledgement, invoice or otherwise, that conflict with or add to these terms shall have no effect unless accepted by {{company}} in writing.",
  "The prices stated in this purchase order are firm and inclusive of packing, marking and loading. No escalation, surcharge or additional charge of any kind shall be payable unless agreed in writing before despatch.",
  "Goods and services shall be supplied strictly in the quantities, specifications, makes, models and part numbers stated in this purchase order. Any substitution requires prior written approval.",
  "Delivery shall be completed by the delivery date stated in this purchase order. Time is of the essence. The supplier shall notify any anticipated delay immediately on becoming aware of it.",
  "Where delivery is delayed beyond the agreed date without written agreement, {{company}} reserves the right to claim liquidated damages, to procure the goods or services elsewhere at the supplier's cost, or to cancel the undelivered balance without liability.",
  "Goods shall be securely packed for the mode of transport used, and each consignment shall carry this purchase order number on the packing list and on all outer packaging.",
  "All goods are subject to inspection on receipt. Goods found short, damaged, defective or not conforming to this purchase order may be rejected and returned at the supplier's risk and cost, and payment for them may be withheld.",
  "Title and risk in the goods shall pass to {{company}} on delivery at the stated ship-to address and acceptance following inspection, notwithstanding any earlier payment.",
  "The supplier warrants that all goods are new, unused, free from defects in material and workmanship, of merchantable quality, and free from any lien or encumbrance, and that all services will be performed with reasonable skill and care.",
  "The supplier warrants that the goods and services do not infringe any third-party intellectual property right, and shall indemnify {{company}} against any claim, loss or expense arising from such infringement.",
  "The manufacturer's standard warranty shall pass to {{company}} and, where applicable, to its customer. Warranty documentation, licence keys and entitlement details shall be supplied with the goods.",
  "A GST-compliant tax invoice quoting this purchase order number, the correct HSN/SAC codes and the GSTIN of {{company}} shall accompany every despatch. Payment cannot be processed against a non-compliant invoice.",
  "The supplier shall report the supply correctly and on time in its GST returns so that input tax credit is available to {{company}}. Any credit lost or reversed on account of the supplier's default, together with interest and penalty, shall be recoverable from the supplier.",
  "The supplier shall provide the e-way bill, delivery challan, lorry receipt and any other statutory or transport documentation required for lawful movement of the goods.",
  "Payment shall be made in accordance with the payment terms stated in this purchase order, calculated from the date of receipt of both the goods and a compliant invoice, whichever is later.",
  "{{company}} may set off any amount owed by the supplier against any amount payable under this or any other purchase order.",
  "This purchase order may be cancelled in whole or in part, without liability, at any time before despatch, and at any time where the supplier commits a material breach or becomes insolvent.",
  "The supplier shall not assign or subcontract this purchase order, in whole or in part, without prior written consent.",
  "The supplier shall keep confidential all information disclosed in connection with this purchase order, including customer identities and pricing, and shall not use it for any other purpose.",
  "The supplier shall comply with all applicable laws, including those relating to labour, health and safety, environmental protection, anti-bribery and anti-corruption, and shall not offer any inducement to any employee of {{company}}.",
  "Neither party shall be liable for failure to perform caused by circumstances beyond its reasonable control, provided the affected party notifies the other promptly and resumes performance as soon as practicable.",
  "Nothing in this purchase order creates a partnership, joint venture, agency or employment relationship between the parties.",
  "This purchase order, together with any document expressly referred to in it, constitutes the entire agreement between the parties in respect of the goods and services ordered.",
  "This purchase order shall be governed by the laws of India, and all disputes shall be subject to the exclusive jurisdiction of the courts at New Delhi, India.",
];

/**
 * Tax invoice — domestic (India).
 *
 * WHY AN INVOICE NEEDS ITS OWN SET. A tax invoice raised in this CRM
 * carried the quotation's terms, whose first clause reads "Quotation is
 * valid for 30 days from the date of issue". An invoice is not an offer
 * and has no validity window; it is a demand for payment, and the clauses
 * that matter on it are different ones — when payment falls due, where it
 * must be sent, when title passes, how long there is to dispute a line.
 * Half the quotation set is about whether a deal will happen, which on an
 * invoice is already settled.
 *
 * The commercial terms actually agreed for the deal — payment days,
 * delivery basis — travel on the document's own Payment Terms and Delivery
 * Terms fields, which an invoice raised from a quotation carries across.
 * Those are not lost by using this set.
 *
 * Same standing caveat as the rest of this file, and it is not a
 * formality: these are commercial boilerplate, not legal advice. The
 * interest, title-retention, warranty and liability clauses should be
 * reviewed by a legal adviser before being relied on.
 */
export const INVOICE_TERMS: readonly string[] = [
  "Payment is due by the date stated on this invoice. Where no date is stated, payment is due within 30 days of the invoice date.",
  "Payment must be made only to the bank account printed on this invoice. {{company}} will not change its bank details by email; any message appearing to do so should be verified by telephone on a previously known number before any payment is made.",
  "The invoice number must be quoted on every remittance so that the payment can be applied to the correct account.",
  "Interest may be charged on any amount outstanding after the due date at 1.5% per month, or at the rate prescribed under the Micro, Small and Medium Enterprises Development Act, 2006, where that Act applies to this supply.",
  "Payment is not conditional on the customer receiving payment from any third party, and no deduction, set-off or withholding may be made except as required by law.",
  "Where tax is deducted at source, the customer shall furnish the certificate of deduction within the period prescribed under the Income-tax Act, 1961.",
  "Goods and services tax has been charged at the rates and under the HSN/SAC codes shown. The customer is responsible for the GSTIN and address stated on this invoice; a correction requested after the return for the relevant period has been filed may not be possible.",
  "Any discrepancy in this invoice as to quantity, specification, rate or tax must be notified in writing within seven days of receipt, after which the invoice is treated as accepted.",
  "Shortage, damage in transit or incorrect supply must be reported in writing within seven days of delivery, together with the packing list and transport documents.",
  "Title to the goods passes to the customer only on receipt of payment in full. Risk passes on delivery.",
  "Hardware is covered by the applicable manufacturer's warranty and is supported under that warranty by the manufacturer or its authorised service provider. No separate warranty is given by {{company}}.",
  "Software licences and subscriptions are supplied subject to the publisher's own licence terms, which bind the customer directly, and entitlement is subject to confirmation by the publisher.",
  "Goods and services correctly supplied are not returnable or cancellable except by prior written agreement, and then only on the terms the manufacturer, publisher or distributor allows.",
  "The total liability of {{company}} in connection with this invoice shall not exceed the value of the goods and services it covers, and shall not extend to indirect or consequential loss, including loss of profit, business or data.",
  "This invoice is governed by the laws of India, and all disputes shall be subject to the exclusive jurisdiction of the courts at New Delhi, India.",
];

/**
 * Tax invoice — export.
 *
 * An export invoice differs from a domestic one in law, not only in
 * wording: zero-rated supply rather than GST charged, the customer as
 * importer of record, Incoterms and duties, bank charges on a cross-border
 * wire, export control, and arbitration rather than the Delhi courts.
 *
 * OPEN QUESTION, DELIBERATELY NOT DECIDED HERE: this set says the supply
 * is a zero-rated export from India. An invoice raised by a UAE
 * establishment on a UAE customer is a domestic UAE supply carrying 5%
 * VAT, and this set would be wrong on it. Until that entity exists in the
 * CRM as its own company with its own registration, every invoice here is
 * raised from India, and that is what this says.
 */
export const INVOICE_EXPORT_TERMS: readonly string[] = [
  "All amounts are payable in the currency stated on this invoice. Payment in any other currency must be agreed in writing in advance.",
  "Payment must be made only to the bank account printed on this invoice. {{company}} will not change its bank details by email; any message appearing to do so should be verified by telephone on a previously known number before any payment is made.",
  "Payment shall be made by telegraphic transfer or irrevocable letter of credit, free of all bank charges to {{company}}. Correspondent and intermediary bank charges are to the customer's account, and the amount stated on this invoice must be received in full.",
  "Payment is due by the date stated on this invoice, without deduction, set-off or withholding except as required by law in the country of import.",
  "This supply is an export from India and is zero-rated under the Integrated Goods and Services Tax Act, 2017. Any tax, duty, levy or withholding applicable in the country of import is to the customer's account and may not be deducted from the amount payable.",
  "Delivery is on the Incoterms 2020 basis stated on this invoice. Where none is stated, delivery is Ex Works (EXW) New Delhi, India.",
  "The customer is the importer of record and is responsible for customs clearance, import licences, duties and all regulatory approvals in the destination country.",
  "Title to the goods passes to the customer only on receipt of payment in full. Risk passes in accordance with the agreed Incoterm.",
  "Shortage, damage in transit or incorrect supply must be reported in writing within seven days of delivery, together with the packing list and transport documents. Any claim against a carrier or insurer must be raised within the period that carrier or policy allows.",
  "Hardware is covered by the applicable manufacturer's warranty. Warranty service outside India is subject to the manufacturer's regional coverage, and no undertaking is given that a product will be serviced in the destination country.",
  "Software licences and subscriptions are supplied subject to the publisher's own licence terms, which bind the customer directly, and entitlement is subject to confirmation by the publisher and to the territory the licence is issued for.",
  "The goods and services supplied are subject to export control and sanctions laws. The customer warrants that it will not re-export or divert them in breach of any applicable law.",
  "The total liability of {{company}} in connection with this invoice shall not exceed the value of the goods and services it covers, and shall not extend to indirect or consequential loss, including loss of profit, business or data.",
  "The United Nations Convention on Contracts for the International Sale of Goods (CISG) is excluded.",
  "This invoice is governed by the laws of India. Any dispute shall be finally resolved by arbitration seated in New Delhi, India, under the Arbitration and Conciliation Act, 1996, in the English language.",
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

export const PROFORMA_TERMS_SETS: readonly TermsSet[] = [
  { id: "domestic", label: "Domestic (India)", hint: "GST, advance payment, Delhi courts", terms: PROFORMA_TERMS },
  { id: "international", label: "International / Export", hint: "Incoterms, customs, arbitration, export control", terms: PROFORMA_EXPORT_TERMS },
];

export const INVOICE_TERMS_SETS: readonly TermsSet[] = [
  { id: "domestic", label: "Domestic (India)", hint: "GST charged, payment and interest, Delhi courts", terms: INVOICE_TERMS },
  { id: "international", label: "International / Export", hint: "Zero-rated export, wire transfer, Incoterms, arbitration", terms: INVOICE_EXPORT_TERMS },
];

/**
 * Which pair of sets a document chooses between.
 *
 * The id — domestic or export — is about the CUSTOMER'S COUNTRY; which
 * pair it picks from is about WHAT THE DOCUMENT IS. Keeping those two
 * apart is what lets an export tax invoice exist: it needs the export
 * clauses and the invoice clauses at once, which a single flat list of two
 * sets could not express.
 */
export function termsSetsFor(docType: string): readonly TermsSet[] {
  if (docType === "invoice") return INVOICE_TERMS_SETS;
  if (docType === "proforma") return PROFORMA_TERMS_SETS;
  return TERMS_SETS;
}

/** Suggested from the customer's country, out of the pair that fits this
 *  kind of document. Both sets stay selectable, and the suggestion is
 *  applied automatically only to a NEW document. */
export function suggestTermsSet(
  country: string | null | undefined,
  docType: string = "quotation",
): TermsSet {
  const sets = termsSetsFor(docType);
  const isExport = !!(country || "").trim() && (country || "").trim() !== "India";
  return (isExport ? sets[1] : sets[0]) as TermsSet;
}

export const LEGAL_NOTICE =
  "These are commercial boilerplate terms, not legal advice. Have your legal adviser review them before relying on them for significant contracts.";
