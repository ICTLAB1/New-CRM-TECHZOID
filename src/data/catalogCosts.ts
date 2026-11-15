import { getDb, hasBackend } from "./backend";
import type { CostMap, ProductCost } from "../domain/catalog/costs";
import type { VendorPrice } from "../domain/catalog/vendors";

/**
 * The catalog's buying prices, as the browser is allowed to see them.
 *
 * THERE IS NO PERMISSION CHECK IN THIS FILE, and there must not be. The
 * policies on `catalog_costs` admit an Admin or a Manager of the company and
 * nobody else (supabase/058_catalog_costs.sql), so a salesperson's select
 * returns no rows — not an error, no rows, which is how row-level security
 * answers. `loadCatalogCosts` therefore comes back empty for them without
 * this module having an opinion about who they are. A UI test of a role is a
 * courtesy to the user; it is never the control, because api/lib/query.mjs
 * lets a browser compose its own query and the database is what decides.
 *
 * WHY THE WHOLE MAP AT ONCE. A catalog is a few thousand products at the
 * outside, the cost picture is two small columns, and the alternative — a
 * request per product as the quote editor picks one — would put the cost on
 * the wire one row at a time while somebody types. One read on load, one
 * write on save.
 */

interface CostRow {
  product_id: string;
  cost: number | string | null;
  vendor_prices: unknown;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const vendors = (v: unknown): VendorPrice[] => (Array.isArray(v) ? (v as VendorPrice[]) : []);

/** Rows to the shape the catalog merges. Exported for its own test. */
export function toCostMap(rows: readonly CostRow[]): CostMap {
  const out: CostMap = {};
  for (const row of rows) {
    const id = String(row.product_id ?? "");
    if (!id) continue;
    out[id] = { cost: num(row.cost), vendorPrices: vendors(row.vendor_prices) };
  }
  return out;
}

/**
 * Every cost this user may see, for one company.
 *
 * Returns {} rather than throwing on a failure. A cost that cannot be
 * loaded leaves the catalog showing no cost, which is a true statement of
 * what the browser knows; an exception here would take down the screens
 * that only ever wanted the product list — the quote editor among them.
 */
export async function loadCatalogCosts(company: string): Promise<CostMap> {
  if (!hasBackend() || !company) return {};
  const { data, error } = await getDb()
    .from("catalog_costs")
    .select("product_id, cost, vendor_prices")
    .eq("company_id", company);
  if (error) return {};
  return toCostMap(((data as CostRow[] | null) ?? []));
}

/** One row as the table takes it. Exported for its own test. */
export function toCostRow(company: string, productId: string, cost: ProductCost) {
  return {
    company_id: company,
    product_id: productId,
    cost: num(cost.cost),
    vendor_prices: vendors(cost.vendorPrices),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Write the cost picture for a catalog that has just been saved.
 *
 * `keep` is every product id still in the catalog, which is not the same as
 * the ids in `costs`: a product whose cost was cleared to zero has no entry
 * in the map and must have its row DELETED, or the old figure would come
 * back on the next load and quietly outlive the edit that removed it.
 * Products that were deleted from the catalog go the same way.
 *
 * Raises on failure, because this one has to be reported: an Admin who
 * edits a cost, sees the screen accept it and finds it reverted tomorrow
 * has been lied to.
 */
export async function saveCatalogCosts(
  company: string,
  costs: CostMap,
  keep: readonly string[],
): Promise<void> {
  if (!hasBackend() || !company) return;
  const db = getDb();
  const entries = Object.entries(costs);

  if (entries.length) {
    const { error } = await db
      .from("catalog_costs")
      .upsert(entries.map(([id, cost]) => toCostRow(company, id, cost)), { onConflict: "company_id,product_id" });
    if (error) throw new Error(error.message ?? "The buying prices could not be saved.");
  }

  /* Everything this company has a row for that the catalog no longer
     carries a cost on. Done as one delete of the complement rather than a
     read-then-diff: two round trips cannot both be true at once, and the
     policy refuses rows that are not this company's anyway. */
  const dead = [...new Set([...keep].filter((id) => id && !costs[id]))];
  if (dead.length) {
    const { error } = await db
      .from("catalog_costs")
      .delete()
      .eq("company_id", company)
      .in("product_id", dead);
    if (error) throw new Error(error.message ?? "A cleared buying price could not be removed.");
  }
}
