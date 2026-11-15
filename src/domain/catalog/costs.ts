import type { CatalogProduct } from "./types";
import type { VendorPrice } from "./vendors";

/**
 * Taking the buying price out of the catalog, and putting it back for the
 * people who are allowed it.
 *
 * WHY THE CATALOG IS IN TWO PIECES NOW. The catalog lives in the settings
 * row, and every member of the company may read that row — it has to be
 * readable, because the letterhead, the numbering and the document template
 * are in it too. So every product carrying `costPrice` and `vendorPrices`
 * meant every salesperson's browser downloading what the company pays each
 * distributor, on every page load. Nothing on screen showed it to them; the
 * API handed it over for the asking, which is the only thing that counts.
 *
 * The cost figures now live in `catalog_costs`, a table only an Admin or a
 * Manager may select from (supabase/058_catalog_costs.sql). The catalog
 * itself did not move. These two functions are the seam: `splitCosts` on
 * the way out, `mergeCosts` on the way back in.
 *
 * WHAT A SALESPERSON SEES AS A RESULT. A product whose cost they are not
 * allowed arrives with `costPrice: 0` and no vendor list, which is what
 * `effectiveCost` already reports as "no current price" — the state of a
 * catalog imported from a spreadsheet with no cost column, which the app
 * has always handled. The margin strip in the quotation editor shows
 * nothing rather than something wrong.
 */

/** One product's cost picture, as the protected table holds it. */
export interface ProductCost {
  cost: number;
  vendorPrices: VendorPrice[];
}

/** Keyed by the catalog product's own id. */
export type CostMap = Record<string, ProductCost>;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const vendors = (v: unknown): VendorPrice[] => (Array.isArray(v) ? (v as VendorPrice[]) : []);

/** Is there anything here worth protecting? */
export function hasCost(c: Pick<ProductCost, "cost" | "vendorPrices">): boolean {
  return num(c.cost) !== 0 || vendors(c.vendorPrices).length > 0;
}

/**
 * The catalog as the settings row should hold it, and the costs to be
 * written separately.
 *
 * `costPrice` is zeroed rather than deleted. Every build in the field reads
 * the key and renders the number; a missing one reads as NaN on a screen
 * somebody is using right now, and a deploy is not instant.
 *
 * Products with no cost on them produce no cost row at all. That is not
 * only tidiness: a row of zeros is indistinguishable from a real zero, and
 * once written it would overwrite the figure a privileged user still had
 * in hand.
 */
export function splitCosts(catalog: readonly CatalogProduct[]): {
  catalog: CatalogProduct[];
  costs: CostMap;
} {
  const costs: CostMap = {};
  const stripped = catalog.map((product) => {
    const { vendorPrices, ...rest } = product;
    const picture: ProductCost = { cost: num(product.costPrice), vendorPrices: vendors(vendorPrices) };
    if (product.id && hasCost(picture)) costs[product.id] = picture;
    return { ...rest, costPrice: 0 } as CatalogProduct;
  });
  return { catalog: stripped, costs };
}

/**
 * The catalog with the costs put back.
 *
 * An empty map is the ordinary case for a salesperson — row-level security
 * returns them no rows, so there is nothing to merge and the catalog is
 * handed back untouched rather than blanked. A product the map has nothing
 * for keeps whatever the settings row said, which after 058 is zero and
 * before it was the real figure; that is what makes this safe to deploy
 * ahead of the migration as well as after it.
 */
export function mergeCosts(catalog: readonly CatalogProduct[], costs: CostMap): CatalogProduct[] {
  if (!catalog.length) return [];
  let touched = false;
  const merged = catalog.map((product) => {
    const found = costs[product.id];
    if (!found) return product;
    touched = true;
    return { ...product, costPrice: num(found.cost), vendorPrices: vendors(found.vendorPrices) };
  });
  /* The same array back when nothing was merged, so the memo above this
     does not hand every screen a new catalog on each render. */
  return touched ? merged : (catalog as CatalogProduct[]);
}
