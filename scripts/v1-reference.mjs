/* AUTO-EXTRACTED from the v1 src/App.jsx, lines 215-915, verbatim.
   Reference implementation used only by scripts/compare-v1.mjs to prove the
   TypeScript rewrite produces identical output. Do not edit or import from app code. */
const STATES = [
  ["Andhra Pradesh","37"],["Arunachal Pradesh","12"],["Assam","18"],["Bihar","10"],
  ["Chandigarh","04"],["Chhattisgarh","22"],["Delhi","07"],["Goa","30"],["Gujarat","24"],
  ["Haryana","06"],["Himachal Pradesh","02"],["Jammu & Kashmir","01"],["Jharkhand","20"],
  ["Karnataka","29"],["Kerala","32"],["Ladakh","38"],["Madhya Pradesh","23"],["Maharashtra","27"],
  ["Manipur","14"],["Meghalaya","17"],["Mizoram","15"],["Nagaland","13"],["Odisha","21"],
  ["Puducherry","34"],["Punjab","03"],["Rajasthan","08"],["Sikkim","11"],["Tamil Nadu","33"],
  ["Telangana","36"],["Tripura","16"],["Uttar Pradesh","09"],["Uttarakhand","05"],
  ["West Bengal","19"],["Outside India","96"],
];

/* Global country list for Customers, so the CRM isn't limited to Indian
   customers only. Grouped loosely by region for scannability in dropdowns. */
const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina",
  "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados",
  "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana",
  "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Canada",
  "Cape Verde", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros",
  "Congo (Brazzaville)", "Congo (DRC)", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic", "East Timor", "Ecuador", "Egypt",
  "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji",
  "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada",
  "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary",
  "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast",
  "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania",
  "Luxembourg", "Macau", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta",
  "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco",
  "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal",
  "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia",
  "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay",
  "Peru", "Philippines", "Poland", "Portugal", "Puerto Rico", "Qatar", "Romania", "Russia",
  "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa",
  "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles",
  "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa",
  "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland",
  "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Togo", "Tonga", "Trinidad and Tobago",
  "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates",
  "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela",
  "Vietnam", "Yemen", "Zambia", "Zimbabwe", "Other",
];

/* [code, symbol, name, decimals] — decimals defaults to 2 when omitted.
   Full ISO 4217 active-currency list. Decimal precision follows the
   official ISO minor-unit exponent (0 for currencies with no subdivision
   in practice, 3 for the Gulf dinar/rial currencies, 2 otherwise). */
