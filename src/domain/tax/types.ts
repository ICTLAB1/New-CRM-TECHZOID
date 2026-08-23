export type TaxType = "gst" | "vat" | "sales_tax" | "none";

export const TAX_TYPES: ReadonlyArray<readonly [TaxType, string]> = [
  ["gst", "GST (India)"],
  ["vat", "VAT"],
  ["sales_tax", "Sales Tax"],
  ["none", "No Tax / Exempt"],
];

export function taxTypeLabel(taxType: string | null | undefined): string {
  return TAX_TYPES.find((t) => t[0] === taxType)?.[1] ?? "Tax";
}

/** A single line on a quotation / proforma / order. Legacy rows may be
 *  missing anything but `id`, so every numeric field is read defensively. */
export interface LineItem {
  id: string;
  desc?: string;
  subDesc?: string;
  brand?: string;
  sku?: string;
  hsn?: string;
  qty?: number | string;
  unit?: string;
  rate?: number | string;
  /** Discount percentage, applied before tax. */
  disc?: number | string;
  /** Per-item tax rate percentage. Named `gst` for database compatibility —
   *  it carries the rate for every regime, not only GST. */
  gst?: number | string;
}

export interface ComputedRow extends LineItem {
  gross: number;
  discAmt: number;
  taxable: number;
  tax: number;
  total: number;
}

export interface TaxSlab {
  taxable: number;
  tax: number;
}

/** The minimum a document must supply to be totalled. Deliberately narrow:
 *  totals must never depend on anything but these. */
export interface TaxableDocument {
  items?: LineItem[] | null;
  taxType?: string | null;
  /** Buyer's state. Compared against the seller's to pick CGST+SGST vs IGST. */
  billState?: string | null;
  roundOff?: boolean | null;
}

export interface DocumentTotals {
  rows: ComputedRow[];
  gross: number;
  discount: number;
  taxable: number;
  taxTotal: number;
  /** true when seller and buyer are in the same state (CGST+SGST). */
  intra: boolean;
  grand: number;
  roundDiff: number;
  slabs: Record<number, TaxSlab>;
  cgst: number;
  sgst: number;
  igst: number;
}
