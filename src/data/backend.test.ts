import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOrFilter } from "./pgClient";

/**
 * The switch that moves the CRM to Azure, and the parser that goes with it.
 *
 * `backend.ts` decides, from one environment variable, whether every query
 * in this application goes to Supabase or to the Azure API tier. It is worth
 * testing for a reason that is easy to talk past: the failure mode is not an
 * error. A switch that silently stays on Supabase looks exactly like a
 * successful migration — the CRM works, the screens fill, and the Azure
 * database sits there empty while everyone believes they have moved.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Fresh import, because the decision is cached after the first call. */
async function backendWith(apiBase: string | undefined) {
  vi.resetModules();
  if (apiBase === undefined) vi.stubEnv("VITE_API_BASE", "");
  else vi.stubEnv("VITE_API_BASE", apiBase);
  return import("./backend");
}

describe("which backend the CRM talks to", () => {
  it("stays on Supabase when nothing is configured", async () => {
    const { isOnAzure, apiBase } = await backendWith(undefined);
    expect(isOnAzure()).toBe(false);
    expect(apiBase()).toBeNull();
  });

  it("moves to Azure when VITE_API_BASE is set", async () => {
    const { isOnAzure, apiBase } = await backendWith("/api");
    expect(isOnAzure()).toBe(true);
    expect(apiBase()).toBe("/api");
  });

  it("treats whitespace as not configured", async () => {
    /* A variable set to "" or " " in a hosting console is somebody clearing
       it, not somebody pointing at a server called " ". */
    expect((await backendWith("   ")).isOnAzure()).toBe(false);
  });

  it("takes an absolute URL, for an API on another host", async () => {
    const { apiBase } = await backendWith("https://techzoid-fn.azurewebsites.net/api");
    expect(apiBase()).toBe("https://techzoid-fn.azurewebsites.net/api");
  });

  /* -- THE ONE THAT MATTERS ------------------------------------------
     On Azure there is no change feed. `store.ts` takes realtime as a
     separate argument and works without it, falling back to the poll that
     was always underneath — but only if this actually returns nothing.
     Returning a Supabase channel here would have the CRM subscribed to a
     database it is no longer reading from: live updates that never fire,
     for rows that never change. */
  it("offers no change feed on Azure, rather than a stale one", async () => {
    const { getRealtime } = await backendWith("/api");
    expect(getRealtime()).toBeUndefined();
  });

  it("caches the client, and forgets it on request", async () => {
    const mod = await backendWith("/api");
    expect(mod.getDb()).toBe(mod.getDb());
    mod.forgetBackend();
    expect(mod.getDb()).not.toBe(null);
  });

  it("reports a backend whenever either one is configured", async () => {
    /* The guard on every data call used to be `isSupabaseConfigured()`,
       which answers a narrower question and would say no on a deployment
       that has finished leaving Supabase. */
    const { hasBackend } = await backendWith("/api");
    expect(hasBackend()).toBe(true);
  });
});

describe("the or() filter parser", () => {
  it("splits the terms the prospect search sends", () => {
    expect(parseOrFilter("email.ilike.%acme%,company.ilike.%acme%,full_name.ilike.%acme%"))
      .toEqual([
        { col: "email", op: "ilike", value: "%acme%" },
        { col: "company", op: "ilike", value: "%acme%" },
        { col: "full_name", op: "ilike", value: "%acme%" },
      ]);
  });

  /* Split on the FIRST TWO dots only. A value very often contains one — a
     domain, a decimal, a version — and splitting on all of them truncates
     it silently, which shows up as a search that finds nothing. */
  it("keeps dots that belong to the value", () => {
    expect(parseOrFilter("domain.eq.acme.co.uk")).toEqual([
      { col: "domain", op: "eq", value: "acme.co.uk" },
    ]);
    expect(parseOrFilter("email.ilike.%a.b@c.d%")).toEqual([
      { col: "email", op: "ilike", value: "%a.b@c.d%" },
    ]);
  });

  it("ignores empty pieces and surrounding space", () => {
    expect(parseOrFilter(" email.eq.a , , company.eq.b ")).toHaveLength(2);
  });

  it("refuses a term that is not col.op.value", () => {
    expect(() => parseOrFilter("nonsense")).toThrow(/Malformed/);
    expect(() => parseOrFilter("email.ilike")).toThrow(/Malformed/);
    expect(() => parseOrFilter(".eq.x")).toThrow(/Malformed/);
  });

  /* Not a security boundary, and the test says so on purpose: the column
     and the operator are checked against the live catalog on the server and
     the value is bound. A mis-parse produces a rejected query, not a
     dangerous one — so this asserts the shape, not the safety. */
  it("passes a hostile-looking term through as data for the server to refuse", () => {
    expect(parseOrFilter("id; drop table customers.eq.1")).toEqual([
      { col: "id; drop table customers", op: "eq", value: "1" },
    ]);
  });
});
