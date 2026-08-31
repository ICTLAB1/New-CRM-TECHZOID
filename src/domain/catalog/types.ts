export interface CatalogProduct {
  id: string;
  name: string;
  publisher: string;
  licenseType: string;
  productId: string;
  skuId: string;
  termDuration: string;
  billingPlan: string;
  segment: string;
  costPrice: number;
  sellPrice: number;
  /** What this SKU costs from each distributor, and until when. `costPrice`
   *  above is the effective one, kept level with the cheapest live entry —
   *  see vendors.ts. Absent on a catalog imported before this existed. */
  vendorPrices?: import("./vendors").VendorPrice[];
  hsn: string;
  unit: string;
  /** Products with no price stay ACTIVE. Marking them inactive hid them from
   *  the quote picker entirely — a silent disappearance for anyone whose
   *  list quotes price on request. */
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Per-sheet import report. The user must be able to see exactly what
 *  happened to every sheet, especially the ones that contributed nothing. */
export interface SheetStat {
  name: string;
  /** Products harvested from this sheet. */
  count: number;
  /** Data rows the sheet offered, after header detection. */
  totalRows: number;
  /** Set when column names were unrecognised and had to be inferred. */
  inferred: InferredColumns | null;
  /** First few column names seen — shown when a sheet contributes nothing,
   *  so the user can tell us what its columns are actually called. */
  columns: string[];
}

export interface InferredColumns {
  nameKey: string;
  priceKey: string | null;
}

export interface CatalogImportResult {
  products: CatalogProduct[];
  sheetStats: SheetStat[];
}

export type SheetRow = Record<string, unknown>;
