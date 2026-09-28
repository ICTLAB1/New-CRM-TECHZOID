import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * `supabaseAsDb.ts` casts the live Supabase client to the narrow `Db` and
 * `DbRealtime` interfaces. This is what makes that cast honest.
 *
 * WHY THIS IS A RUNTIME TEST AND NOT A TYPE ONE. It was a type one first:
 * `type Satisfies<Target, Source extends Target>` pointed at `SupabaseClient`,
 * which does compile, does reject a wrong signature, and did exactly the job
 * — until another file in the same program used up the compiler's
 * instantiation budget on Supabase's generics, and then the same proof
 * stopped compiling for reasons that had nothing to do with it. A check that
 * passes or fails depending on what else is in the build is not a check.
 *
 * WHAT THIS PROVES, EXACTLY. That the client really has every method the CRM
 * calls on it, and that a query builder really is thenable. WHAT IT DOES NOT
 * PROVE: parameter and return types, because those do not exist at runtime.
 * That is a real gap and it is stated rather than papered over — the cover
 * for it is that every call site is separately type-checked against `Db`,
 * so a signature that disagreed would be caught there.
 *
 * No network: `createClient` builds the client without connecting, so these
 * credentials are inert placeholders and reach nothing.
 */

const client = createClient("https://example.supabase.co", "not-a-real-key");

/** Every method `Db` promises. */
const DB_METHODS = ["from", "rpc"] as const;

/** Every method `DbTable` promises. */
const TABLE_METHODS = ["select", "insert", "upsert", "update", "delete"] as const;

/** Every method `DbQuery` promises, plus `then`, which is what lets a call
 *  site await a builder with no terminal method. */
const QUERY_METHODS = [
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in",
  "order", "limit", "range", "single", "maybeSingle", "then",
] as const;

describe("the live client really has the surface it is cast to", () => {
  it.each(DB_METHODS)("Db.%s", (name) => {
    expect(typeof (client as unknown as Record<string, unknown>)[name]).toBe("function");
  });

  it.each(TABLE_METHODS)("DbTable.%s", (name) => {
    const table = client.from("customers") as unknown as Record<string, unknown>;
    expect(typeof table[name]).toBe("function");
  });

  it.each(QUERY_METHODS)("DbQuery.%s", (name) => {
    const query = client.from("customers").select("*") as unknown as Record<string, unknown>;
    expect(typeof query[name]).toBe("function");
  });

  it("DbRealtime.channel, and the three methods used on a channel", () => {
    expect(typeof client.channel).toBe("function");
    const channel = client.channel("proof") as unknown as Record<string, unknown>;
    for (const name of ["on", "subscribe", "unsubscribe"]) {
      expect(typeof channel[name]).toBe("function");
    }
    void client.removeChannel(client.channel("proof"));
  });

  it("a write builder can still ask for rows back", () => {
    const write = client.from("customers").insert({ id: "x" }) as unknown as Record<string, unknown>;
    expect(typeof write.select).toBe("function");
  });
});
