import { amountInWordsForCurrency } from "../words/amountInWords";
import { fmtCurrencyPdf } from "../currency/format";
import { taxTypeLabel } from "../tax/types";
import type { DocumentTotals } from "../tax/types";
import { stateNameForCode, STATES } from "../geo/states";
import { buildItemColumns, type ItemColumn } from "./columns";
import { isOn, type DocTemplate, type SectionKey } from "./template";
import { DEFAULT_CERTIFICATIONS } from "./brandDefaults";

export type DocType = "quotation" | "proforma" | "purchase_order" | "invoice";

/** A label/value pair, as printed with a colon between. */
export type Pair = readonly [label: string, value: string];

export interface PartyModel {
  heading: string;
  name: string;
  lines: string[];
  rows: Pair[];
}

export interface TotalRow {
  label: string;
  /** Already formatted for display, in the document's currency. */
  value: string;
}

export interface LogoCell {
  type: "image" | "years";
  src?: string;
  /** Natural width in mm, already fitted to the 26×13 box. */
  w: number;
  h: number;
  years?: string;
}

/** One cell of the four-across reference strip under the party grid. */
export interface RefCell { label: string; value: string }

/** A slot in one of the footer strips.
 *
 *  `src` is present only when an approved asset is configured; otherwise the
 *  renderer prints `text`, and never fabricates a badge.
 *
 *  `certNo` is the certificate/licence number under a certification's name —
 *  left blank when none is configured rather than invented, same as every
 *  other supplied-or-omitted asset in this model. */
export interface LogoSlot {
  text: string;
  src?: string | null;
  caption?: string;
  certNo?: string;
  /** Natural pixel size, so the renderer can preserve the aspect ratio. */
  w?: number;
  h?: number;
}

export interface DocumentModel {
  docType: DocType;
  isProforma: boolean;
  /** Which kind this is. Carried on the model rather than re-derived from
   *  the title, so a renderer or a filename never has to string-match a
   *  heading that exists to be read by a person. */
  isPurchaseOrder: boolean;
  isInvoice: boolean;
  currency: string;
  taxType: string;
  number: string;
  title: string;
  /** Sections to draw, in order, already filtered by visibility. */
  sectionOrder: SectionKey[];
  accentColor: string;

  header: {
    companyName: string;
    /** The uploaded company logo, or null to print the wordmark instead.
     *  On the MODEL rather than passed to each renderer separately, because
     *  the preview and the PDF disagreeing about the company's own logo is
     *  exactly the drift this architecture exists to prevent — the preview
     *  used to hardcode "TECHZOID" while the PDF drew whatever it was given. */
    logo: { src: string; w: number; h: number } | null;
    /** "Technology Procurement | Licensing | Hardware | Enterprise Solutions" */
    tagline: string;
    /** Each element is one printed line: street, then city/state/pincode,
     *  then country. */
    addressLines: string[];
    /** Phone, email and website, already joined into the single line the
     *  design shows — "+91 ... · sales@... · https://...". */
    contactLine: string;
    /** "GSTIN ...", "PAN ...", "CIN ..." — already labelled, printed on one
     *  line under the address. */
    registration: string[];
    uaeOffice: { addressLine: string; regParts: string[] } | null;
    /** Date / Valid Until / Revision / Currency, beside the title block. */
    meta: Pair[];
  };

  /** Left column of the details grid: quotation no, date, valid until,
   *  customer id, sales executive, enquiry reference. */
  details: Pair[];

  /** Bill To and Ship To. The design shows exactly these two, boxed. */
  parties: PartyModel[];

  /** Customer Reference | Enquiry Reference | Payment Terms | Delivery Terms */
  references: RefCell[];

  intro: { salutation: string | null; body: string | null; subject: string | null };

  items: { columns: ItemColumn[]; rowCount: number };

  money: {
    rows: TotalRow[];
    grandLabel: string;
    grandValue: string;
    advance: TotalRow | null;
    amountInWords: string | null;
    terms: string[];
    bank: { heading: string; rows: Pair[]; upiQr: string | null } | null;
  };

  notes: string[];

  /** HSN/SAC summary table. Every column after "HSN / SAC" is already
   *  formatted for display; `columns` names them so a renderer draws
   *  whatever is there without knowing CGST/SGST from IGST itself. Null when
   *  there is nothing to group — no GST, or no line carries an HSN/SAC. */
  hsnSummary: { columns: string[]; rows: string[][]; totalRow: string[] } | null;

