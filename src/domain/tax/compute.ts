import { round2 } from "../money";
import type { ComputedRow, DocumentTotals, HsnGroup, TaxSlab, TaxableDocument } from "./types";

/**
 * The single source of truth for document totals. The on-screen preview, the
 * PDF, the dashboard and every report must total a document through this
 * function — nothing may re-derive money on its own.
 *
 * Order of operations (do not reorder):
 *   1. gross    = qty × rate
 *   2. discount = gross × disc%          (discounts apply BEFORE tax)
 *   3. taxable  = gross − discount
 *   4. tax      = taxable × rate%        (ZERO when taxType === "none")
 *   5. grand    = taxable + tax, optionally rounded to the nearest unit
 *
 * `taxType === "none"` zeroes tax per row, at source — not by hiding a
 * column downstream. Exempt quotations were silently charging 18% because
 * the per-item rate was still applied and only the display was suppressed.
 */
export function computeDocument(doc: TaxableDocument, sellerState: string): DocumentTotals {
  const items = doc.items || [];
  const taxExempt = doc.taxType === "none";

  const rows: ComputedRow[] = items.map((it) => {
    const gross = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    const disc = gross * ((Number(it.disc) || 0) / 100);
    const taxable = round2(gross - disc);
    const tax = taxExempt ? 0 : round2(taxable * ((Number(it.gst) || 0) / 100));
    return {
      ...it,
      gross: round2(gross),
      discAmt: round2(disc),
      taxable,
      tax,
      total: round2(taxable + tax),
    };
  });

  const gross = round2(rows.reduce((a, r) => a + r.gross, 0));
  const discount = round2(rows.reduce((a, r) => a + r.discAmt, 0));
  const taxable = round2(rows.reduce((a, r) => a + r.taxable, 0));
  const taxTotal = round2(rows.reduce((a, r) => a + r.tax, 0));

  /* Same state → the tax splits into CGST + SGST. Different state → IGST.
     Both halves are carried on the result; the document decides which pair
     to print. A blank billState is treated as inter-state, which is the
     safe default for legacy records with no state captured. */
  const intra = (doc.billState || "") === sellerState;

  const grandRaw = taxable + taxTotal;
  const grand = doc.roundOff ? Math.round(grandRaw) : round2(grandRaw);
  const roundDiff = round2(grand - grandRaw);

  const slabs: Record<number, TaxSlab> = {};
  rows.forEach((r) => {
    const k = Number(r.gst) || 0;
    const slab = slabs[k] ?? (slabs[k] = { taxable: 0, tax: 0 });
    slab.taxable = round2(slab.taxable + r.taxable);
    slab.tax = round2(slab.tax + r.tax);
  });

  /* HSN/SAC summary: every line grouped by its code. Lines with no code set
     are left out of every group — there is nothing to group them under, and
     silently bucketing them under "" would understate every other group's
     share of the real total. */
  const hsnMap = new Map<string, HsnGroup>();
  rows.forEach((r) => {
    const hsn = String(r.hsn ?? "").trim();
    if (!hsn) return;
    const group = hsnMap.get(hsn) ?? { hsn, rate: Number(r.gst) || 0, taxable: 0, tax: 0 };
    group.taxable = round2(group.taxable + r.taxable);
    group.tax = round2(group.tax + r.tax);
    hsnMap.set(hsn, group);
  });
  const hsnGroups = Array.from(hsnMap.values()).sort((a, b) => a.hsn.localeCompare(b.hsn));

  return {
    rows,
    gross,
    discount,
    taxable,
    taxTotal,
    intra,
    grand,
    roundDiff,
    slabs,
    hsnGroups,
    cgst: round2(taxTotal / 2),
    sgst: round2(taxTotal / 2),
    igst: taxTotal,
  };
}
