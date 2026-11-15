import { useEffect, useMemo, useState } from "react";
import { loadCatalogCosts, saveCatalogCosts } from "../data/catalogCosts";
import { mergeCosts, splitCosts, type CostMap } from "../domain/catalog/costs";
import type { CatalogProduct } from "../domain/catalog/types";

/**
 * The catalog with its buying prices, for whoever may have them.
 *
 * The product list comes from the settings row like it always did; the cost
 * figures come from `catalog_costs`, which only an Admin or a Manager may
 * select from. For everybody else the fetch returns no rows and the catalog
 * is handed on with the zeros the settings row carries — see
 * src/domain/catalog/costs.ts for what that looks like on screen.
 *
 * THE LOAD IS NOT GATED ON THE SIGNED-IN ROLE. It could be, and it would
 * save a salesperson one request that comes back empty, but then the rule
 * would be stated in two places and the browser's copy would be the one
 * people read. Row-level security is the rule. This hook asks, and the
 * database answers.
 *
 * `costs` is kept in local state so that an Admin's edit shows the figure
 * they just typed rather than the zero the settings row now holds — the
 * same state the save writes, so the screen and the table cannot disagree
 * without the save having failed, which raises.
 */
export function useCatalogCosts(
  company: string | null,
  base: readonly CatalogProduct[],
): {
  catalog: CatalogProduct[];
  /** Save a whole catalog: the products one way, the costs the other. */
  split: (next: readonly CatalogProduct[]) => { products: CatalogProduct[]; write: () => Promise<void> };
} {
  const [costs, setCosts] = useState<CostMap>({});

  useEffect(() => {
    if (!company) {
      setCosts({});
      return;
    }
    let live = true;
    void loadCatalogCosts(company).then((map) => {
      if (live) setCosts(map);
    });
    return () => {
      live = false;
    };
  }, [company]);

  const catalog = useMemo(() => mergeCosts(base, costs), [base, costs]);

  const split = (next: readonly CatalogProduct[]) => {
    const { catalog: products, costs: nextCosts } = splitCosts(next);
    /* Adopted immediately. The settings write that follows strips the cost
       out of the catalog, and without this the screen would show the figure
       drop to zero for as long as the round trip takes. */
    setCosts(nextCosts);
    const keep = next.map((p) => p.id);
    return {
      products,
      write: () => (company ? saveCatalogCosts(company, nextCosts, keep) : Promise.resolve()),
    };
  };

  return { catalog, split };
}
