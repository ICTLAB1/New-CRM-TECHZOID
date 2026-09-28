import { describe, expect, it } from "vitest";
import { createBlobStore } from "./blobStore";
import { StorageError } from "./storage";

/**
 * Uploading, opening and deleting attachments against Azure Blob Storage.
 *
 * Nothing here is a security test, and saying so is the point: the browser
 * can ask `/api/blob` for any path it likes, and the endpoint decides by
 * looking the attachment row up as the caller. Those tests live in
 * `api/lib/blob.test.mjs`, against the real policies. What matters HERE is
 * the wire protocol — a PUT that Azure rejects for a missing header is a
 * file the user watched fail to upload for no visible reason.
 */

/** Records every request and answers from a script. */
function net(script: ((url: string, init: RequestInit) => unknown)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    if (!step) throw new Error("the fetch script ran out of steps");
    return step(url, init);
  }) as unknown as typeof fetch;
  return { calls, doFetch };
}

const signOk = () => ({
  ok: true, status: 200,
  json: async () => ({ url: "https://acct.blob.core.windows.net/attachments/p?sig=x", expiresInSeconds: 300 }),
});
const putOk = () => ({ ok: true, status: 201, json: async () => ({}) });

const file = () => new File(["hello"], "contract.pdf", { type: "application/pdf" });

describe("uploading", () => {
  it("asks the API to sign, then sends the bytes straight to Azure", async () => {
    /* The bytes do not go through the Function. A 20MB contract uploaded
       through it would be 20MB in and 20MB out, billed by the second, for
       no benefit — the permission decision is the part that needs a server
       and it is the only part that goes there. */
    const { calls, doFetch } = net([signOk, putOk]);
    const store = createBlobStore("/api", () => "token-1", doFetch);
    await store.upload("u1/quotation/q1/abc-contract.pdf", file(), "application/pdf");

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("/api/blob");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      op: "write", path: "u1/quotation/q1/abc-contract.pdf",
    });
    expect(calls[1]!.url).toContain("blob.core.windows.net");
  });

  /* -- THE ONE THAT MATTERS ------------------------------------------
     Azure rejects every block-blob PUT that does not carry this header.
     It is not a default and there is no fallback: without it, uploads fail
     with a 400 that says nothing a user could act on. */
  it("sends x-ms-blob-type, which Azure requires", async () => {
    const { calls, doFetch } = net([signOk, putOk]);
    const store = createBlobStore("/api", () => "t", doFetch);
    await store.upload("u1/q/1/a.pdf", file(), "application/pdf");

    const headers = calls[1]!.init.headers as Record<string, string>;
    expect(headers["x-ms-blob-type"]).toBe("BlockBlob");
    expect(headers["content-type"]).toBe("application/pdf");
    expect(calls[1]!.init.method).toBe("PUT");
  });

  it("explains a collision rather than reporting a number", async () => {
    /* 409 is the create-only permission working: something is already
       there. The path carries a unique segment, so that means somebody
       else's file, not a retry of this one. */
    const { doFetch } = net([signOk, () => ({ ok: false, status: 409, json: async () => ({}) })]);
    const store = createBlobStore("/api", () => "t", doFetch);
    await expect(store.upload("u1/q/1/a.pdf", file(), "application/pdf"))
      .rejects.toThrow(/already exists/);
  });

  it("does not send bytes anywhere when the API refuses to sign", async () => {
    const { calls, doFetch } = net([
      () => ({ ok: false, status: 403, json: async () => ({ error: { message: "You can only upload into your own folder." } }) }),
    ]);
    const store = createBlobStore("/api", () => "t", doFetch);
    await expect(store.upload("someone-else/q/1/a.pdf", file(), "application/pdf"))
      .rejects.toThrow(/your own folder/);
    expect(calls).toHaveLength(1);
  });
});

describe("opening", () => {
  it("returns the signed URL the API issued", async () => {
    const { calls, doFetch } = net([signOk]);
    const store = createBlobStore("/api", () => "t", doFetch);
    const url = await store.signedUrl("u1/q/1/a.pdf", 300);

    expect(url).toContain("sig=");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ op: "read", path: "u1/q/1/a.pdf" });
  });

  it("does not let the caller choose how long the link lasts", async () => {
    /* A browser that could ask for a week-long link would be a browser that
       could mint one. The argument exists for interface compatibility with
       the Supabase store and is deliberately not sent. */
    const { calls, doFetch } = net([signOk]);
    const store = createBlobStore("/api", () => "t", doFetch);
    await store.signedUrl("u1/q/1/a.pdf", 60 * 60 * 24 * 7);
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty("seconds");
  });

  it("passes the API's own refusal through", async () => {
    const { doFetch } = net([
      () => ({ ok: false, status: 404, json: async () => ({ error: { message: "No such attachment." } }) }),
    ]);
    const store = createBlobStore("/api", () => "t", doFetch);
    await expect(store.signedUrl("u1/q/1/a.pdf", 300)).rejects.toThrow("No such attachment.");
  });

  it("reports a non-JSON answer with the status", async () => {
    const { doFetch } = net([() => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } })]);
    const store = createBlobStore("/api", () => "t", doFetch);
    await expect(store.signedUrl("p", 300)).rejects.toThrow(/502/);
  });
});

describe("deleting", () => {
  it("sends every path in one request", async () => {
    const { calls, doFetch } = net([() => ({ ok: true, status: 200, json: async () => ({ removed: ["a", "b"] }) })]);
    const store = createBlobStore("/api", () => "t", doFetch);
    await store.remove(["a", "b"]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ op: "delete", paths: ["a", "b"] });
  });

  it("does nothing at all for an empty list", async () => {
    const { calls, doFetch } = net([signOk]);
    const store = createBlobStore("/api", () => "t", doFetch);
    await store.remove([]);
    expect(calls).toHaveLength(0);
  });
});

describe("signed out", () => {
  it("refuses before touching the network", async () => {
    /* There is no such thing as a public attachment, so a caller with no
       token has nothing to ask for. */
    const { calls, doFetch } = net([signOk]);
    const store = createBlobStore("/api", () => null, doFetch);
    await expect(store.signedUrl("p", 300)).rejects.toThrow(StorageError);
    expect(calls).toHaveLength(0);
  });
});