const CURRENCIES = [
  ["INR", "\u20B9", "Indian Rupee"],
  ["USD", "$", "US Dollar"],
  ["EUR", "\u20AC", "Euro"],
  ["GBP", "\u00A3", "British Pound"],
  ["AED", "AED ", "UAE Dirham"],
  ["SAR", "SAR ", "Saudi Riyal"],
  ["QAR", "QAR ", "Qatari Riyal"],
  ["KWD", "KWD ", "Kuwaiti Dinar", 3],
  ["BHD", "BHD ", "Bahraini Dinar", 3],
  ["OMR", "OMR ", "Omani Rial", 3],
  ["JOD", "JOD ", "Jordanian Dinar", 3],
  ["IQD", "IQD ", "Iraqi Dinar", 3],
  ["LYD", "LYD ", "Libyan Dinar", 3],
  ["TND", "TND ", "Tunisian Dinar", 3],
  ["NOK", "kr ", "Norwegian Krone"],
  ["SEK", "kr ", "Swedish Krona"],
  ["DKK", "kr ", "Danish Krone"],
  ["ISK", "kr ", "Icelandic Krona", 0],
  ["CHF", "CHF ", "Swiss Franc"],
  ["SGD", "S$", "Singapore Dollar"],
  ["AUD", "A$", "Australian Dollar"],
  ["NZD", "NZ$", "New Zealand Dollar"],
  ["CAD", "C$", "Canadian Dollar"],
  ["HKD", "HK$", "Hong Kong Dollar"],
  ["JPY", "\u00A5", "Japanese Yen", 0],
  ["CNY", "\u00A5", "Chinese Yuan"],
  ["MYR", "RM", "Malaysian Ringgit"],
  ["THB", "\u0E3F", "Thai Baht"],
  ["IDR", "Rp", "Indonesian Rupiah", 0],
  ["PHP", "\u20B1", "Philippine Peso"],
  ["VND", "\u20AB", "Vietnamese Dong", 0],
  ["ZAR", "R", "South African Rand"],
  ["EGP", "E\u00A3", "Egyptian Pound"],
  ["NGN", "\u20A6", "Nigerian Naira"],
  ["KES", "KSh", "Kenyan Shilling"],
  ["GHS", "GH\u20B5", "Ghanaian Cedi"],
  ["TZS", "TSh", "Tanzanian Shilling"],
  ["UGX", "USh", "Ugandan Shilling", 0],
  ["RWF", "RF", "Rwandan Franc", 0],
  ["ZMW", "ZK", "Zambian Kwacha"],
  ["MAD", "MAD ", "Moroccan Dirham"],
  ["DZD", "DZD ", "Algerian Dinar"],
  ["ETB", "Br", "Ethiopian Birr"],
  ["XOF", "CFA", "West African CFA Franc", 0],
  ["XAF", "FCFA", "Central African CFA Franc", 0],
  ["XPF", "CFP", "CFP Franc", 0],
  ["MUR", "\u20A8", "Mauritian Rupee"],
  ["BWP", "P", "Botswana Pula"],
  ["NAD", "N$", "Namibian Dollar"],
  ["PKR", "\u20A8", "Pakistani Rupee"],
  ["BDT", "\u09F3", "Bangladeshi Taka"],
  ["LKR", "Rs", "Sri Lankan Rupee"],
  ["NPR", "Rs", "Nepalese Rupee"],
  ["AFN", "\u060B", "Afghan Afghani"],
  ["MMK", "K", "Myanmar Kyat"],
  ["KHR", "\u17DB", "Cambodian Riel"],
  ["LAK", "\u20AD", "Lao Kip"],
  ["MNT", "\u20AE", "Mongolian Tugrik"],
  ["KZT", "\u20B8", "Kazakhstani Tenge"],
  ["UZS", "so'm", "Uzbekistani Som"],
  ["AZN", "\u20BC", "Azerbaijani Manat"],
  ["GEL", "\u20BE", "Georgian Lari"],
  ["AMD", "\u058F", "Armenian Dram"],
  ["RUB", "\u20BD", "Russian Ruble"],
  ["UAH", "\u20B4", "Ukrainian Hryvnia"],
  ["BYN", "Br", "Belarusian Ruble"],
  ["TRY", "\u20BA", "Turkish Lira"],
  ["ILS", "\u20AA", "Israeli Shekel"],
  ["LBP", "LBP ", "Lebanese Pound"],
  ["JMD", "J$", "Jamaican Dollar"],
  ["TTD", "TT$", "Trinidad and Tobago Dollar"],
  ["BSD", "B$", "Bahamian Dollar"],
  ["BBD", "Bds$", "Barbadian Dollar"],
  ["BZD", "BZ$", "Belize Dollar"],
  ["XCD", "EC$", "East Caribbean Dollar"],
  ["GYD", "G$", "Guyanese Dollar"],
  ["SRD", "SRD ", "Surinamese Dollar"],
  ["CUP", "CUP ", "Cuban Peso"],
  ["DOP", "RD$", "Dominican Peso"],
  ["HTG", "G", "Haitian Gourde"],
  ["GTQ", "Q", "Guatemalan Quetzal"],
  ["HNL", "L", "Honduran Lempira"],
  ["NIO", "C$", "Nicaraguan Cordoba"],
  ["CRC", "\u20A1", "Costa Rican Colon"],
  ["PAB", "B/.", "Panamanian Balboa"],
  ["MXN", "MX$", "Mexican Peso"],
  ["BRL", "R$", "Brazilian Real"],
  ["ARS", "AR$", "Argentine Peso"],
  ["CLP", "CL$", "Chilean Peso", 0],
  ["COP", "COL$", "Colombian Peso"],
  ["PEN", "S/", "Peruvian Sol"],
  ["BOB", "Bs.", "Bolivian Boliviano"],
  ["PYG", "\u20B2", "Paraguayan Guarani", 0],
  ["UYU", "$U", "Uruguayan Peso"],
  ["VES", "Bs.S", "Venezuelan Bolivar"],
  ["PLN", "z\u0142", "Polish Zloty"],
  ["CZK", "K\u010D", "Czech Koruna"],
  ["HUF", "Ft", "Hungarian Forint"],
  ["RON", "lei", "Romanian Leu"],
  ["BGN", "\u043B\u0432", "Bulgarian Lev"],
  ["RSD", "din.", "Serbian Dinar"],
  ["ALL", "L", "Albanian Lek"],
  ["MKD", "\u0434\u0435\u043D", "Macedonian Denar"],
  ["BAM", "KM", "Bosnia-Herzegovina Mark"],
  ["MDL", "L", "Moldovan Leu"],
  ["KRW", "\u20A9", "South Korean Won", 0],
  ["KPW", "\u20A9", "North Korean Won"],
  ["TWD", "NT$", "Taiwan Dollar"],
  ["MOP", "MOP$", "Macanese Pataca"],
  ["FJD", "FJ$", "Fijian Dollar"],
  ["PGK", "K", "Papua New Guinean Kina"],
  ["WST", "WS$", "Samoan Tala"],
  ["TOP", "T$", "Tongan Pa'anga"],
  ["SBD", "SI$", "Solomon Islands Dollar"],
  ["VUV", "VT", "Vanuatu Vatu", 0],
  ["YER", "YER ", "Yemeni Rial"],
  ["SYP", "SYP ", "Syrian Pound"],
  ["IRR", "IRR ", "Iranian Rial"],
  ["SDG", "SDG ", "Sudanese Pound"],
  ["SSP", "SSP ", "South Sudanese Pound"],
  ["SOS", "S", "Somali Shilling"],
  ["DJF", "Fdj", "Djiboutian Franc", 0],
  ["ERN", "Nfk", "Eritrean Nakfa"],
  ["KMF", "CF", "Comorian Franc", 0],
  ["MGA", "Ar", "Malagasy Ariary", 0],
  ["MWK", "MK", "Malawian Kwacha"],
  ["MZN", "MT", "Mozambican Metical"],
  ["ZWL", "Z$", "Zimbabwean Dollar"],
  ["AOA", "Kz", "Angolan Kwanza"],
  ["CDF", "FC", "Congolese Franc"],
  ["XDR", "SDR", "IMF Special Drawing Rights"],
];

