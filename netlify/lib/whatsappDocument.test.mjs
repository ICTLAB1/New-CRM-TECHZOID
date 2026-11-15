import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendTemplate, uploadDocument } from "./whatsappMeta.mjs";

const PDF = new TextEncoder().encode("%PDF-1.4 pretend quotation");

beforeEach(() => {
  process.env.WHATSAPP_TOKEN = "t";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "100000000000001";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const ok = (body) => async () => new Response(JSON.stringify(body), { status: 200 });
const refused = (body, status = 400) => async () => new Response(JSON.stringify(body), { status });

describe("handing the quotation PDF to WhatsApp", () => {
  it("posts it as multipart, to the media endpoint, and returns the id", async () => {
    let seen = null;
    const fetchImpl = async (url, opts) => {
      seen = { url, opts };
      return new Response(JSON.stringify({ id: "media-123" }), { status: 200 });
    };
    const out = await uploadDocument({ bytes: PDF, filename: "Quotation_TZ-1.pdf" }, { fetchImpl });

    expect(out).toEqual({ ok: true, id: "media-123" });
    expect(seen.url).toBe("https://graph.facebook.com/v25.0/100000000000001/media");
    expect(seen.opts.method).toBe("POST");
    expect(seen.opts.body).toBeInstanceOf(FormData);
    expect(seen.opts.body.get("messaging_product")).toBe("whatsapp");
    expect(seen.opts.body.get("type")).toBe("application/pdf");

    const file = seen.opts.body.get("file");
    expect(file.type).toBe("application/pdf");
    expect(file.size).toBe(PDF.byteLength);
    /* The name the customer sees on the attachment. */
    expect(seen.opts.body.get("file").name).toBe("Quotation_TZ-1.pdf");
  });

  it("NEVER sets its own Content-Type — the boundary comes from the form", async () => {
    let seen = null;
    const fetchImpl = async (url, opts) => { seen = opts; return new Response(JSON.stringify({ id: "m" }), { status: 200 }); };
    await uploadDocument({ bytes: PDF, filename: "q.pdf" }, { fetchImpl });
    const headers = Object.keys(seen.headers).map((k) => k.toLowerCase());
    expect(headers).not.toContain("content-type");
    expect(seen.headers.Authorization).toBe("Bearer t");
  });

  it("refuses an empty PDF rather than uploading nothing", async () => {
    const out = await uploadDocument({ bytes: new Uint8Array(0), filename: "q.pdf" }, { fetchImpl: ok({ id: "m" }) });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("empty");
  });

  it("says plainly when the token is the problem", async () => {
    const out = await uploadDocument(
      { bytes: PDF, filename: "q.pdf" },
      { fetchImpl: refused({ error: { message: "Invalid OAuth token", code: 190 } }, 401) },
    );
    expect(out.ok).toBe(false);
    expect(out.error).toContain("WHATSAPP_TOKEN");
  });

  it("says plainly when the file is too big for Meta", async () => {
    const out = await uploadDocument(
      { bytes: PDF, filename: "q.pdf" },
      { fetchImpl: refused({ error: { message: "File too large" } }, 413) },
    );
    expect(out.error).toContain("too large");
  });

  it("does not claim success when Meta answers without an id", async () => {
    const out = await uploadDocument({ bytes: PDF, filename: "q.pdf" }, { fetchImpl: ok({ ignored: true }) });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("did not say where");
  });

  it("survives the network failing, without throwing", async () => {
    const out = await uploadDocument(
      { bytes: PDF, filename: "q.pdf" },
      { fetchImpl: async () => { throw new Error("socket hang up"); } },
    );
    expect(out.ok).toBe(false);
  });
});

describe("sending the template that carries it", () => {
  const grab = () => {
    let body = null;
    const fetchImpl = async (url, opts) => {
      body = JSON.parse(opts.body);
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    };
    return { fetchImpl, read: () => body };
  };

  it("puts the header first, then the body", async () => {
    const { fetchImpl, read } = grab();
    await sendTemplate({
      to: "919810012345",
      templateName: "quotation_sent_v2",
      values: ["Rahul", "TZ/1", "AutoCAD", "30 Nov 2026"],
      document: { id: "media-123", filename: "Quotation_TZ-1.pdf" },
    }, { fetchImpl });

    const comps = read().template.components;
    expect(comps.map((c) => c.type)).toEqual(["header", "body"]);
    expect(comps[0].parameters[0]).toEqual({
      type: "document",
      document: { id: "media-123", filename: "Quotation_TZ-1.pdf" },
    });
    expect(comps[1].parameters.map((p) => p.text)).toEqual(["Rahul", "TZ/1", "AutoCAD", "30 Nov 2026"]);
  });

  it("sends the same four blanks as the plain version, in the same order", async () => {
    const { fetchImpl, read } = grab();
    const values = ["Rahul", "TZ/1", "AutoCAD", "30 Nov 2026"];
    await sendTemplate({ to: "919810012345", templateName: "quotation_sent", values }, { fetchImpl });
    const plain = read().template.components;
    await sendTemplate({
      to: "919810012345", templateName: "quotation_sent_v2", values,
      document: { id: "m", filename: "q.pdf" },
    }, { fetchImpl });
    const withPdf = read().template.components;

    expect(withPdf.find((c) => c.type === "body")).toEqual(plain.find((c) => c.type === "body"));
  });

  it("SENDS NO HEADER when there is no document — a template without one refuses it", async () => {
    const { fetchImpl, read } = grab();
    await sendTemplate({
      to: "919810012345", templateName: "quotation_sent", values: ["a", "b", "c", "d"],
    }, { fetchImpl });
    expect(read().template.components.map((c) => c.type)).toEqual(["body"]);
  });

  it("ignores a document with no id rather than sending a header that names nothing", async () => {
    const { fetchImpl, read } = grab();
    await sendTemplate({
      to: "919810012345", templateName: "quotation_sent", values: ["a", "b", "c", "d"],
      document: { id: "", filename: "q.pdf" },
    }, { fetchImpl });
    expect(read().template.components.map((c) => c.type)).toEqual(["body"]);
  });

  it("falls back to a sensible filename when none was given", async () => {
    const { fetchImpl, read } = grab();
    await sendTemplate({
      to: "919810012345", templateName: "quotation_sent_v2", values: ["a", "b", "c", "d"],
      document: { id: "m" },
    }, { fetchImpl });
    expect(read().template.components[0].parameters[0].document.filename).toBe("quotation.pdf");
  });
});
