import { describe, expect, it } from "vitest";
import { createPgClient, type QuerySpec } from "./pgClient";
import type { DbResult } from "./db";

/**
 * Two things are proved here.
 *
 * First, that the builder composes the query the call site asked for —
 * caught by inspecting the spec that would go over the wire, because a
 * dropped filter is the failure that matters and it is silent: a lost
 * `.eq("company_id", …)` does not throw, it shows one company another
 * company's records.
 *
 * Second, that a builder is immutable. `store.ts` builds a base query and
 * branches it, and if a branch mutated the base the second branch would
 * inherit the first one's filter.
 */

/** Captures the spec instead of sending it. */
function spy() {
  const sent: QuerySpec[] = [];
  const client = createPgClient({
    transport: async (spec) => {
      sent.push(spec);
      return { data: [] as unknown, error: null, count: null } as DbResult<unknown>;
    },
  });
  /* `at` rather than `sent[i]`: with `noUncheckedIndexedAccess` an index
     gives `T | undefined`, and asserting here says once that a missing
     request is a failed test rather than something to optional-chain past. */
  const at = (i: number): QuerySpec => {
    const spec = sent[i];
    if (!spec) throw new Error(`No request ${i} was sent; only ${sent.length}.`);
    return spec;
  };
  return { client, sent, at, last: () => at(sent.length - 1) };
}

describe("the query builder", () => {
  it("composes a select with filters and ordering", async () => {
    const { client, last } = spy();
    await client.from("quotes").select("id, data").eq("company_id", "c1").order("created_at");
    expect(last()).toEqual({
      table: "quotes",
      op: "select",
      select: "id, data",
      filters: [{ col: "company_id", op: "eq", value: "c1" }],
      order: [{ col: "created_at", asc: true }],
    });
  });

  it("defaults a select to every column", async () => {
    const { client, last } = spy();
    await client.from("settings").select();
    expect(last().select).toBe("*");
  });

  it("reads `ascending: false` as descending", async () => {
    const { client, last } = spy();
    await client.from("quotes").select("id").order("created_at", { ascending: false });
    expect(last().order).toEqual([{ col: "created_at", asc: false }]);
  });

  it("keeps several orders in the order they were added", async () => {
    const { client, last } = spy();
    await client.from("quotes").select("id").order("a").order("b", { ascending: false });
    expect(last().order).toEqual([{ col: "a", asc: true }, { col: "b", asc: false }]);
  });

  it("carries every filter, not just the last", async () => {
    const { client, last } = spy();
    await client.from("quotes").select("id").eq("a", 1).eq("b", 2).in("c", [3, 4]);
    expect(last().filters).toEqual([
      { col: "a", op: "eq", value: 1 },
      { col: "b", op: "eq", value: 2 },
      { col: "c", op: "in", value: [3, 4] },
    ]);
  });

  /* ── THE ONE THAT MATTERS ──────────────────────────────────────────
     A shared base query, branched. This is the shape `store.ts` uses to
     decide whether to narrow to a company, and a mutating builder would
     leak the first branch's filter into the second. */
  it("does not let one branch of a query affect another", async () => {
    const { client, at } = spy();
    const base = client.from("customers").select("id, owner_id, data");
    await base.eq("company_id", "c1");
    await base;
    expect(at(0).filters).toEqual([{ col: "company_id", op: "eq", value: "c1" }]);
    expect(at(1).filters).toBeUndefined();
  });

  it("asks for one row with single, and allows none with maybeSingle", async () => {
    const { client, at } = spy();
    await client.from("settings").select("data").eq("id", "main").single();
    await client.from("settings").select("data").eq("id", "main").maybeSingle();
    expect(at(0).single).toBe("one");
    expect(at(1).single).toBe("maybe");
  });

  it("passes limit, range and an exact count through", async () => {
    const { client, at } = spy();
    await client.from("quotes").select("id").limit(5);
    await client.from("quotes").select("id").range(10, 19);
    await client.from("quotes").select("id", { count: "exact" });
    expect(at(0).limit).toBe(5);
    expect(at(1).range).toEqual([10, 19]);
    expect(at(2).count).toBe("exact");
  });

  it("composes the three kinds of write", async () => {
    const { client, at } = spy();
    await client.from("customers").insert({ id: "a" }).select("id");
    await client.from("customers").upsert({ id: "a" }, { onConflict: "email", ignoreDuplicates: true });
    await client.from("customers").update({ data: {} }).eq("id", "a");
    await client.from("customers").delete().eq("id", "a");

    expect(at(0)).toEqual({ table: "customers", op: "insert", values: { id: "a" }, select: "id" });
    expect(at(1)).toEqual({
      table: "customers", op: "upsert", values: { id: "a" },
      onConflict: "email", ignoreDuplicates: true,
    });
    expect(at(2)).toEqual({
      table: "customers", op: "update", values: { data: {} },
      filters: [{ col: "id", op: "eq", value: "a" }],
    });
    expect(at(3)).toEqual({
      table: "customers", op: "delete",
      filters: [{ col: "id", op: "eq", value: "a" }],
    });
  });

  it("leaves a write without select asking for no rows back", async () => {
    const { client, last } = spy();
    await client.from("customers").update({ data: {} }).eq("id", "a");
    expect(last().select).toBeUndefined();
  });
});

