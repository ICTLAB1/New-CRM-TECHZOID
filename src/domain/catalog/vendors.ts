import type { CatalogProduct } from "./types";

/**
 * What a product costs, from whom.
 *
 * ONE COST PRICE WAS NEVER TRUE. The same SKU comes from several
 * distributors at different prices, those prices are quoted for a period
 * and then expire, and which one you can actually get today is the whole
 * job. A single `costPrice` field can only ever hold one of those, and
 * quoting off a stale one is how a deal is won at a loss.
 *
 * `costPrice` stays, and stays meaningful: it is the effective cost, kept
 * in step with the best live vendor price so that every existing screen and
 * every saved document reads the same as it did.
 */

export interface VendorPrice {
  id: string;
  /** The distributor — Ingram, Redington, direct from the OEM. */
  vendor: string;
  cost: number;
  /** Distributors quote in dollars more often than anyone expects. */
  currency: string;
  /** Price lists expire. A quotation built on last quarter's list is a
   *  quotation you cannot honour. */
  validUntil: string;
  /** "Deal reg price", "Q3 promo", "list". */
  note: string;
}

const uid = (): string => "vp_" + Math.random().toString(36).slice(2, 9);

export const blankVendorPrice = (): VendorPrice => ({
  id: uid(), vendor: "", cost: 0, currency: "INR", validUntil: "", note: "",
});

export const readVendorPrices = (p: Pick<CatalogProduct, "vendorPrices">): VendorPrice[] =>
  (p.vendorPrices ?? []).map((v) => ({ ...blankVendorPrice(), ...v }));

/** Expired, on the day being asked about. An empty date never expires — a
 *  standing price with no stated end is ordinary. */
export function isExpired(price: Pick<VendorPrice, "validUntil">, today: string): boolean {
  const until = (price.validUntil ?? "").trim();
  return !!until && until < today;
}

/**
 * The cheapest price still valid today.
 *
 * Expired prices are skipped rather than silently used — that is the whole
 * point of recording the date. Returns null when nothing is live, which the
 * caller reports as "no current price" rather than as free.
 */
export function bestPrice(prices: readonly VendorPrice[], today: string): VendorPrice | null {
  const live = prices.filter((p) => Number(p.cost) > 0 && !isExpired(p, today));
  if (!live.length) return null;
  return live.reduce((cheapest, p) => (Number(p.cost) < Number(cheapest.cost) ? p : cheapest));
}

/**
 * What this product costs today, and where that number came from.
 *
 * Falls back to the product's own `costPrice` when no vendor price is live,
 * because a catalog imported from a spreadsheet has one and nothing else.
 */
export function effectiveCost(
  product: Pick<CatalogProduct, "costPrice" | "vendorPrices">,
  today: string,
): { cost: number; source: string; expired: boolean } {
  const prices = readVendorPrices(product);
  const best = bestPrice(prices, today);
  if (best) return { cost: Number(best.cost) || 0, source: best.vendor || "a vendor", expired: false };

  /* Nothing live. If there were prices and they have all lapsed, say so —
     the number being used is out of date and somebody should refresh the
     list before quoting off it. */
  const hadPrices = prices.some((p) => Number(p.cost) > 0);
  return {
    cost: Number(product.costPrice) || 0,
    source: hadPrices ? "an expired price list" : "the catalog",
    expired: hadPrices,
  };
}

/** Keep `costPrice` level with the best live vendor price, so every screen
 *  that reads it — and every one written before vendor lists existed —
 *  keeps agreeing with this. */
export function withEffectiveCost(product: CatalogProduct, today: string): CatalogProduct {
  const { cost } = effectiveCost(product, today);
  return cost > 0 ? { ...product, costPrice: cost } : product;
}

/** Every distributor named anywhere in the catalog, for a picker. */
export function vendorsInCatalog(products: readonly CatalogProduct[]): string[] {
  const seen = new Set<string>();
  for (const p of products) {
    for (const v of readVendorPrices(p)) {
      const name = (v.vendor ?? "").trim();
      if (name) seen.add(name);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