function getCurrency(code) {
  const found = CURRENCIES.find((c) => c[0] === code);
  return found ? { code: found[0], symbol: found[1], name: found[2], decimals: found[3] ?? 2 } : { code: "INR", symbol: "\u20B9", name: "Indian Rupee", decimals: 2 };
}
function fmtCurrency(amount, currencyCode) {
  const cur = getCurrency(currencyCode);
  const n = Number(amount) || 0;
  return cur.symbol + n.toLocaleString("en-US", { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals });
}

/* jsPDF's built-in fonts (Helvetica/Times/Courier) only support the
   WinAnsi/Latin-1 character set. Many currency symbols — and even a few
   Latin-alphabet symbols with diacritics (Kč, zł) or Cyrillic ones (лв,
   ден) — fall outside that range and render as corrupted glyph codes or
   get silently dropped by the text sanitizer. Verified against the full
   CURRENCIES list programmatically, not by eye — every symbol whose
   Unicode code point exceeds U+00FF is listed here with a plain-ASCII
   fallback. Keyed by currency CODE (not symbol) since several currencies
   share an identical symbol (PKR and MUR both use ₨) and a code-keyed map
   avoids any ambiguity. Used only inside the native PDF generator; the
   on-screen preview keeps the real symbols since browsers have full
   Unicode font support. */
const PDF_UNSAFE_CURRENCY_CODES = new Set([
  "INR", "EUR", "THB", "PHP", "VND", "NGN", "GHS", "MUR", "PKR", "BDT", "AFN", "KHR",
  "LAK", "MNT", "KZT", "AZN", "GEL", "AMD", "RUB", "UAH", "TRY", "ILS", "CRC", "PYG",
  "PLN", "CZK", "BGN", "MKD", "KRW", "KPW",
]);
const PDF_SYMBOL_OVERRIDE = { INR: "Rs. " };
function fmtCurrencyPdf(amount, currencyCode) {
  const cur = getCurrency(currencyCode);
  const n = Number(amount) || 0;
  const symbol = PDF_UNSAFE_CURRENCY_CODES.has(cur.code) ? (PDF_SYMBOL_OVERRIDE[cur.code] || cur.code + " ") : cur.symbol;
  return symbol + n.toLocaleString("en-US", { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals });
}

/* Money inside the items table, where every column header already names the
   currency ("Unit Price (INR)"). Repeating "Rs." in every cell is redundant
   and — at the widths a 13-column table allows — was pushing large figures
   onto a second line mid-number. Bare digits only; the header carries the unit. */
function fmtMoneyCellPdf(amount, currencyCode) {
  const cur = getCurrency(currencyCode);
  const n = Number(amount) || 0;
  return n.toLocaleString("en-US", { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals });
}

/* Tax regime — India keeps its familiar CGST/SGST/IGST split logic (still
   computed the same way internally); everything else uses a single
   combined tax line with a regime-appropriate label. */
/* GSTIN structural + checksum validation — entirely offline, no external
   API call. This does NOT confirm the number is actually registered with
   the government (that requires a paid GSP subscription — see notes in
   the settings panel), but it does catch the overwhelming majority of
   real-world errors: typos, transposed digits, wrong format. It also
   decodes two pieces of real data embedded in every valid GSTIN — the
   state code (first 2 digits) and the business's own PAN (characters
   3–12) — which is what powers the auto-fill. Checksum algorithm
   verified against TechZoid's own real GSTIN before shipping. */
