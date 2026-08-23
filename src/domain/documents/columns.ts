import { fmtMoneyCellPdf } from "../currency/format";
import { taxTypeLabel } from "../tax/types";
import type { ComputedRow } from "../tax/types";
import { isOn, type ColumnToggles } from "./template";

/**
 * The items table.
 *
 * THIS IS THE SHARED DEFINITION. The PDF renderer and the on-screen preview
 * both build their table from this one function — which columns appear, in
 * what order, how wide, how each cell is formatted. They drifted apart once
 * and it took a byte-level comparison to catch; a single definition is what
 * stops it happening again. Do not add a column to one renderer only.
 *
 * WIDTHS ARE MEASURED, NOT CHOSEN. They were sized against real worst-case
 * content — 7-figure totals, 12-character Microsoft SKUs, "Kaspersky",
 * "Project" — so nothing wraps mid-value. With every column shown they total
 * exactly 180mm (asserted by test). Changing one means re-measuring against
 * that content, in a rendered PDF image, not by eye.
 *
 * MONEY COLUMNS CARRY A BARE NUMBER. The header already names the currency
 * ("Unit Price (INR)"). Repeating "Rs." in every cell pushed large figures
 * onto a second line mid-number — "Rs. 376,6 / 56.00" — which looks broken to
 * a customer. Do not add the prefix back.
 */

export type ColumnKey =
  | "num" | "desc" | "subDesc" | "brand" | "sku" | "hsn"
  | "qty" | "unit" | "rate" | "disc" | "gst" | "gstamt" | "total";

export type Align = "left" | "center" | "right";

/** Cell padding in millimetres, per class. Values are v1's, measured. */
export type PadClass = "default" | "tight" | "money";

export const PADDING_MM: Record<PadClass, { top: number; bottom: number; left: number; right: number }> = {
  default: { top: 1.6, bottom: 1.6, left: 1.6, right: 1.6 },
  tight: { top: 1.6, bottom: 1.6, left: 0.8, right: 0.8 },
  money: { top: 1.6, bottom: 1.6, left: 1, right: 1 },
};

/** Body font size when a column does not override it. */
export const BASE_FONT_PT = 6.6;

export interface ItemColumn {
  key: ColumnKey;
  /** Header text. May contain a newline — the unit sits on its own line. */
  head: string;
  /** Width in millimetres on the A4 page. */
  w: number;
  align: Align;
  /** Monospaced in both renderers, so digits line up column-wise. */
  mono: boolean;
  bold: boolean;
  /** Type size in points. MEASURED against worst-case content together with
   *  the width and padding below — the three only work as a set. */
  fontSize: number;
  /** Cell padding class. "tight" buys ~1.6mm of content width in a narrow
   *  column; "12.00" and "18%" do not fit at default padding and wrap
   *  mid-number without it. */
  pad: PadClass;
  /** Muted text, for the row number and sub-description. */
  muted: boolean;
  get: (row: ComputedRow, index: number) => string;
}

/** Total width available between the page margins, and the measured base. */
export const CONTENT_WIDTH_MM = 184;
export const MEASURED_TABLE_WIDTH_MM = 180;
/** Text columns may be squeezed no narrower than this before they wrap badly. */
export const MIN_TEXT_COL_MM = 12;

interface ColumnSpec extends Omit<ItemColumn, "head" | "get"> {
  head: string | ((ctx: BuildCtx) => string);
  get: ItemColumn["get"];
  /** Always shown, whatever the toggles say. */
  always?: boolean;
  /** Hidden when this optional column is switched off in settings. */
  toggle?: keyof ColumnToggles;
  /** Hidden when the document carries no tax at all. */
  taxOnly?: boolean;
}

interface BuildCtx {
  currency: string;
  taxType: string;
}

