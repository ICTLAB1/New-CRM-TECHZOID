import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendMedia, uploadMedia } from "./whatsappMeta.mjs";

/**
 * The message Meta actually receives when a file goes with a reply.
 *
 * These assert the PAYLOAD, not that a function was called. Meta refuses a
 * message carrying a field its type does not declare — the same rule that
 * governs a template's header — so the shape is the thing that works or
 * does not, and a mock that only counts calls would pass either way.
 */

const BYTES = new TextEncoder().encode("pretend file");

beforeEach(() => {
  process.env.WHATSAPP_TOKEN = "t";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "100000000000001";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Captures what was posted, and answers as Meta does. */
const capture = () => {
  const seen = {};
  const fetchImpl = async (url, opts) => {
    seen.url = url;
    seen.opts = opts;
    seen.body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }], contacts: [{ wa_id: "919810012345" }] }), { status: 200 });
  };
  return { seen, fetchImpl };
};

describe("sending a document", () => {
  it("posts a document message carrying the id, the name and the caption", async () => {
    const { seen, fetchImpl } = capture();
    const out = await sendMedia({
      to: "919810012345", kind: "document", mediaId: "media-9",
      filename: "Price list.pdf", caption: "Here you go",
    }, { fetchImpl });

    expect(out.ok).toBe(true);
    expect(seen.body.type).toBe("document");
    expect(seen.body.document).toEqual({
      id: "media-9", caption: "Here you go", filename: "Price list.pdf",
    });
    /* No stray `text` component beside it: that is a second message's
       field and Meta refuses the whole thing. */
    expect(seen.body.text).toBeUndefined();
  });

  it("leaves the caption out entirely when there are no words", async () => {
    const { seen, fetchImpl } = capture();
    await sendMedia({ to: "919810012345", kind: "document", mediaId: "m", filename: "a.pdf" }, { fetchImpl });
    expect("caption" in seen.body.document).toBe(false);
  });

  it("does not send whitespace as a caption", async () => {
    const { seen, fetchImpl } = capture();
    await sendMedia({ to: "919810012345", kind: "document", mediaId: "m", filename: "a.pdf", caption: "   " }, { fetchImpl });
    expect("caption" in seen.body.document).toBe(false);
  });
});

describe("sending an image", () => {
  it("posts an image message and NO filename", async () => {
    /* Meta's image message has no filename field. Sending one is a
       refusal of the whole message, and the customer gets nothing. */
    const { seen, fetchImpl } = capture();
    await sendMedia({
      to: "919810012345", kind: "image", mediaId: "media-7",
      filename: "rack.png", caption: "The rack as it stands",
    }, { fetchImpl });

    expect(seen.body.type).toBe("image");
    expect(seen.body.image).toEqual({ id: "media-7", caption: "The rack as it stands" });
    expect("filename" in seen.body.image).toBe(false);
    expect(seen.body.document).toBeUndefined();
  });
});

describe("what it refuses before troubling Meta", () => {
  const never = async () => { throw new Error("should not have been called"); };

  it("refuses a number that is not sendable", async () => {
    const out = await sendMedia({ to: "12345", kind: "document", mediaId: "m" }, { fetchImpl: never });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("WhatsApp number");
  });

  it("refuses a kind WhatsApp has no message for", async () => {
    const out = await sendMedia({ to: "919810012345", kind: "spreadsheet", mediaId: "m" }, { fetchImpl: never });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("spreadsheet");
  });

  it("refuses when nothing was uploaded", async () => {
    const out = await sendMedia({ to: "919810012345", kind: "document", mediaId: "" }, { fetchImpl: never });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("not uploaded");
  });
});

describe("uploading something that is not a quotation", () => {
  it("tells Meta the type it was given, not application/pdf", async () => {
    let seenType = null;
    const fetchImpl = async (_url, opts) => {
      seenType = opts.body.get("type");
      return new Response(JSON.stringify({ id: "media-5" }), { status: 200 });
    };
    const out = await uploadMedia({ bytes: BYTES, filename: "rack.png", mimeType: "image/png" }, { fetchImpl });
    expect(out).toEqual({ ok: true, id: "media-5" });
    expect(seenType).toBe("image/png");
  });

  it("says 'file' rather than 'quotation PDF' when it was not one", async () => {
    /* The wording of the quotation path is kept for the quotation path.
       A person attaching a spreadsheet should not be told their
       quotation PDF was empty. */
    const out = await uploadMedia({ bytes: new Uint8Array(0), filename: "a.xlsx", mimeType: "text/csv" }, { fetchImpl: async () => new Response("{}", { status: 200 }) });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("file came through empty");
    expect(out.error).not.toContain("quotation");
  });

  it("still says 'quotation PDF' for the quotation path", async () => {
    const out = await uploadMedia({ bytes: new Uint8Array(0), filename: "q.pdf", mimeType: "application/pdf" }, { fetchImpl: async () => new Response("{}", { status: 200 }) });
    expect(out.error).toContain("quotation PDF came through empty");
  });
});