const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function validateGSTIN(raw) {
  const clean = (raw || "").trim().toUpperCase();
  if (!clean) return { valid: false, reason: "empty", clean };
  if (clean.length < 15) return { valid: false, reason: "incomplete", clean };
  if (clean.length > 15) return { valid: false, reason: "format", clean };
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(clean)) return { valid: false, reason: "format", clean };
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const val = GSTIN_CHARSET.indexOf(clean[i]);
    const factor = i % 2 === 0 ? 1 : 2;
    const product = val * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expectedChar = GSTIN_CHARSET[(36 - (sum % 36)) % 36];
  if (expectedChar !== clean[14]) return { valid: false, reason: "checksum", clean };
  const stateCode = clean.slice(0, 2);
  const stateMatch = STATES.find(([, code]) => code === stateCode);
  return { valid: true, clean, stateCode, stateName: stateMatch ? stateMatch[0] : null, pan: clean.slice(2, 12) };
}

const TAX_TYPES = [
  ["gst", "GST (India)"],
  ["vat", "VAT"],
  ["sales_tax", "Sales Tax"],
  ["none", "No Tax / Exempt"],
];
function taxTypeLabel(taxType) {
  const found = TAX_TYPES.find((t) => t[0] === taxType);
  return found ? found[1] : "Tax";
}

/* Two sets of commercial terms, because a domestic Indian sale and an export
   sale genuinely differ in law, not just wording: GST vs zero-rated export,
   Indian courts vs arbitration, no customs vs Incoterms and duties, INR vs
   exchange-rate risk, and cross-border data/sanctions obligations.

   These are professionally-worded commercial boilerplate, not legal advice.
   They should be reviewed by your legal adviser before being relied on for
   significant contracts — particularly the liability, warranty, and dispute
   resolution clauses, which are the ones tested when something goes wrong. */
const DOMESTIC_TERMS = [
  "All prices quoted are in Indian Rupees (INR) and are exclusive of applicable GST unless explicitly stated otherwise.",
  "Goods and Services Tax (GST) shall be levied at the prevailing rate as applicable under the CGST/SGST/IGST Act on the date of supply.",
  "Payment terms: 100% advance payment along with the confirmed purchase order, unless mutually agreed otherwise in writing. All payments to be made via NEFT/RTGS/UPI to the bank account details mentioned herein.",
  "Interest @ 1.5% per month will be levied on overdue payments beyond the agreed credit period.",
  "Software licences and digital subscriptions will be delivered electronically to the registered e-mail address within 1–3 working days of payment realisation. Physical media, if applicable, will be shipped separately.",
  "Licence keys, activation codes, and subscription plans, once delivered and activated, are strictly non-returnable and non-refundable as per the respective OEM's licensing policy.",
  "Hardware delivery timelines are indicative and subject to OEM/distributor stock availability at the time of order confirmation. TechZoid Technologies shall not be liable for delays caused by OEM supply constraints.",
  "Warranty and after-sales support for all products is governed by the respective OEM's standard warranty policy. TechZoid Technologies shall facilitate warranty claims and support co-ordination at no additional charge during the warranty period.",
  "This quotation is valid strictly for the period mentioned above. Prices, availability, and configurations are subject to revision without prior notice post the validity period.",
  "Any new statutory levy, tax, duty, or cess introduced or revised by the Government after the date of this quotation shall be charged at actuals.",
  "Orders once confirmed and placed with the OEM/distributor cannot be cancelled, modified, or amended. Partial deliveries shall be deemed valid unless expressly excluded.",
  "Force Majeure: TechZoid Technologies shall not be held liable for any delay or failure in performance resulting from acts beyond its reasonable control, including but not limited to natural disasters, pandemics, government orders, and supply-chain disruptions.",
  "Intellectual property rights for all software products remain with the respective OEM. The customer is granted a limited, non-transferable licence as per the OEM's end-user licence agreement (EULA).",
  "The customer is responsible for ensuring compliance with all applicable licensing terms and conditions of the respective OEM products procured through this quotation.",
  "All disputes arising out of or in connection with this quotation shall be subject to the exclusive jurisdiction of the courts of New Delhi, India.",
  "By signing and returning this quotation, the customer confirms acceptance of all the terms and conditions stated herein.",
];

/* Export / international sales. Deliberately covers the ground that domestic
   terms don't need: delivery risk transfer, customs and duties, currency
   movement, export control, cross-border data handling, and a neutral
   dispute forum — suing across borders in your own courts is often
   unenforceable, which is why arbitration is the norm in export contracts. */