  signature: {
    forLine: string;
    signatoryName: string;
    signatoryDesignation: string;
    acceptance: { heading: string; fields: string[]; sealLabel: string } | null;
    weAccept: { label: string; methods: string[] } | null;
  };

  /** The three strips above the footer. Each renders from configured assets
   *  and falls back to text; nothing here is ever fabricated. */
  strips: {
    designations: LogoSlot[];
    partners: LogoSlot[];
    certifications: LogoSlot[];
  };

  /** Company details now live in the header banner, not repeated down here —
   *  the design keeps the footer to the closing line and page number. */
  footer: {
    closing: string;
  };
}

/* v1 treated a phone field holding only punctuation or a stray "-" as absent,
   rather than printing a dash where a number should be. */
export function hasRealPhone(v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (!s) return false;
  return /[0-9]/.test(s);
}

export interface BuildModelInput {
  doc: Record<string, any>;
  settings: Record<string, any>;
  totals: DocumentTotals;
  docType: DocType;
  template: DocTemplate;
  bankAccount?: Record<string, any> | null;
  /** Natural dimensions of each partner logo, in the same order. */
  logoDims?: ({ w: number; h: number } | null)[];
}

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** Fit a natural size inside a box, preserving aspect ratio. */
export function fitBox(dims: { w: number; h: number } | null, maxW: number, maxH: number): { w: number; h: number } {
  if (!dims || !dims.w || !dims.h) return { w: maxW, h: maxH };
  const scale = Math.min(maxW / dims.w, maxH / dims.h);
  return { w: dims.w * scale, h: dims.h * scale };
}

/**
 * Build the one description of what this document says.
 *
 * The PDF renderer and the on-screen preview both consume this. Anything that
 * decides CONTENT — which rows, which labels, which figures, in what order —
 * belongs here. Only geometry and drawing primitives belong in a renderer.
 */
