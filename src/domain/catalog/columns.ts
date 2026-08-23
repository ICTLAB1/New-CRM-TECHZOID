import type { InferredColumns, SheetRow } from "./types";

/** Header names we recognise for the product-name column. */
export const NAME_HINTS = [
  "skutitle", "product name", "product description", "description",
  "item name", "item", "name", "sku description", "particulars",
] as const;

/** Header names we recognise for the price column. */
export const PRICE_HINTS = [
  "erp price", "erp", "mrp", "sell price", "price", "unit price",
  "rate", "list price", "amount", "unit rate", "selling price",
] as const;

/**
 * Row-key lookup that trims and lowercases both the sheet's actual headers
 * and the candidate names being searched for.
 *
 * Real-world exports routinely carry stray whitespace in headers — TechZoid's
 * own Microsoft CSP pricelist has a price column literally named " ERP Price "
 * with spaces on both sides. An exact-match lookup imports every price as
 * zero rather than erroring, which is worse than a crash.
 */
export function makeRowGetter(row: SheetRow): (...candidates: string[]) => unknown {
  const normalized: Record<string, unknown> = {};
  Object.keys(row).forEach((k) => {
    normalized[k.trim().toLowerCase()] = row[k];
  });
  return (...candidates: string[]): unknown => {
    for (const c of candidates) {
      const v = normalized[c.trim().toLowerCase()];
      if (v !== undefined && v !== "") return v;
    }
    return "";
  };
}

/** Strip currency marks and thousands separators before Number(). */
export function stripMoney(v: unknown): string {
  return String(v ?? "").replace(/[, ₹$]/g, "");
}

/**
 * When a sheet's column names aren't in our known list, infer them from the
 * data itself: the first mostly-text column is the product name, and the
 * numeric column with the largest average is the price — unit prices are
 * typically larger than quantities, tax rates or line numbers.
 *
 * Without this, an unfamiliar vendor layout imports zero rows and the user is
 * left with no idea why.
 */
export function inferColumns(rows: SheetRow[]): InferredColumns | null {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0] ?? {});
  if (!keys.length) return null;

  const sample = rows.slice(0, 40);
  const stats = keys
    .map((k) => {
      let textCount = 0;
      let numCount = 0;
      let numSum = 0;
      let filled = 0;
      sample.forEach((r) => {
        const v = r[k];
        if (v === "" || v === null || v === undefined) return;
        filled++;
        const n = Number(stripMoney(v));
        if (String(v).trim() !== "" && isFinite(n)) {
          numCount++;
          numSum += n;
        } else {
          textCount++;
        }
      });
      return { key: k, textCount, numCount, numSum, filled };
    })
    .filter((s) => s.filled > 0);

  if (!stats.length) return null;

  // Name: the leftmost column that is mostly non-numeric text.
  const nameCol = stats.find((s) => s.textCount > s.numCount && s.textCount > 0);
  // Price: the numeric column with the largest average.
  const numeric = stats.filter((s) => s.numCount > s.textCount && s.numCount > 0);
  numeric.sort((a, b) => b.numSum / Math.max(1, b.numCount) - a.numSum / Math.max(1, a.numCount));
  const priceCol = numeric[0];

  if (!nameCol) return null;
  return { nameKey: nameCol.key, priceKey: priceCol ? priceCol.key : null };
}

/**
 * Find the real header row. Vendor price lists often carry a title row or two
 * above it — that alone was causing whole sheets to import as zero rows.
 *
 * Scans the first 15 rows for one naming both something product-ish and
 * something price-ish; falls back to a row naming only a product column.
 * Returns the row index, or -1 when row 1 is already the header.
 */
export function detectHeaderRow(grid: unknown[][]): number {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const cells = (grid[i] ?? []).map((c) => String(c).trim().toLowerCase()).filter(Boolean);
    if (cells.length < 2) continue;
    const hasName = cells.some((c) => (NAME_HINTS as readonly string[]).includes(c));
    const hasPrice = cells.some((c) => (PRICE_HINTS as readonly string[]).includes(c));
    if (hasName && hasPrice) return i;
    if (headerIdx === -1 && hasName) headerIdx = i; // fallback: a name column alone
  }
  return headerIdx;
}
