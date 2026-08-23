import { amountInWordsForCurrency } from "../words/amountInWords";
import { fmtCurrencyPdf } from "../currency/format";
import { taxTypeLabel } from "../tax/types";
import type { DocumentTotals } from "../tax/types";
import { stateNameForCode, STATES } from "../geo/states";
import { buildItemColumns, type ItemColumn } from "./columns";
import { isOn, type DocTemplate, type SectionKey } from "./template";

export type DocType = "quotation" | "proforma";

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

export interface DocumentModel {
  docType: DocType;
  isProforma: boolean;
  currency: string;
  taxType: string;
  number: string;
  title: string;
  /** Sections to draw, in order, already filtered by visibility. */
  sectionOrder: SectionKey[];
  accentColor: string;

  header: {
    companyName: string;
    addressLine: string;
    contactLines: string[];
    uaeOffice: { name: string; lines: string } | null;
    isoLines: string[];
    meta: Pair[];
    registrationParts: string[];
  };

  parties: PartyModel[];

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

  signature: {
    forLine: string;
    signatoryName: string;
    signatoryDesignation: string;
    acceptance: { heading: string; fields: string[]; sealLabel: string } | null;
    weAccept: { label: string; methods: string[] } | null;
  };

  footer: { contactBits: string[]; closing: string };
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
  const L = dt.labels;
  const SEC = dt.sections;
  const c = s.company ?? {};
  const currency = doc.currency || "INR";
  const taxType = doc.taxType || "gst";
  const bank = input.bankAccount ?? {};

  /* ---- header ---- */
  const addressLine = [c.address, c.city, c.state, c.pincode].filter(Boolean).join(", ");
  const contactLines = [hasRealPhone(c.phone) ? c.phone : null, c.email, c.website].filter(Boolean).map(String);

  const uae = s.uaeOffice ?? {};
  const uaeOffice =
    isOn(SEC.uaeOffice) && (uae.address || uae.city)
      ? { name: uae.name || "UAE Office", lines: [uae.address, uae.city, uae.country].filter(Boolean).join(", ") }
      : null;

  const isoLines = isOn(SEC.isoCerts)
    ? String(s.isoCertText || "").split("\n").map((x: string) => x.trim()).filter(Boolean)
    : [];

  const meta: Pair[] = isProforma
    ? [
        ["Invoice No.", doc.number],
        ["Reference No.", doc.referenceNo || "—"],
        ["Revision No.", String(doc.revisionNo || 0)],
        ["Date", fmtDate(doc.date)],
        ["Payment Terms", (doc.advancePercent || 100) + "% Advance"],
        ["Valid Till", fmtDate(doc.validUntil)],
        ...(doc.quoteNumber ? ([["Ref. Quotation", doc.quoteNumber]] as Pair[]) : []),
        ["Currency", currency],
      ]
    : [
        ["Quotation No.", doc.number],
        ["Reference No.", doc.referenceNo || "—"],
        ["Revision No.", String(doc.revisionNo || 0)],
        ["Date", fmtDate(doc.date)],
        ["Valid Till", fmtDate(doc.validUntil)],
        ["Sales Executive", doc.preparedBy || "—"],
        ["Payment Terms", doc.paymentTerms || "As per agreement"],
        /* The quotation header hardcoded "Currency: INR" while the proforma
           read the document. Both read the document now. */
        ["Currency", currency],
      ];

  const registrationParts = [
    c.cin && "CIN: " + c.cin,
    c.gstin && "GSTIN: " + c.gstin,
    c.pan && "PAN: " + c.pan,
  ].filter(Boolean) as string[];

  /* ---- parties ---- */
  const stateCode = STATES.find(([n]) => n === doc.billState)?.[1];
  const isGst = taxType === "gst";
  const billCountry = doc.billCountry || "India";
  const placeOfSupply = (state: string | undefined): string | null =>
    isGst ? (state || "") + (stateCode ? " (" + stateCode + ")" : "") : null;

