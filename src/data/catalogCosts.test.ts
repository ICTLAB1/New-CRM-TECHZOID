import { describe, expect, it, vi, beforeEach } from "vitest";
import { toCostMap, toCostRow } from "./catalogCosts";
import type { CostMap } from "../domain/catalog/costs";

/* The module talks to the database, so the client is mocked and what is
   asserted is the SHAPE OF THE REQUEST: which table, which filters, and —
   the one that matters — that a cleared cost is deleted rather than left
   behind to come back on the next load. */

const calls: { table: string; op: string; args: unknown[] }[] = [];
let selectResult: { data: unknown; error: unknown } = { data: [], error: null };
let writeError: unknown = null;
let backend = true;

const chain = (table: string) => {
  const record = (op: string, ...args: unknown[]) => {
    calls.push({ table, op, args });
    return api;
  };
  const api: Record<string, (...a: unknown[]) => unknown> = {
    select: (...a) => ({ ...record("select", ...a), eq: (...e: unknown[]) => { record("eq", ...e); return selectResult; } }),
    upsert: (...a) => { record("upsert", ...a); return { error: writeError }; },
    delete: () => record("delete"),
    eq: (...a) => record("eq", ...a),
    in: (...a) => { record("in", ...a); return { error: writeError }; },
  };
  return api;
};

vi.mock("./backend", () => ({
  hasBackend: () => backend,
  getDb: () => ({ from: (table: string) => chain(table) }),
}));

const load = async (company: string) => (await import("./catalogCosts")).loadCatalogCosts(company);
const save = async (company: string, costs: CostMap, keep: string[]) =>
  (await import("./catalogCosts")).saveCatalogCosts(company, costs, keep);

beforeEach(() => {
  calls.length = 0;
  selectResult = { data: [], error: null };
  writeError = null;
  backend = true;
});

describe("reading the costs the database is willing to give", () => {
  it("asks catalog_costs for this company's rows", async () => {
    await load("co1");
    expect(calls.map((c) => [c.table, c.op])).toEqual([
      ["catalog_costs", "select"], ["catalog_costs", "eq"],
    ]);
    expect(calls[1]!.args).toEqual(["company_id", "co1"]);
  });

  it("comes back empty for a salesperson, without an opinion about roles", async () => {
    // Row-level security answers a Sales user with no rows rather than an
    // error. This is the whole mechanism: the module asks the same question
    // for everybody and the database decides.
    selectResult = { data: [], error: null };
    expect(await load("co1")).toEqual({});
  });

  it("comes back empty rather than throwing when the read fails", async () => {
    // A cost that cannot be loaded leaves the catalog showing no cost,
    // which is true. An exception here would break the quote editor, which
    // only ever wanted the product list.
    selectResult = { data: null, error: { message: "permission denied" } };
    expect(await load("co1")).toEqual({});
  });

  it("asks nothing at all with no company or no backend", async () => {
    expect(await load("")).toEqual({});
    backend = false;
    expect(await load("co1")).toEqual({});
    expect(calls).toEqual([]);
  });
});

describe("the row shapes", () => {
  it("keys the map by product id and reads numeric() as a number", () => {
    const map = toCostMap([
      { product_id: "p1", cost: "1826.4000", vendor_prices: [{ vendor: "Ingram" }] },
      { product_id: "p2", cost: 940.5, vendor_prices: null },
    ]);
    expect(map.p1!.cost).toBe(1826.4);
    expect(map.p1!.vendorPrices).toHaveLength(1);
    expect(map.p2!).toEqual({ cost: 940.5, vendorPrices: [] });
  });

  it("drops a row with no product id", () => {
    expect(toCostMap([{ product_id: "", cost: 1, vendor_prices: [] }])).toEqual({});
  });

  it("names the columns the table actually has", () => {
    // These keys are shared with supabase/058_catalog_costs.sql. A rename
    // on one side only writes a cost nothing reads back.
    const row = toCostRow("co1", "p1", { cost: 1826.4, vendorPrices: [] });
    expect(Object.keys(row).sort()).toEqual([
      "company_id", "cost", "product_id", "updated_at", "vendor_prices",
    ]);
    expect(row).toMatchObject({ company_id: "co1", product_id: "p1", cost: 1826.4 });
  });
});

describe("writing them back", () => {
  it("upserts on the company and the product together", async () => {
    await save("co1", { p1: { cost: 1826.4, vendorPrices: [] } }, ["p1"]);
    const upsert = calls.find((c) => c.op === "upsert");
    expect(upsert?.args[1]).toEqual({ onConflict: "company_id,product_id" });
    expect(upsert?.args[0]).toMatchObject([{ company_id: "co1", product_id: "p1", cost: 1826.4 }]);
  });

  it("DELETES the row for a cost that was cleared", async () => {
    // The bug this prevents: an Admin clears a buying price, the catalog
    // saves, and tomorrow the old figure is back because nothing removed
    // the row. p2 is still in the catalog and has no cost any more.
    await save("co1", { p1: { cost: 1826.4, vendorPrices: [] } }, ["p1", "p2"]);
    const del = calls.find((c) => c.op === "in");
    expect(del?.args).toEqual(["product_id", ["p2"]]);
  });

  it("deletes nothing when every product still has its cost", async () => {
    await save("co1", { p1: { cost: 1, vendorPrices: [] } }, ["p1"]);
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("raises when the write is refused, rather than looking saved", async () => {
    writeError = { message: "new row violates row-level security policy" };
    await expect(save("co1", { p1: { cost: 1, vendorPrices: [] } }, ["p1"]))
      .rejects.toThrow("new row violates row-level security policy");
  });

  it("raises when a cleared cost cannot be removed", async () => {
    writeError = { message: "permission denied for table catalog_costs" };
    await expect(save("co1", {}, ["p1"])).rejects.toThrow("permission denied");
  });
});