describe("failure", () => {
  /* Every call site reads `{ data, error }`. One that threw instead would
     take a screen down where today it shows a message. */
  it("reports a transport failure as an error rather than throwing", async () => {
    const client = createPgClient({
      transport: async () => { throw new Error("the network is out"); },
    });
    const { data, error } = await client.from("quotes").select("id");
    expect(data).toBeNull();
    expect(error?.message).toBe("the network is out");
  });

  it("reports a non-JSON answer with the status the API gave", async () => {
    const client = createPgClient({
      fetch: (async () => ({
        ok: false, status: 502,
        json: async () => { throw new Error("not json"); },
      })) as unknown as typeof fetch,
    });
    const { error } = await client.from("quotes").select("id");
    expect(error?.message).toContain("502");
  });

  it("passes the API's own error through unchanged", async () => {
    const client = createPgClient({
      fetch: (async () => ({
        ok: false, status: 400,
        json: async () => ({ error: { message: "Unknown column on quotes." } }),
      })) as unknown as typeof fetch,
    });
    const { error } = await client.from("quotes").select("nope");
    expect(error?.message).toBe("Unknown column on quotes.");
  });
});

describe("the request", () => {
  it("sends the caller's token and nothing else identifying", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const client = createPgClient({
      endpoint: "/api",
      getToken: () => "token-abc",
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      }) as unknown as typeof fetch,
    });
    await client.from("quotes").select("id");

    expect(seen!.url).toBe("/api/q");
    expect(seen!.init.method).toBe("POST");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer token-abc");
    expect(JSON.parse(String(seen!.init.body))).toEqual({
      table: "quotes", op: "select", select: "id",
    });
  });

  it("sends no authorization header when signed out", async () => {
    let headers: Record<string, string> = {};
    const client = createPgClient({
      getToken: () => null,
      fetch: (async (_url: string, init: RequestInit) => {
        headers = init.headers as Record<string, string>;
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      }) as unknown as typeof fetch,
    });
    await client.from("quotes").select("id");
    expect(headers.authorization).toBeUndefined();
  });

  it("asks for the token per request, so a refreshed one is used", async () => {
    let n = 0;
    const tokens: (string | undefined)[] = [];
    const client = createPgClient({
      getToken: () => `token-${++n}`,
      fetch: (async (_url: string, init: RequestInit) => {
        tokens.push((init.headers as Record<string, string>).authorization);
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      }) as unknown as typeof fetch,
    });
    await client.from("quotes").select("id");
    await client.from("quotes").select("id");
    expect(tokens).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("sends an rpc as a name and its arguments", async () => {
    let body: unknown;
    const client = createPgClient({
      fetch: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return { ok: true, status: 200, json: async () => ({ data: 1001 }) };
      }) as unknown as typeof fetch,
    });
    const { data } = await client.rpc("next_doc_seq", { p_kind: "invoice" });
    expect(body).toEqual({ fn: "next_doc_seq", args: { p_kind: "invoice" } });
    expect(data).toBe(1001);
  });
});
