import { afterEach, describe, expect, it, vi } from "vitest";
import { addAttachment, createDraft, listAttachments, MAX_ATTACHMENT_BYTES } from "./mailbox.mjs";

afterEach(() => vi.unstubAllGlobals());

/** Captures the body of the one request made. */
function capture(response = { ok: true, json: async () => ({ id: "draft-1" }) }) {
  const seen = {};
  vi.stubGlobal("fetch", async (url, init) => {
    seen.url = String(url);
    seen.body = init?.body ? JSON.parse(init.body) : null;
    return response;
  });
  return seen;
}

describe("composing a message", () => {
  it("carries Bcc through to Graph", async () => {
    const seen = capture();
    await createDraft("tok", { to: "a@b.com", bcc: "quiet@b.com", subject: "S", body: "B" });
    expect(seen.body.bccRecipients).toEqual([{ emailAddress: { address: "quiet@b.com" } }]);
  });

  it("omits Bcc entirely when there is none, rather than sending an empty list", async () => {
    const seen = capture();
    await createDraft("tok", { to: "a@b.com", subject: "S", body: "B" });
    expect(seen.body).not.toHaveProperty("bccRecipients");
    expect(seen.body).not.toHaveProperty("ccRecipients");
  });

  it("splits several addresses and ignores anything that is not one", async () => {
    const seen = capture();
    await createDraft("tok", { to: "a@b.com, nonsense ; c@d.com", subject: "S", body: "B" });
    expect(seen.body.toRecipients.map((r) => r.emailAddress.address)).toEqual(["a@b.com", "c@d.com"]);
  });

  it("sends the body as text, so brackets and ampersands arrive intact", async () => {
    const seen = capture();
    await createDraft("tok", { to: "a@b.com", subject: "S", body: "5 < 6 & 7 > 6" });
    expect(seen.body.body.contentType).toBe("Text");
    expect(seen.body.body.content).toBe("5 < 6 & 7 > 6");
  });
});

describe("attachments", () => {
  it("refuses a file over the inline limit before sending anything", async () => {
    /* Graph wants an upload session past about 3 MB. Finding that out after
       somebody has written the email is the worst moment to find it out. */
    let called = false;
    vi.stubGlobal("fetch", async () => { called = true; return { ok: true, json: async () => ({}) }; });
    const tooBig = "A".repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 1024) * 4 / 3));
    const got = await addAttachment("tok", "draft-1", { name: "big.pdf", base64: tooBig });
    expect(got.ok).toBe(false);
    expect(got.status).toBe(413);
    expect(got.error).toContain("big.pdf");
    expect(called).toBe(false);
  });

  it("sends a file as a Graph file attachment", async () => {
    const seen = capture({ ok: true, json: async () => ({}) });
    await addAttachment("tok", "draft-1", { name: "quote.pdf", contentType: "application/pdf", base64: "QUJD" });
    expect(seen.body["@odata.type"]).toBe("#microsoft.graph.fileAttachment");
    expect(seen.body.name).toBe("quote.pdf");
    expect(seen.body.contentBytes).toBe("QUJD");
  });

  it("leaves inline images out of the list", async () => {
    /* Signature logos and tracking pixels are attachments as far as Graph is
       concerned. Listing them buries the one file somebody wants. */
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ value: [
        { id: "1", name: "logo.png", isInline: true, size: 900 },
        { id: "2", name: "Quotation.pdf", isInline: false, size: 120000 },
      ] }),
    }));
    const got = await listAttachments("tok", "m1");
    expect(got.attachments.map((a) => a.name)).toEqual(["Quotation.pdf"]);
  });
});
