import * as XLSX from "xlsx";
import { round2 } from "../money";
import { detectHeaderRow, inferColumns, makeRowGetter, stripMoney } from "./columns";
import type { CatalogImportResult, CatalogProduct, InferredColumns, SheetRow, SheetStat } from "./types";

export const CATALOG_TERM_LABELS: Readonly<Record<string, string>> = {
  P1M: "Monthly",
  P1Y: "1 Year",
  P2Y: "2 Years",
  P3Y: "3 Years",
  OneTime: "One-Time",
};

export const CATALOG_VENDORS = [
  "Microsoft", "Adobe", "Autodesk", "Kaspersky", "Dell", "HP", "Cisco", "VMware", "Other",
] as const;

const uid = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Rows of a sheet, with the header row located first. */
function sheetRowsWithHeaderDetection(ws: XLSX.WorkSheet): SheetRow[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const headerIdx = detectHeaderRow(grid);
  if (headerIdx <= 0) return XLSX.utils.sheet_to_json<SheetRow>(ws, { defval: "" });
  return XLSX.utils.sheet_to_json<SheetRow>(ws, { defval: "", range: headerIdx });
}

/**
 * Parse a multi-sheet product/price-list workbook into catalog products.
 *
 * Two rules this must never break:
 *   1. Column matching is GENEROUS — known names matched case-insensitively
 *      and whitespace-trimmed, then inferred from the data when nothing
 *      matches. A sheet must not silently contribute zero rows.
 *   2. Every sheet reports back — rows found, columns guessed, columns seen —
 *      so a sheet that yields nothing says so, with the header names it saw.
 *
 * `vendorOverride` always wins over a Publisher column: a Microsoft CSP export
 * has one, an Adobe or Kaspersky list often doesn't, and defaulting those to
 * "Microsoft" would mislabel the whole file.
 */
export function parseProductCatalogWorkbook(
  wb: XLSX.WorkBook,
  vendorOverride?: string | null,
): CatalogImportResult {
  const products: CatalogProduct[] = [];
  const sheetStats: SheetStat[] = [];

  wb.SheetNames.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const rows = sheetRowsWithHeaderDetection(ws);
    let count = 0;
    let inferred: InferredColumns | null | false = null;
    let usedInference = false;

    rows.forEach((row) => {
      const get = makeRowGetter(row);
      let name = get(
        "SkuTitle", "Product Name", "Product Description", "Description",
        "Item Name", "Item", "Name", "SKU Description", "Particulars",
      );
      /* DEVIATION FROM v1 (deliberate): v1 passed this straight to round2(),
         which is Number() underneath — so a price written "₹1,25,000" under a
         perfectly well-known header imported as 0, silently. Currency marks
         and separators are stripped on this path too, exactly as they already
         were on the inference path below. */
      let sellPrice = round2(
        stripMoney(
          get("ERP Price", "ERP", "MRP", "Sell Price", "Selling Price", "Price",
              "Unit Price", "Rate", "Unit Rate", "List Price", "Amount"),
        ),
      );

      // Nothing matched by name — infer this sheet's columns once, then reuse.
      if (!name) {
        if (inferred === null) inferred = inferColumns(rows) || false;
        if (inferred) {
          name = row[inferred.nameKey];
          if (inferred.priceKey) sellPrice = round2(stripMoney(row[inferred.priceKey]));
          usedInference = true;
        }
      }
      if (!name || !String(name).trim()) return;

      const costPrice = round2(
        stripMoney(
          get("Unit SELL Price", "Cost Price", "Cost", "Unit Sell Price", "Purchase Price", "Buy Price"),
        ),
      );

      products.push({
        id: uid(),
        name: String(name).trim(),
        publisher: (vendorOverride || String(get("Publisher", "Vendor", "Brand", "Make") || "Microsoft")).trim(),
        licenseType: sheetName,
        productId: String(get("ProductId", "Product Id", "Product Code") || "").trim(),
        skuId: String(get("SkuId", "SKU", "Sku Id", "Part No", "Part Number", "Model") || "").trim(),
        termDuration:
          CATALOG_TERM_LABELS[String(get("TermDuration"))] ||
          String(get("TermDuration", "Term") || "").trim(),
        billingPlan: String(get("BillingPlan", "Billing Plan") || "").trim(),
        segment: String(get("Segment") || "Commercial").trim(),
        costPrice,
        sellPrice,
        hsn: String(get("HSN", "HSN/SAC", "HSN Code", "SAC") || "997331").trim(),
        unit: String(get("Unit", "UOM") || "License").trim(),
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      count++;
    });

    sheetStats.push({
      name: sheetName,
      count,
      totalRows: rows.length,
      inferred: usedInference && inferred ? inferred : null,
      columns: (rows.length ? Object.keys(rows[0] ?? {}) : []).slice(0, 8),
    });
  });

  return { products, sheetStats };
}

/**
 * Merge an import into the existing catalog.
 *
 * "merge" (the default) replaces only the imported vendor's products and
 * keeps every other vendor's list intact. A straight replace silently wiped
 * the entire catalog once — so "replace" must stay an explicit choice.
 */
export function mergeCatalog(
  existing: readonly CatalogProduct[],
  imported: readonly CatalogProduct[],
  mode: "merge" | "replace",
  vendor?: string | null,
): CatalogProduct[] {
  if (mode === "replace") return [...imported];
  const vendors = new Set(
    (vendor ? [vendor] : imported.map((p) => p.publisher)).map((v) => v.trim().toLowerCase()),
  );
  const kept = existing.filter((p) => !vendors.has((p.publisher || "").trim().toLowerCase()));
  return [...kept, ...imported];
}