const INTERNATIONAL_TERMS = [
  "All prices are quoted in the currency stated in this quotation and are exclusive of all taxes, duties, levies, and charges applicable in the destination country.",
  "This supply constitutes an export from India and is zero-rated under the Integrated Goods and Services Tax Act, 2017. Any tax, customs duty, VAT, or import levy imposed in the destination country is solely to the customer's account.",
  "The customer is the importer of record and is responsible for obtaining all import licences, permits, and clearances required in the destination country, and for all associated costs and delays.",
  "Delivery terms are as specified in this quotation and shall be interpreted in accordance with Incoterms® 2020 as published by the International Chamber of Commerce. Where no term is specified, delivery shall be Ex Works (EXW) from the supplier's premises.",
  "Risk of loss or damage passes to the customer in accordance with the applicable Incoterms® rule. Title to goods passes only upon receipt of payment in full.",
  "Payment terms: 100% advance by telegraphic transfer (T/T) unless otherwise agreed in writing. All bank charges, correspondent bank fees, and remittance costs are to the customer's account; the invoiced amount must be received in full.",
  "Prices are based on exchange rates prevailing on the date of this quotation. Where settlement occurs in a currency other than that quoted, any variation exceeding 3% may be adjusted, or the order re-confirmed, at the supplier's discretion.",
  "Interest at 1.5% per month, or the maximum rate permitted by applicable law if lower, shall accrue on any amount not paid by its due date.",
  "Software licences and digital subscriptions are delivered electronically to the registered e-mail address, ordinarily within 1–3 working days of confirmed receipt of payment. Delivery is deemed complete upon transmission of licence keys or activation credentials.",
  "Licence keys, activation codes, and subscription plans, once delivered or activated, are non-returnable and non-refundable in accordance with the relevant OEM's licensing policy.",
  "Hardware delivery timelines are indicative and subject to OEM and distributor stock availability, export clearance, and freight scheduling. The supplier shall not be liable for delays arising from customs inspection, port congestion, or carrier disruption.",
  "Warranty is provided by the respective OEM under its applicable regional warranty policy. The customer acknowledges that OEM warranty terms, service levels, and coverage may differ by territory, and that certain products may carry warranty valid only in specified regions.",
  "Save for the OEM warranty referred to above, all warranties, conditions, and representations, whether express or implied by statute, common law, or otherwise, are excluded to the fullest extent permitted by applicable law.",
  "The supplier's aggregate liability arising out of or in connection with this contract, whether in contract, tort (including negligence), or otherwise, shall not exceed the total invoice value of the specific products or services giving rise to the claim.",
  "In no event shall the supplier be liable for indirect, incidental, consequential, special, or punitive damages, or for loss of profit, revenue, data, business, or anticipated savings, howsoever arising.",
  "The customer represents that it will not export, re-export, transfer, or divert any product supplied hereunder in contravention of applicable export control laws, sanctions regimes, or trade restrictions, including those administered by India, the United States, the United Kingdom, and the European Union.",
  "Where the performance of this contract involves the processing of personal data, each party shall comply with the data protection laws applicable to it, and shall implement appropriate technical and organisational measures to safeguard such data.",
  "Intellectual property rights in all software remain vested in the respective OEM. The customer receives a limited, non-exclusive, non-transferable right to use the software strictly in accordance with the applicable end-user licence agreement (EULA).",
  "Force Majeure: neither party shall be liable for any delay or failure to perform resulting from causes beyond its reasonable control, including acts of God, war, civil unrest, epidemic or pandemic, governmental action, embargo, strike, cyber-attack, or failure of transport or telecommunications networks.",
  "This quotation is valid strictly for the period stated. Prices, availability, and specifications are subject to revision without notice thereafter.",
  "Orders once confirmed with the OEM or distributor may not be cancelled, modified, or amended. Partial shipment shall be permitted unless expressly excluded in writing.",
  "This contract shall be governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions. The United Nations Convention on Contracts for the International Sale of Goods (CISG) shall not apply.",
  "Any dispute, controversy, or claim arising out of or relating to this contract shall be referred to and finally resolved by arbitration under the Arbitration and Conciliation Act, 1996. The seat of arbitration shall be New Delhi, India, the language shall be English, and the tribunal shall consist of a sole arbitrator.",
  "This quotation, together with any documents expressly referred to herein, constitutes the entire agreement between the parties and supersedes all prior discussions, representations, and understandings. No variation shall be effective unless made in writing and signed by both parties.",
  "By signing and returning this quotation, the customer confirms acceptance of all terms and conditions stated herein.",
];

/* Retained so existing saved settings, templates, and any code referring to
   DEFAULT_TERMS continue to resolve to the domestic set. */
const DEFAULT_TERMS = DOMESTIC_TERMS;

const TERMS_SETS = [
  { id: "domestic", label: "Domestic (India)", hint: "GST, Indian courts, INR pricing", terms: DOMESTIC_TERMS },
  { id: "international", label: "International / Export", hint: "Incoterms, customs, arbitration, export control", terms: INTERNATIONAL_TERMS },
];

const DEFAULT_QUOTE_TEMPLATES = [
  {
    id: "standard",
    name: "Standard",
    intro: "Thank you for the opportunity to quote. Please find our best commercial offer for your requirement below.",
    footer: "We look forward to your confirmation and remain available for any clarification.",
    terms: DEFAULT_TERMS,
  },
];

