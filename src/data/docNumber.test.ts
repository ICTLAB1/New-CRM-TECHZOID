import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SEQ_KEY, seqKindOf } from "./docNumber";

/* The allocation itself talks to Supabase, so the module is imported fresh
   per test with the client mocked. What matters here is the fallback rule:
   a numbering hiccup must never be why somebody loses a document. */
const rpc = vi.fn();
let configured = true;

vi.mock("./supabase", () => ({
  isSupabaseConfigured: () => configured,
  getSupabase: () => ({ rpc }),
}));

async function alloc(kind: "quote", fallback: number): Promise<number> {
  const { nextDocSeq } = await import("./docNumber");
  return nextDocSeq(kind, fallback);
}

beforeEach(() => {
  rpc.mockReset();
  configured = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("which counter a document type uses", () => {
  it("maps every screen's document type to a counter", () => {
    expect(seqKindOf("quotation")).toBe("quote");
    expect(seqKindOf("proforma")).toBe("proforma");
    expect(seqKindOf("purchase_order")).toBe("purchaseOrder");
    expect(seqKindOf("invoice")).toBe("invoice");
    // Anything unrecognised is a quotation, which is what the screen
    // defaults to elsewhere.
    expect(seqKindOf("something-else")).toBe("quote");
  });

  it("names the settings key each counter lives under", () => {
    // These strings are shared with the SQL in migration 018. Renaming one
    // here without renaming it there hands out numbers from a counter
    // nothing else reads.
    expect(SEQ_KEY.quote).toBe("quoteSeq");
    expect(SEQ_KEY.invoice).toBe("invoiceSeq");
    expect(SEQ_KEY.purchaseOrder).toBe("purchaseOrderSeq");
    expect(SEQ_KEY.dispatch).toBe("dispatchSeq");
  });
});

describe("allocating a number", () => {
  it("uses what the database hands back", async () => {
    rpc.mockResolvedValue({ data: 42, error: null });
    expect(await alloc("quote", 7)).toBe(42);
    expect(rpc).toHaveBeenCalledWith("next_doc_seq", { p_kind: "quote" });
  });

  it("falls back to the local counter when there is no database", async () => {
    configured = false;
    expect(await alloc("quote", 7)).toBe(7);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("falls back when the function is missing", async () => {
    // Migration 018 not applied yet. The old behaviour, which is wrong
    // under contention but does not lose the document.
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    expect(await alloc("quote", 7)).toBe(7);
  });

  it("falls back when there is no settings row to advance", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await alloc("quote", 7)).toBe(7);
  });

  it("falls back when the call throws outright", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    expect(await alloc("quote", 7)).toBe(7);
  });

  it("never hands out a number below one", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    expect(await alloc("quote", 7)).toBe(7);
    rpc.mockResolvedValue({ data: -3, error: null });
    expect(await alloc("quote", 7)).toBe(7);
  });

  it("makes sense of a fallback that is missing or nonsense", async () => {
    configured = false;
    expect(await alloc("quote", 0)).toBe(1);
    expect(await alloc("quote", Number.NaN)).toBe(1);
  });
});