export function buildDocumentModel(input: BuildModelInput): DocumentModel {
  const { doc, settings: s, totals: t, docType, template: dt } = input;
  const isProforma = docType === "proforma";
  /* A purchase order faces the other way: the company is the buyer, the
     counterparty is a supplier, and the Bill To box is the company's own. */
  const isPurchaseOrder = docType === "purchase_order";
  /* A tax invoice asks for money: its second date is a payment due date,
     not a validity window, and the bank details are the point of it. */
  const isInvoice = docType === "invoice";
  const L = dt.labels;
  const SEC = dt.sections;
  const c = s.company ?? {};
  const currency = doc.currency || "INR";
  const taxType = doc.taxType || "gst";
  const bank = input.bankAccount ?? {};

  /* ---- header ---- */
  const addressBlock = String(c.address ?? "").split("\n").map((l: string) => l.trim()).filter(Boolean);
  const cityLine = [c.city, [c.state, c.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const headerAddressLines = [...addressBlock, cityLine, c.country || "India"].filter(Boolean) as string[];

  const contactLine = [hasRealPhone(c.phone) ? c.phone : null, c.email, c.website].filter(Boolean).join(" · ");

  const registration = [
    c.gstin && "GSTIN " + c.gstin,
    c.pan && "PAN " + c.pan,
    c.cin && "CIN " + c.cin,
  ].filter(Boolean) as string[];

  const uae = s.uaeOffice ?? {};
  const uaeOffice =
    isOn(SEC.uaeOffice) && (uae.address || uae.phone)
      ? {
          addressLine: [uae.address, hasRealPhone(uae.phone) ? uae.phone : null].filter(Boolean).join(" · "),
          regParts: [
            uae.businessLicense && "Business License " + uae.businessLicense,
            uae.taxRegistrationNumber && "Tax Registration Number " + uae.taxRegistrationNumber,
          ].filter(Boolean) as string[],
        }
      : null;

  const details: Pair[] = isPurchaseOrder
    ? [
        ["PO No.", doc.number],
        ["PO Date", fmtDate(doc.date)],
        /* Not a validity date on a purchase order: it is the date the goods
           are required by, and what the delay clauses are measured against. */
        ["Required By", fmtDate(doc.validUntil)],
        ["Supplier Ref.", doc.referenceNo || "—"],
        ["Raised By", doc.preparedBy || "—"],
      ]
    : isInvoice
    ? [
        ["Invoice No.", doc.number],
        ["Invoice Date", fmtDate(doc.date)],
        ["Payment Due", fmtDate(doc.validUntil)],
        ["Customer ID", doc.customerCode || "—"],
        ["Sales Executive", doc.preparedBy || "—"],
        ["Against", doc.quoteNumber || "—"],
      ]
    : isProforma
    ? [
        ["Invoice No.", doc.number],
        ["Invoice Date", fmtDate(doc.date)],
        ["Valid Until", fmtDate(doc.validUntil)],
        ["Customer ID", doc.customerCode || "—"],
        ["Sales Executive", doc.preparedBy || "—"],
        ["Reference Quotation", doc.quoteNumber || "—"],
      ]
    : [
        ["Quotation No.", doc.number],
        ["Quotation Date", fmtDate(doc.date)],
        ["Valid Until", fmtDate(doc.validUntil)],
        /* A customer-facing code, never the database id — sequential or
           guessable identifiers must not leave the system. */
        ["Customer ID", doc.customerCode || "—"],
        ["Sales Executive", doc.preparedBy || "—"],
        ["Enquiry Reference", doc.enquiryRef || "—"],
      ];

  const references: RefCell[] = [
    { label: isPurchaseOrder ? "Supplier Reference" : "Customer Reference", value: doc.referenceNo || "—" },
    { label: "Enquiry Reference", value: doc.enquiryRef || "—" },
    { label: "Payment Terms", value: doc.paymentTerms || "As specified" },
    { label: "Delivery Terms", value: doc.deliveryTerms || "As specified" },
  ];

  /* Beside the title: date, validity, revision, currency. Nothing more — the
     details column directly below already carries the number, customer id,
     sales executive and references, and printing them twice cost 20mm of
     page. */
  const meta: Pair[] = [
    ["Date", fmtDate(doc.date)],
    [isPurchaseOrder ? "Required By" : isInvoice ? "Payment Due" : "Valid Until", fmtDate(doc.validUntil)],
    ["Revision", String(doc.revisionNo ?? 0)],
    ["Currency", currency],
  ];

  /* ---- parties ---- */
  const stateCode = STATES.find(([n]) => n === doc.billState)?.[1];
  const isGst = taxType === "gst";
  const billCountry = doc.billCountry || "India";
  const placeOfSupply = (state: string | undefined): string | null =>
    isGst ? (state || "") + (stateCode ? " (" + stateCode + ")" : "") : null;

  /* The design's boxes are deliberately short. The state and place of supply
     are already on the address lines, and repeating them squeezes the box
     without telling the reader anything new. */
  const partyRows = (p: Record<string, any>, kind: "bill" | "ship"): Pair[] =>
    (kind === "bill"
      ? ([["GSTIN", p.gstin], ["Contact", p.contact], ["Email", p.email], ["Phone", p.phone]] as [string, unknown][])
      : ([["Contact", p.contact], ["Phone", p.phone]] as [string, unknown][]))
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)] as Pair);

  const addressLines = (address: unknown, state: unknown, country: string): string[] => {
    const block = String(address ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    /* Only add the state when the address does not already name it — the
       reference shows "Uttar Pradesh - 201309" then "India", not the state
       twice. */
    const hasState = !!state && block.some((l) => l.toLowerCase().includes(String(state).toLowerCase()));
    return [...block, ...(!hasState && state ? [String(state)] : []), country].filter(Boolean);
  };

  const billParty = {
    name: doc.billName,
    lines: addressLines(doc.billAddress, doc.billState, billCountry),
    gstin: doc.billGstin, pan: doc.billPan, contact: doc.billContact,
    phone: doc.billPhone, email: doc.billEmail, state: doc.billState,
    pos: placeOfSupply(doc.billState),
  };
  const shipSame = doc.shipSameAsBilling !== false;
  const shipCountry = doc.shipCountry || billCountry;
  const shipParty = shipSame
    ? billParty
    : {
        name: doc.shipName || doc.billName,
        lines: addressLines(doc.shipAddress || doc.billAddress, doc.shipState || doc.billState, shipCountry),
        gstin: doc.shipGstin || doc.billGstin,
        pan: doc.shipPan || doc.billPan,
        contact: doc.shipContact || doc.billContact,
        phone: doc.shipPhone || doc.billPhone,
        email: doc.shipEmail || doc.billEmail,
        state: doc.shipState || doc.billState,
        pos: placeOfSupply(doc.shipState || doc.billState),
      };

  const toParty = (heading: string, p: typeof billParty, kind: "bill" | "ship"): PartyModel => ({
    heading,
    name: p.name || "—",
    lines: p.lines,
    rows: partyRows(p, kind),
  });

  /* On a PURCHASE ORDER the company is the buyer, so the boxes are:
     the SUPPLIER being ordered from, BILL TO (the company itself, read from
     settings rather than stored on the order so an address change does not
     leave old orders showing the old one), and SHIP TO — the company's own
     address unless the goods are drop-shipped to a customer. */
  const ourParty = {
    name: c.name ?? "",
    lines: headerAddressLines,
    gstin: c.gstin, pan: c.pan, contact: s.signatoryName, phone: c.phone,
    email: c.email, state: c.state, pos: null,
  };
  const vendorParty = {
    name: doc.vendorName,
    lines: addressLines(doc.vendorAddress, doc.vendorState, doc.vendorCountry || "India"),
    gstin: doc.vendorGstin, pan: "", contact: doc.vendorContact,
    phone: doc.vendorPhone, email: doc.vendorEmail, state: doc.vendorState,
    pos: placeOfSupply(doc.vendorState),
  };

  /* The design carries two party boxes on a quotation, not three: Bill To
     and Ship To. v1's separate "Quoted To" column repeated the billing
     party verbatim. */
  const parties: PartyModel[] = isPurchaseOrder
    ? [
        toParty("SUPPLIER", vendorParty as typeof billParty, "bill"),
        toParty("BILL TO", ourParty as typeof billParty, "bill"),
        toParty("SHIP TO", doc.shipSameAsBilling === false ? shipParty : (ourParty as typeof billParty), "ship"),
      ]
    : [
        toParty("BILL TO", billParty, "bill"),
        toParty("SHIP TO", shipParty, "ship"),
      ];

  /* ---- money ---- */
  const gstPct = t.rows.length ? Number(t.rows[0]?.gst ?? 18) : 18;
  const money = (v: number): string => fmtCurrencyPdf(v, currency);

  const taxRows: TotalRow[] =
    taxType === "gst"
      ? t.intra
        ? [
            { label: "CGST @ " + gstPct / 2 + "%", value: money(t.cgst) },
            { label: "SGST @ " + gstPct / 2 + "%", value: money(t.sgst) },
          ]
        : [{ label: "IGST @ " + gstPct + "%", value: money(t.igst) }]
      : taxType === "none"
        ? []
        : [{ label: taxTypeLabel(taxType) + " @ " + gstPct + "%", value: money(t.taxTotal) }];

  const totalRows: TotalRow[] = [
    { label: "Subtotal", value: money(t.gross) },
    { label: "Total Discount", value: money(t.discount) },
    { label: "Taxable Value", value: money(t.taxable) },
    ...taxRows,
    ...(doc.roundOff ? [{ label: "Round Off", value: money(t.roundDiff) }] : []),
  ];

  /* ---- HSN/SAC summary ----
     Every figure here is read from t.hsnGroups / t.taxable / t.taxTotal —
     already-computed, already-rounded totals — never re-derived. The per-row
     CGST/SGST split below is the same halving computeDocument() already does
     for t.cgst/t.sgst, just applied per group instead of once. */
  const hsnSummary =
    taxType === "gst" && t.hsnGroups.length
      ? {
          columns: ["HSN / SAC", "Taxable Value", "Rate", ...(t.intra ? ["CGST", "SGST"] : ["IGST"]), "Total Tax"],
          rows: t.hsnGroups.map((g) => [
            g.hsn,
            money(g.taxable),
            g.rate + "%",
            ...(t.intra ? [money(g.tax / 2), money(g.tax / 2)] : [money(g.tax)]),
            money(g.tax),
          ]),
          totalRow: [
            "Total",
            money(t.taxable),
            "",
            ...(t.intra ? [money(t.cgst), money(t.sgst)] : [money(t.igst)]),
            money(t.taxTotal),
          ],
        }
      : null;

  /* A saved label reading "Grand Total (INR)" is stale the moment the document
     is quoted in another currency — fall back to the live currency. */
  const staleInrLabel = !!L.grandTotalLabel && L.grandTotalLabel.includes("(INR)") && currency !== "INR";
  const grandLabel = L.grandTotalLabel && !staleInrLabel ? L.grandTotalLabel : "Grand Total (" + currency + ")";

  const advancePercent = Number(doc.advancePercent) || 0;
  const advance =
    isProforma && advancePercent > 0 && advancePercent < 100
      ? { label: "Advance (" + doc.advancePercent + "%)", value: money((t.grand * advancePercent) / 100) }
      : null;

  const bankRows: Pair[] = (
    [
      ["Bank Name", bank.name],
      ["Account Name", bank.accountName || c.name],
      ["Account Number", bank.account],
      ["IFSC Code", bank.ifsc],
      ["SWIFT Code", bank.swift],
      ["Branch", bank.branch],
      ["Account Type", bank.accountType],
    ] as [string, unknown][]
  )
    .filter(([, v]) => v)
    .map(([k, v]) => [k, String(v)] as Pair);

  /* Bank details print on a quotation too, in their own block below the
     HSN/SAC summary — not only on a proforma, where they instead share the
     terms column since a proforma prints no terms. */
  /* Not on a purchase order. Bank details tell someone where to PAY US —
     on a document where we are the buyer, printing our own account is at
     best noise and at worst an invitation to misdirect a payment. The
     supplier's details go on their invoice, not on our order. */
  const bankBlock =
    !isPurchaseOrder && isOn(SEC.bankDetails) && (bank.name || bank.account)
      ? {
          heading:
            (L.bankHeading || "Bank Details").toUpperCase() +
            (bank.label && bank.label !== bank.name ? " — " + String(bank.label).toUpperCase() : ""),
          rows: bankRows,
          upiQr: bank.upiQr ?? null,
        }
      : null;

  /* Terms print on a purchase order and a tax invoice as well as a
     quotation. On a proforma they are replaced by the payment notes block. */
  const terms = !isProforma && isOn(SEC.terms) ? (doc.terms || []).filter(Boolean).map(String) : [];

  /* ---- notes (proforma only) ---- */
  const notes =
    isProforma && isOn(SEC.notes)
      ? [
          "Kindly make the payment as per the bank details mentioned.",
          "After payment, the invoice and licence details will be shared.",
          "This is a computer generated document and does not require a signature.",
          ...(doc.terms || []).filter(Boolean).map(String),
        ]
      : [];

  /* ---- signature ---- */
  /* A purchase order ALWAYS carries an acknowledgement box, and it is the
     supplier's — they are the party being asked to accept. Labelling it
     "Customer Acceptance" asked the wrong person to sign, on a document
     they were never party to as a customer. It is not behind the
     customerAcceptance toggle either: that switch is about whether a
     CUSTOMER countersigns a quotation, which has nothing to do with a
     supplier acknowledging an order. */
  const showAcceptance = isPurchaseOrder || (!isProforma && !isInvoice && isOn(SEC.customerAcceptance));
  const signature: DocumentModel["signature"] = {
    forLine: (L.forCompanyPrefix || "For") + " " + (c.name || "TechZoid Technologies Private Limited"),
    signatoryName: s.signatoryName || "",
    signatoryDesignation: s.signatoryDesignation || "",
    acceptance: showAcceptance
      ? isPurchaseOrder
        ? {
            heading: "Supplier Acknowledgement",
            fields: ["Name", "Designation", "Signature", "Date"],
            sealLabel: "Company Seal",
          }
        : { heading: L.acceptanceHeading || "Customer Acceptance", fields: ["Name", "Signature", "Date"], sealLabel: L.sealLabel || "Company Seal" }
      : null,
    weAccept:
      /* "We Accept UPI / NEFT" is how WE take money. Meaningless on an order
         where we are the one paying. */
      !showAcceptance && !isProforma && !isPurchaseOrder && (bank.name || bank.account)
        ? { label: (L.weAcceptLabel || "We Accept").toUpperCase(), methods: ["UPI", "NEFT / RTGS", "Bank Transfer"] }
        : null,
  };

  /* ---- strips + footer ---- */
  const toSlots = (list: unknown): LogoSlot[] =>
    (Array.isArray(list) ? list : [])
      .map((x) => {
        const item = x as Record<string, unknown>;
        const text = String(item["label"] ?? item["name"] ?? "").trim();
        const slot: LogoSlot = {
          text,
          src: (item["logo"] as string) ?? (item["data"] as string) ?? null,
          caption: (item["caption"] as string) ?? undefined,
          certNo: (item["certNo"] as string) || undefined,
          w: typeof item["w"] === "number" ? item["w"] : undefined,
          h: typeof item["h"] === "number" ? item["h"] : undefined,
        };
        return slot;
      })
      .filter((slot) => slot.text || slot.src);

  /**
   * Certification marks stored before the badge artwork existed carry a
   * label and no image. A workspace saved its `certLogos` the first time an
   * admin opened Settings, so every LIVE install has those text-only rows
   * and would never see the marks — the new defaults only reach a fresh
   * install.
   *
   * So a stored row with no artwork borrows it from the default of the same
   * name. Matching on the LABEL, not on position: an admin may have
   * reordered them or removed one, and lending the 27001 badge to whatever
   * happens to sit third would be worse than showing no badge at all.
   */
  const withDefaultMarks = (slots: LogoSlot[]): LogoSlot[] =>
    slots.map((slot) => {
      if (slot.src) return slot;
      const known = DEFAULT_CERTIFICATIONS.find((c) => c.label === slot.text);
      return known ? { ...slot, src: known.data, w: known.w, h: known.h } : slot;
    });

  const strips = {
    designations: toSlots(s.partnerDesignations),
    partners: toSlots(s.brandingLogos),
    certifications: withDefaultMarks(toSlots(s.certLogos)),
  };

  const footer = {
    closing: isPurchaseOrder
      /* A quotation thanks the reader for the opportunity. A purchase order
         is issued TO a supplier, so that line thanked them for the chance to
         quote us — on a document telling them what to deliver. */
      ? doc.footer || "This purchase order is subject to the terms and conditions stated herein."
      : isInvoice
        ? doc.footer || "This is a computer generated tax invoice. Please quote the invoice number with your payment."
        : isProforma
          ? L.closingProforma || "This is a Proforma Invoice and not a Tax Invoice."
          : doc.footer || L.closingQuote || "Thank you for the opportunity to submit this quotation.",
  };

  return {
    docType,
    isProforma,
    isPurchaseOrder,
    isInvoice,
    currency,
    taxType,
    number: doc.number,
    title: isPurchaseOrder ? "PURCHASE ORDER" : isInvoice ? "TAX INVOICE" : isProforma ? "PROFORMA INVOICE" : "QUOTATION",
    sectionOrder: dt.sectionOrder,
    accentColor: dt.accentColor,
    header: {
      companyName: c.name || "",
      /* Only a logo with its natural size is usable: without both, a
         renderer cannot preserve the aspect ratio and would stretch it. */
      logo: c.logo && c.logoW && c.logoH ? { src: String(c.logo), w: Number(c.logoW), h: Number(c.logoH) } : null,
      tagline: c.tagline || "Technology Procurement  |  Licensing  |  Hardware  |  Enterprise Solutions",
      addressLines: headerAddressLines, contactLine, registration, uaeOffice, meta,
    },
    details,
    parties,
    references,
    intro: {
      salutation: !isProforma && !isPurchaseOrder && !isInvoice && isOn(SEC.salutation) ? L.salutation || "Dear Sir / Madam," : null,
      body:
        !isProforma && !isPurchaseOrder && !isInvoice && isOn(SEC.salutation)
          ? doc.intro ||
            "Thank you for your interest in our products and services. Please find below our best quotation as per your requirement."
          : null,
      subject: doc.subject || null,
    },
    items: {
      columns: buildItemColumns({ currency, taxType, columns: dt.columns }),
      rowCount: t.rows.length,
    },
    money: {
      rows: totalRows,
      grandLabel,
      grandValue: money(t.grand),
      advance,
      amountInWords: isOn(SEC.amountInWords) ? amountInWordsForCurrency(t.grand, currency) : null,
      terms,
      bank: bankBlock,
    },
    notes,
    hsnSummary,
    signature,
    strips,
    footer,
  };
}

/**
 * Pack partner logos into rows that each fit the content width.
 *
 * Forcing everything onto one line is what pushed the first logo off the page
 * edge once there were six or more. Rows wrap; each row is centred on its own.
 */
export function packLogoRows(cells: LogoCell[], contentWidthMm: number, gapMm = 5.5): LogoCell[][] {
  const rows: LogoCell[][] = [];
  let current: LogoCell[] = [];
  let currentW = 0;
  cells.forEach((cell) => {
    const added = cell.w + (current.length ? gapMm : 0);
    if (current.length && currentW + added > contentWidthMm) {
      rows.push(current);
      current = [cell];
      currentW = cell.w;
    } else {
      current.push(cell);
      currentW += added;
    }
  });
  if (current.length) rows.push(current);
  return rows;
}

/** Width of a packed row, including the dividers between cells. */
export function rowWidth(row: readonly LogoCell[], gapMm = 5.5): number {
  return row.reduce((a, c, i) => a + c.w + (i > 0 ? gapMm : 0), 0);
}

export { stateNameForCode };