const SPECS: ColumnSpec[] = [
  { key: "num", head: "S.No.", w: 9, align: "center", mono: false, bold: false, fontSize: BASE_FONT_PT, pad: "default", muted: true, always: true,
    get: (_r, i) => String(i + 1) },
  { key: "desc", head: "Product Description", w: 27, align: "left", mono: false, bold: true, fontSize: BASE_FONT_PT, pad: "default", muted: false, always: true,
    get: (r) => r.desc || "—" },
  { key: "subDesc", head: "Description", w: 20, align: "left", mono: false, bold: false, fontSize: 6.3, pad: "default", muted: true, toggle: "subDesc",
    get: (r) => r.subDesc || "" },
  { key: "brand", head: "Brand", w: 12, align: "left", mono: false, bold: false, fontSize: 6.3, pad: "tight", muted: false, toggle: "brand",
    get: (r) => r.brand || "" },
  { key: "sku", head: "SKU / Part No.", w: 14, align: "left", mono: true, bold: false, fontSize: 4.7, pad: "tight", muted: false, toggle: "sku",
    get: (r) => r.sku || "" },
  { key: "hsn", head: "HSN", w: 11, align: "left", mono: true, bold: false, fontSize: 5.8, pad: "tight", muted: false, toggle: "hsn",
    get: (r) => r.hsn || "" },
  { key: "qty", head: "Qty", w: 8, align: "center", mono: false, bold: false, fontSize: BASE_FONT_PT, pad: "default", muted: false, always: true,
    get: (r) => String(r.qty) },
  { key: "unit", head: "Unit", w: 9, align: "center", mono: false, bold: false, fontSize: 6.2, pad: "tight", muted: false, always: true,
    get: (r) => r.unit || "" },
  { key: "rate", head: "", w: 18, align: "right", mono: true, bold: false, fontSize: 5.9, pad: "money", muted: false, always: true,
    get: () => "" },
  { key: "disc", head: "Disc.\n(%)", w: 8, align: "right", mono: false, bold: false, fontSize: BASE_FONT_PT, pad: "tight", muted: false, always: true,
    get: (r) => Number(r.disc || 0).toFixed(2) },
  { key: "gst", head: "Tax\n%", w: 7, align: "right", mono: false, bold: false, fontSize: BASE_FONT_PT, pad: "tight", muted: false, taxOnly: true,
    get: (r) => (r.gst || 0) + "%" },
  { key: "gstamt", head: "", w: 18, align: "right", mono: true, bold: false, fontSize: 5.9, pad: "money", muted: false, taxOnly: true,
    get: () => "" },
  { key: "total", head: "", w: 19, align: "right", mono: true, bold: true, fontSize: 5.9, pad: "money", muted: false, always: true,
    get: () => "" },
];

/** Headers and cell getters that depend on the document's currency / regime. */
const DYNAMIC: Partial<Record<ColumnKey, { head: (c: BuildCtx) => string; get: (c: BuildCtx) => ItemColumn["get"] }>> = {
  rate: {
    head: (c) => "Unit Price\n(" + c.currency + ")",
    get: (c) => (r) => fmtMoneyCellPdf(r.rate, c.currency),
  },
  gstamt: {
    head: (c) => (c.taxType === "gst" ? "GST" : taxTypeLabel(c.taxType)) + " Amount\n(" + c.currency + ")",
    get: (c) => (r) => fmtMoneyCellPdf(r.tax, c.currency),
  },
  total: {
    head: (c) => "Total\n(" + c.currency + ")",
    get: (c) => (r) => fmtMoneyCellPdf(r.total, c.currency),
  },
};

export interface BuildColumnsOptions {
  currency: string;
  taxType: string;
  columns: ColumnToggles;
  /** Width the table must fill. Defaults to the classic content width.
   *  Pass null to skip fitting and get the measured widths untouched. */
  tableWidthMm?: number | null;
}

/**
 * Build the visible column set for one document, already fitted to width.
 *
 * When columns are hidden, the Product Description column absorbs the freed
 * width so the table always fills the page instead of leaving a dead gap on
 * the right. When the table is narrower than its fixed columns need, the
 * shortfall comes out of the two text columns that wrap gracefully — never
 * out of the numeric ones, which are sized to the digit and would wrap
 * mid-figure.
 */
export function buildItemColumns(opts: BuildColumnsOptions): ItemColumn[] {
  const ctx: BuildCtx = { currency: opts.currency || "INR", taxType: opts.taxType || "gst" };
  const showTax = ctx.taxType !== "none";

  const cols: ItemColumn[] = SPECS.filter((spec) => {
    if (spec.taxOnly) return showTax;
    if (spec.always) return true;
    return spec.toggle ? isOn(opts.columns[spec.toggle]) : true;
  }).map((spec) => {
    const dyn = DYNAMIC[spec.key];
    return {
      key: spec.key,
      head: dyn ? dyn.head(ctx) : (spec.head as string),
      w: spec.w,
      align: spec.align,
      mono: spec.mono,
      bold: spec.bold,
      fontSize: spec.fontSize,
      pad: spec.pad,
      muted: spec.muted,
      get: dyn ? dyn.get(ctx) : spec.get,
    };
  });

  if (opts.tableWidthMm !== null) fitToWidth(cols, opts.tableWidthMm ?? CONTENT_WIDTH_MM);
  return cols;
}

/** Distribute the difference between the columns' natural width and the
 *  available width. Mutates in place, as v1 did. */
export function fitToWidth(cols: ItemColumn[], tableWidthMm: number): void {
  const used = cols.reduce((a, c) => a + c.w, 0);
  const spare = tableWidthMm - used;

  if (spare > 0.5) {
    const desc = cols.find((c) => c.key === "desc");
    if (desc) desc.w += spare;
    return;
  }
  if (spare < -0.5) {
    let deficit = -spare;
    const flexible = (["desc", "subDesc"] as const)
      .map((k) => cols.find((c) => c.key === k))
      .filter((c): c is ItemColumn => !!c);
    for (const col of flexible) {
      if (deficit <= 0) break;
      const canGive = Math.max(0, col.w - MIN_TEXT_COL_MM);
      const give = Math.min(canGive, deficit);
      col.w -= give;
      deficit -= give;
    }
  }
}

/** The natural (unfitted) width of a column set — the measured figure. */
export function naturalWidth(cols: readonly { w: number }[]): number {
  return cols.reduce((a, c) => a + c.w, 0);
}