/* Human-readable metadata for the reorderable document section blocks.
   Used by the Settings > Document Template reorder UI, and the section
   keys here are the single source of truth for what QuoteDoc, ProformaDoc,
   and generateDocPDF iterate over. */
const SECTION_ORDER_META = {
  header: { label: "Header", hint: "Logo, company details, document title & metadata" },
  parties: { label: "Customer details", hint: "Bill to / billing / shipping address grid" },
  intro: { label: "Salutation / subject", hint: "\"Dear Sir / Madam\" intro (quotation) or subject line" },
  items: { label: "Items table", hint: "The product/service line-items table" },
  moneyBlock: { label: "Terms & Totals", hint: "Terms & Totals (quotation) or Bank Details & Totals (proforma), side by side" },
  notes: { label: "Notes", hint: "Proforma only — bulleted payment notes" },
  signature: { label: "Signature block", hint: "Signature, stamp, and Customer Acceptance / We Accept" },
  logos: { label: "Partner logo strip", hint: "Microsoft / Adobe / Autodesk etc. + Years of Excellence badge" },
  footer: { label: "Footer", hint: "Contact details and closing line" },
};

/* ── Free-canvas document layout ──────────────────────────────────────
   Positions are stored in MILLIMETRES on an A4 page (210 x 297mm), which
   is the one unit both renderers speak natively: jsPDF is constructed in
   mm, and the on-screen preview uses a CSS mm page. That shared unit is
   what stops the preview and the emailed PDF drifting apart.

   Origin is the top-left corner of the physical page, NOT the print
   margin — dragging something to x:0 puts it at the paper's edge.

   `h` (height) is advisory for most blocks: they render at their natural
   content height. The items table is the deliberate exception — you set
   its x/y/w, but its height always follows the data, because a quote with
   40 line items cannot be squeezed into the box a 3-item quote used.
   Blocks below a grown table are pushed down by `flowBelow`. */
const PAGE_W_MM = 210, PAGE_H_MM = 297;

const DEFAULT_CANVAS_LAYOUT = {
  enabled: false, // opt-in: existing documents keep the classic stacked flow until switched on
  /* Default is a tight, professional grid: the header is pinned to the top
     margin and everything else flows beneath it in order, so there are no
     dead gaps and no collisions out of the box. Dragging a block sets an
     explicit y for it; blocks left at y:0 keep flowing. */
  blocks: {
    header:      { x: 13, y: 13, w: 184, flowBelow: false },
    parties:     { x: 13, y: 0,  w: 184, flowBelow: true },
    intro:       { x: 13, y: 0,  w: 184, flowBelow: true },
    items:       { x: 13, y: 0,  w: 184, flowBelow: true },
    moneyBlock:  { x: 13, y: 0,  w: 184, flowBelow: true },
    notes:       { x: 13, y: 0,  w: 184, flowBelow: true },
    signature:   { x: 13, y: 0,  w: 184, flowBelow: true },
    logos:       { x: 13, y: 0,  w: 184, flowBelow: true },
    footer:      { x: 13, y: 0,  w: 184, flowBelow: true },
  },
};

/* Merge a saved layout over the defaults so a partially-saved or older
   layout can never produce an undefined block at render time. */
function normalizeCanvasLayout(saved) {
  const base = DEFAULT_CANVAS_LAYOUT;
  const out = { enabled: !!(saved && saved.enabled), blocks: {} };
  Object.keys(base.blocks).forEach((k) => {
    const s = (saved && saved.blocks && saved.blocks[k]) || {};
    const d = base.blocks[k];
    const num = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);
    out.blocks[k] = {
      x: clampMm(num(s.x, d.x), 0, PAGE_W_MM),
      y: clampMm(num(s.y, d.y), 0, PAGE_H_MM),
      w: clampMm(num(s.w, d.w), 20, PAGE_W_MM),
      flowBelow: typeof s.flowBelow === "boolean" ? s.flowBelow : d.flowBelow,
    };
  });
  return out;
}
function clampMm(v, min, max) { return Math.max(min, Math.min(max, v)); }


