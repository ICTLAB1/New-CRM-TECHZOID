import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every stored function this module calls has to be on the whitelist.
 *
 * WHY THIS TEST EXISTS. The reports shipped calling four functions that
 * were not in CALLABLE, and nothing noticed: the SQL was right, its proof
 * passed, the data layer was right, the screen was right — and the screen
 * said "Unknown function." the first time anybody opened it, because
 * api/lib/rpc.mjs is a whitelist and nobody had added them to it. Found by
 * looking at the running page, which is not a reliable way to find things.
 *
 * Read out of the source rather than by calling anything, so it costs
 * nothing and runs everywhere.
 */
const source = readFileSync("src/data/priceBook.ts", "utf8");
const whitelist = readFileSync("api/lib/rpc.mjs", "utf8");

const called: string[] = [...source.matchAll(/\brpc\(\s*"([a-z0-9_]+)"/g)]
  .map((m) => m[1])
  .filter((n): n is string => !!n);

/** The names in CALLABLE, which is the half a browser may reach. */
function browserCallable(): Set<string> {
  const start = whitelist.indexOf("export const CALLABLE = {");
  const end = whitelist.indexOf("export const SERVER_CALLABLE", start);
  const block = whitelist.slice(start, end);
  return new Set(
    [...block.matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((m) => m[1]).filter((n): n is string => !!n),
  );
}

describe("the price book's stored-function calls", () => {
  it("calls something", () => {
    expect(called.length).toBeGreaterThan(10);
  });

  it("only calls functions a browser is allowed to call", () => {
    const allowed = browserCallable();
    const missing = [...new Set(called)].filter((fn) => !allowed.has(fn)).sort();
    expect(missing, "add these to CALLABLE in api/lib/rpc.mjs, or the screen says \"Unknown function.\"").toEqual([]);
  });
});