  const partyRows = (p: Record<string, any>): Pair[] =>
    ([
      ["GSTIN", p.gstin],
      ["PAN", p.pan],
      ["Contact", p.contact],
      ["Mobile", p.phone],
      ["Email", p.email],
      ["State", p.state],
      ["Place of Supply", p.pos],
    ] as [string, unknown][])
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)] as Pair);

  const billParty = {
    name: doc.billName,
    lines: [doc.billAddress, [doc.billState, billCountry].filter(Boolean).join(", ")].filter(Boolean).map(String),
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
        lines: [
          doc.shipAddress || doc.billAddress,
          [doc.shipState || doc.billState, shipCountry].filter(Boolean).join(", "),
        ].filter(Boolean).map(String),
        gstin: doc.shipGstin || doc.billGstin,
        pan: doc.shipPan || doc.billPan,
        contact: doc.shipContact || doc.billContact,
        phone: doc.shipPhone || doc.billPhone,
        email: doc.shipEmail || doc.billEmail,
        state: doc.shipState || doc.billState,
        pos: placeOfSupply(doc.shipState || doc.billState),
      };

  const toParty = (heading: string, p: typeof billParty): PartyModel => ({
    heading,
    name: p.name || "—",
    lines: p.lines,
    rows: partyRows(p),
  });

  const parties: PartyModel[] = [
    toParty(isProforma ? L.proformaBillHeading : L.quotedToHeading, billParty),
    toParty(L.billingHeading, billParty),
    toParty(L.shippingHeading, shipParty),
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
    { label: "Sub Total", value: money(t.gross) },
    { label: "Discount", value: money(t.discount) },
    { label: "Taxable Amount", value: money(t.taxable) },
    ...taxRows,
    ...(doc.roundOff ? [{ label: "Round Off", value: money(t.roundDiff) }] : []),
  ];

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

  const bankBlock =
    isProforma && isOn(SEC.bankDetails) && (bank.name || bank.account)
      ? {
          heading:
            (L.bankHeading || "Bank Details").toUpperCase() +
            (bank.label && bank.label !== bank.name ? " — " + String(bank.label).toUpperCase() : ""),
          rows: bankRows,
          upiQr: bank.upiQr ?? null,
        }
      : null;

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
  const showAcceptance = !isProforma && isOn(SEC.customerAcceptance);
  const signature: DocumentModel["signature"] = {
    forLine: (L.forCompanyPrefix || "For") + " " + (c.name || "TechZoid Technologies Private Limited"),
    signatoryName: s.signatoryName || "",
    signatoryDesignation: s.signatoryDesignation || "",
    acceptance: showAcceptance
      ? { heading: L.acceptanceHeading || "Customer Acceptance", fields: ["Name", "Signature", "Date"], sealLabel: L.sealLabel || "Company Seal" }
      : null,
    weAccept:
      !showAcceptance && !isProforma && (bank.name || bank.account)
        ? { label: (L.weAcceptLabel || "We Accept").toUpperCase(), methods: ["UPI", "NEFT / RTGS", "Bank Transfer"] }
        : null,
  };

  /* ---- footer ---- */
  const footer = {
    contactBits: [
      hasRealPhone(c.phone) ? c.phone : null,
      c.email,
      c.website,
      [c.city, c.state].filter(Boolean).join(", "),
    ].filter(Boolean).map(String),
    closing: isProforma
      ? L.closingProforma || "This is a Proforma Invoice and not a Tax Invoice."
      : doc.footer || L.closingQuote || "Thank you for your business!",
  };

  return {
    docType,
    isProforma,
    currency,
    taxType,
    number: doc.number,
    title: isProforma ? "PROFORMA INVOICE" : "QUOTATION",
    sectionOrder: dt.sectionOrder,
    accentColor: dt.accentColor,
    header: { companyName: c.name || "", addressLine, contactLines, uaeOffice, isoLines, meta, registrationParts },
    parties,
    intro: {
      salutation: !isProforma && isOn(SEC.salutation) ? L.salutation || "Dear Sir / Madam," : null,
      body:
        !isProforma && isOn(SEC.salutation)
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
    signature,
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