const DEFAULT_SETTINGS = {
  defaultCurrency: "INR",
  productCatalog: [],
  defaultTaxType: "gst",
  company: {
    name: "TechZoid Technologies Private Limited",
    tagline: "Connect, Communicate & Collaborate",
    address: "Pitampura",
    city: "New Delhi",
    state: "Delhi",
    pincode: "110034",
    gstin: "07AAXXXXXXXXXZX",
    pan: "AAXXXXXXXX",
    cin: "",
    phone: "",
    email: "sales@techzoidtechnologies.com",
    website: "www.techzoidtechnologies.com",
  },
  uaeOffice: {
    name: "TechZoid Technologies FZ-LLC",
    address: "",
    city: "Ajman Free Zone",
    country: "United Arab Emirates",
    phone: "",
    email: "",
  },
  isoCerts: [
    { id: "iso9001", label: "ISO 9001:2015", logo: null },
    { id: "iso27001", label: "ISO/IEC 27001:2022", logo: null },
    { id: "iso20000", label: "ISO/IEC 20000-1:2018", logo: null },
  ],
  certLogos: [],
  isoCertText: "ISO 9001:2015 — Quality Management System\nISO/IEC 27001:2022 — Information Security Management System\nISO/IEC 20000-1:2018 — IT Service Management System",
  yearsOfExcellence: "",
  bank: { name: "", account: "", ifsc: "", branch: "", upi: "", upiQr: null, accountName: "", accountType: "Current Account", swift: "" },
  bankAccounts: [],
  signatureImg: null,
  stampImg: null,
  signatoryName: "",
  signatoryDesignation: "Managing Director",
  logoPosition: "footer",
  docTemplate: {
    accentColor: "#2563EB",
    sectionOrder: ["header", "parties", "intro", "items", "moneyBlock", "notes", "signature", "logos", "footer"],
    /* Independent free-canvas layouts per document type — a proforma's
       bank-details block sits where a quotation's terms block does, so
       they genuinely need separate coordinates rather than one shared set. */
    canvasQuotation: DEFAULT_CANVAS_LAYOUT,
    canvasProforma: DEFAULT_CANVAS_LAYOUT,
    sections: {
      uaeOffice: true, isoCerts: true, terms: true, bankDetails: true,
      customerAcceptance: true, partnerLogos: true, yearsOfExcellence: true,
      notes: true, salutation: true, amountInWords: true,
    },
    columns: { subDesc: true, brand: true, sku: true, hsn: true },
    labels: {
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
      closingQuote: "Thank you for your business!",
      closingProforma: "This is a Proforma Invoice and not a Tax Invoice.",
      amountInWordsLabel: "Amount in Words:",
      grandTotalLabel: "Grand Total",
    },
  },
  customFields: [],
  logo: null,
  certBanner: null,
  letterheadText: "",
  brandingLogos: [],
  quotePrefix: "TZ/QT",
  quoteSeq: 1,
  orderPrefix: "TZ/SO",
  orderSeq: 1,
  dispatchPrefix: "TZ/DC",
  dispatchSeq: 1,
  proformaPrefix: "TZ/PI",
  proformaSeq: 1,
  defaultGst: 18,
  defaultValidityDays: 15,
  defaultTerms: DEFAULT_TERMS,
  /* Where "Send for invoicing" routes to. Kept in settings rather than
     hardcoded so the accounts contact can change without a redeploy. */
  invoicingEmail: "kuldeep.k@techzoidtechnologies.com",
  invoicingCc: "abhinav.jain@techzoidtechnologies.com",
  quoteTemplates: DEFAULT_QUOTE_TEMPLATES,
  incentiveSchemes: [],
};

/* ---------------------------- utilities --------------------------- */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* Compress an image file to fit comfortably inside a JSON column.
   Returns a Promise<dataURL> at max 600px wide, JPEG 80% quality. */
function compressImage(file, maxW = 600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    const r = new FileReader();
    r.onload = () => { img.src = r.result; };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
/* For PNGs with transparency, keep as PNG but resize */
function compressImagePNG(file, maxW = 600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    const r = new FileReader();
    r.onload = () => { img.src = r.result; };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, d) => {
  const dt = new Date(iso + "T00:00:00");
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/* Indian financial year: 1 April – 31 March */
function fyBounds(date = new Date()) {
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return { startMs: new Date(y, 3, 1).getTime(), endMs: new Date(y + 1, 2, 31, 23, 59, 59, 999).getTime(), label: "FY " + y + "-" + String((y + 1) % 100).padStart(2, "0") };
}
function monthBounds(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth();
  return { startMs: new Date(y, m, 1).getTime(), endMs: new Date(y, m + 1, 0, 23, 59, 59, 999).getTime(), label: date.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
}
const inr = (n) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrShort = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return "₹" + (v / 1e7).toFixed(2) + " Cr";
  if (v >= 1e5) return "₹" + (v / 1e5).toFixed(2) + " L";
  if (v >= 1e3) return "₹" + (v / 1e3).toFixed(1) + " K";
  return "₹" + v.toFixed(0);
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigit(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}
function threeDigit(n) {
  const h = Math.floor(n / 100), r = n % 100;
  return (h ? ONES[h] + " Hundred" + (r ? " " : "") : "") + (r ? twoDigit(r) : "");
}
function amountInWords(amount) {
  const num = Math.floor(Math.abs(Number(amount) || 0));
  const paise = Math.round((Math.abs(Number(amount) || 0) - num) * 100);
  if (num === 0 && paise === 0) return "Zero Rupees Only";
  const parts = [];
  const crore = Math.floor(num / 1e7);
  const lakh = Math.floor((num % 1e7) / 1e5);
  const thousand = Math.floor((num % 1e5) / 1e3);
  const rest = num % 1e3;
  if (crore) parts.push(threeDigit(crore) + " Crore");
  if (lakh) parts.push(threeDigit(lakh) + " Lakh");
  if (thousand) parts.push(threeDigit(thousand) + " Thousand");
  if (rest) parts.push(threeDigit(rest));
  let out = parts.join(" ").trim();
  out = (out ? out + " Rupees" : "");
  if (paise) out += (out ? " and " : "") + twoDigit(paise) + " Paise";
  return out + " Only";
}

/* Western short-scale (Thousand/Million/Billion) number-to-words, used for
   every currency other than INR — the Lakh/Crore scale above is specific
   to the Indian numbering system and reads oddly for USD/EUR/AED etc. */
function amountInWordsWestern(amount, currencyName, minorName) {
  const num = Math.floor(Math.abs(Number(amount) || 0));
  const cents = Math.round((Math.abs(Number(amount) || 0) - num) * 100);
  if (num === 0 && cents === 0) return "Zero " + currencyName + " Only";
  const parts = [];
  const billion = Math.floor(num / 1e9);
  const million = Math.floor((num % 1e9) / 1e6);
  const thousand = Math.floor((num % 1e6) / 1e3);
  const rest = num % 1e3;
  if (billion) parts.push(threeDigit(billion) + " Billion");
  if (million) parts.push(threeDigit(million) + " Million");
  if (thousand) parts.push(threeDigit(thousand) + " Thousand");
  if (rest) parts.push(threeDigit(rest));
  let out = parts.join(" ").trim();
  out = (out ? out + " " + currencyName : "");
  if (cents) out += (out ? " and " : "") + twoDigit(cents) + " " + (minorName || "Cents");
  return (out || "Zero " + currencyName) + " Only";
}

/* Currency-aware dispatcher — every document's "amount in words" line
   should go through this, not amountInWords() directly. */
function amountInWordsForCurrency(amount, currencyCode) {
  if (!currencyCode || currencyCode === "INR") return amountInWords(amount);
  const cur = getCurrency(currencyCode);
  if (cur.decimals === 0) return amountInWordsWestern(amount, cur.name, "");
  return amountInWordsWestern(amount, cur.name, "Cents");
}

function buildDocNumber(prefix, seq) {
  const y = new Date();
  const fy = (y.getMonth() >= 3 ? y.getFullYear() : y.getFullYear() - 1) % 100;
  return `${prefix}/${fy}${fy + 1}/${String(seq || 1).padStart(4, "0")}`;
}

/* ------------------------- quote calculation ----------------------- */

function computeQuote(quote, sellerState) {
  const items = quote.items || [];
  const taxExempt = quote.taxType === "none";
  const rows = items.map((it) => {
    const gross = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    const disc = gross * ((Number(it.disc) || 0) / 100);
    const taxable = round2(gross - disc);
    const tax = taxExempt ? 0 : round2(taxable * ((Number(it.gst) || 0) / 100));
    return { ...it, gross: round2(gross), discAmt: round2(disc), taxable, tax, total: round2(taxable + tax) };
  });
  const gross = round2(rows.reduce((a, r) => a + r.gross, 0));
  const discount = round2(rows.reduce((a, r) => a + r.discAmt, 0));
  const taxable = round2(rows.reduce((a, r) => a + r.taxable, 0));
  const taxTotal = round2(rows.reduce((a, r) => a + r.tax, 0));
  const intra = (quote.billState || "") === sellerState;
  const grandRaw = taxable + taxTotal;
  const grand = quote.roundOff ? Math.round(grandRaw) : round2(grandRaw);
  const roundDiff = round2(grand - grandRaw);
  const slabs = {};
  rows.forEach((r) => {
    const k = Number(r.gst) || 0;
    if (!slabs[k]) slabs[k] = { taxable: 0, tax: 0 };
    slabs[k].taxable = round2(slabs[k].taxable + r.taxable);
    slabs[k].tax = round2(slabs[k].tax + r.tax);
  });
  return { rows, gross, discount, taxable, taxTotal, intra, grand, roundDiff, slabs,
    cgst: round2(taxTotal / 2), sgst: round2(taxTotal / 2), igst: taxTotal };
}

/* ------------------------------ styles ----------------------------- */


export { STATES, COUNTRIES, CURRENCIES, getCurrency, fmtCurrency, fmtCurrencyPdf, fmtMoneyCellPdf, validateGSTIN, taxTypeLabel, amountInWords, amountInWordsWestern, amountInWordsForCurrency, buildDocNumber, computeQuote, round2, inr, inrShort, PDF_UNSAFE_CURRENCY_CODES };
