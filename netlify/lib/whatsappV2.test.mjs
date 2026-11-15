import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./whatsappMeta.mjs", async (orig) => {
  const real = await orig();
  return {
    ...real,
    metaAccount: () => ({ token: "t", wabaId: "w", phoneNumberId: "p" }),
    uploadDocument: vi.fn(async () => ({ ok: true, id: "media-123" })),
    sendTemplate: vi.fn(async () => ({ ok: true, id: "wamid.1", to: "919810012345" })),
  };
});
vi.mock("./whatsappTemplates.mjs", async (orig) => {
  const real = await orig();
  return { ...real, approvedTemplates: vi.fn(async () => ({ ok: true, templates: {} })) };
});

const { uploadDocument, sendTemplate } = await import("./whatsappMeta.mjs");
const { pdfFrom, sendMessage, previewMessage } = await import("./whatsappSender.mjs");

/* ── a stand-in database ────────────────────────────────────────────── */
const DB = { quotes: [], payment_bills: [], customers: [], settings: [], whatsapp_messages: [] };
function makeClient() {
  const from = (table) => {
    const eqs = []; const neqs = [];
    const q = {
      select() { return q; },
      eq(c, v) { eqs.push([c, v]); return q; },
      neq(c, v) { neqs.push([c, v]); return q; },
      gte() { return q; }, order() { return q; }, limit() { return q; },
      _rows() {
        return (DB[table] ?? [])
          .filter((r) => eqs.every(([c, v]) => r[c] === v))
          .filter((r) => neqs.every(([c, v]) => r[c] !== v));
      },
      maybeSingle() { return Promise.resolve({ data: q._rows()[0] ?? null, error: null }); },
      insert(row) {
        const saved = { id: "row-" + (DB[table].length + 1), created_at: new Date().toISOString(), ...row };
        DB[table].push(saved);
        return { select: () => ({ maybeSingle: async () => ({ data: saved, error: null }) }) };
      },
      update(patch) {
        return { eq: async (c, v) => { for (const r of DB[table]) if (r[c] === v) Object.assign(r, patch); return {}; } };
      },
      then(res) { return Promise.resolve({ data: q._rows(), error: null }).then(res); },
    };
    return q;
  };
  return { from };
}

const PDF = { base64: Buffer.from("%PDF-1.4 a quotation").toString("base64") };
const ARGS = {
  companyId: "c1", template: "quotation_sent", recordType: "quote",
  recordId: "q1", customerId: "cu1", manual: true,
};
const FULL_QUOTE = {
  id: "q1", company_id: "c1", customer_id: "cu1",
  data: { number: "TZ/26-27/0311", validUntil: "2026-11-30", items: [{ desc: "AutoCAD", qty: 3 }] },
};

beforeEach(() => {
  DB.quotes = [{ ...FULL_QUOTE }];
  DB.payment_bills = [{
    id: "b1", company_id: "c1", customer_id: "cu1", invoice_no: "TZ/INV/0042",
    customer_name: "Acme", amount: 118000, amount_paid: 118000, due_date: "2026-11-10",
  }];
  DB.customers = [{ id: "cu1", company_id: "c1", data: { contact: "Rahul Verma", phone: "+91 98100 12345", whatsappOptIn: true } }];
  DB.settings = [{ company_id: "c1", data: {} }];
  DB.whatsapp_messages = [];
  uploadDocument.mockClear();
  uploadDocument.mockResolvedValue({ ok: true, id: "media-123" });
  sendTemplate.mockClear();
  sendTemplate.mockResolvedValue({ ok: true, id: "wamid.1", to: "919810012345" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const send = (over = {}) => sendMessage(makeClient(), { ...ARGS, ...over });
const names = () => sendTemplate.mock.calls.map((c) => c[0].templateName);

/* The error Meta gives for a template it does not have, or is still reviewing. */
const notFound = { ok: false, code: 132001, error: "Template name does not exist in the translation" };

describe("the new _v2 template names", () => {
  it("are what every message is sent as", async () => {
    await send({ template: "payment_received", recordType: "bill", recordId: "b1" });
    expect(names()).toEqual(["payment_received_v2"]);
  });

  it("carry exactly the blanks the old ones did, in the same order", async () => {
    await send({ template: "payment_overdue_reminder", recordType: "bill", recordId: "b1", extra: { today: "2026-11-15" } });
    const sent = sendTemplate.mock.calls[0][0];
    expect(sent.templateName).toBe("payment_overdue_reminder_v2");
    expect(sent.values).toEqual(["Rahul Verma", "TZ/INV/0042", "1,18,000", "10 Nov 2026", "5"]);
  });

  it("write the CRM's own name to the log, not Meta's", async () => {
    await send({ template: "payment_received", recordType: "bill", recordId: "b1" });
    const row = DB.whatsapp_messages[0];
    expect(row.template).toBe("payment_received");
    expect(row.meta_template).toBe("payment_received_v2");
  });
});

describe("while the _v2 templates are still in review", () => {
  it("falls back to the old name, once, when Meta has not got the new one", async () => {
    sendTemplate.mockResolvedValueOnce(notFound);
    const out = await send({ template: "payment_received", recordType: "bill", recordId: "b1" });

    expect(out.ok).toBe(true);
    expect(names()).toEqual(["payment_received_v2", "payment_received"]);
    expect(DB.whatsapp_messages[0].meta_template).toBe("payment_received");
  });

  it("does not try a third time when the old one fails too", async () => {
    sendTemplate.mockResolvedValue(notFound);
    const out = await send({ template: "payment_received", recordType: "bill", recordId: "b1" });
    expect(out.ok).toBe(false);
    expect(sendTemplate).toHaveBeenCalledTimes(2);
    expect(DB.whatsapp_messages[0].status).toBe("failed");
  });

  it("DOES NOT fall back for an error that is not a missing template", async () => {
    sendTemplate.mockResolvedValue({ ok: false, code: 131026, error: "Not a WhatsApp user" });
    await send({ template: "payment_received", recordType: "bill", recordId: "b1" });
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("switches over on its own once Meta has it — nothing to edit", async () => {
    sendTemplate.mockResolvedValueOnce(notFound);
    await send({ template: "payment_received", recordType: "bill", recordId: "b1" });
    expect(DB.whatsapp_messages[0].meta_template).toBe("payment_received");

    DB.whatsapp_messages = [];
    sendTemplate.mockClear();
    await send({ template: "payment_received", recordType: "bill", recordId: "b1" });
    expect(DB.whatsapp_messages[0].meta_template).toBe("payment_received_v2");
  });
});

describe("the quotation, which carries the PDF", () => {
  it("uploads it and sends quotation_sent_v2 with a document header", async () => {
    const out = await send({ pdf: pdfFrom(PDF) });
    expect(out.ok).toBe(true);
    expect(uploadDocument.mock.calls[0][0].filename).toBe("Quotation_TZ-26-27-0311.pdf");
    const sent = sendTemplate.mock.calls[0][0];
    expect(sent.templateName).toBe("quotation_sent_v2");
    expect(sent.document).toEqual({ id: "media-123", filename: "Quotation_TZ-26-27-0311.pdf" });
  });

  it("records the attachment in the history", async () => {
    await send({ pdf: pdfFrom(PDF) });
    const row = DB.whatsapp_messages[0];
    expect(row.document_name).toBe("Quotation_TZ-26-27-0311.pdf");
    expect(row.meta_template).toBe("quotation_sent_v2");
  });

  it("falls back to the old text-only template WITHOUT the file", async () => {
    sendTemplate.mockResolvedValueOnce(notFound);
    const out = await send({ pdf: pdfFrom(PDF) });

    expect(out.ok).toBe(true);
    expect(names()).toEqual(["quotation_sent_v2", "quotation_sent"]);
    /* The old template has no header; sending a file to it is refused. */
    expect(sendTemplate.mock.calls[1][0].document).toBeNull();
    /* And the history must not claim an attachment that did not go. */
    expect(DB.whatsapp_messages[0].document_name).toBe("");
  });

  it("uses the old template directly when there is no PDF to attach", async () => {
    const out = await send();
    expect(out.ok).toBe(true);
    expect(names()).toEqual(["quotation_sent"]);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("DOES NOT SEND when the upload fails, and says why in plain English", async () => {
    uploadDocument.mockResolvedValue({ ok: false, error: "That quotation PDF is too large for WhatsApp to accept." });
    const out = await send({ pdf: pdfFrom(PDF) });

    expect(out.ok).toBe(false);
    expect(out.reason).toBe("That quotation PDF is too large for WhatsApp to accept.");
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(DB.whatsapp_messages).toHaveLength(0);
  });

  it("does not upload twice when the same message is asked for again", async () => {
    DB.settings = [{ company_id: "c1", data: { whatsapp: { auto: { quotationSent: true } } } }];
    await send({ pdf: pdfFrom(PDF) });
    const again = await send({ pdf: pdfFrom(PDF), manual: false, trigger: "quotation shared" });
    expect(again.alreadySent).toBe(true);
    expect(uploadDocument).toHaveBeenCalledTimes(1);
  });

  it("is the ONLY message that carries a file — the follow-up never does", async () => {
    /* The follow-up names the day the quotation was shared. */
    DB.quotes = [{ ...FULL_QUOTE, data: { ...FULL_QUOTE.data, date: "2026-11-12" } }];
    await send({ template: "quotation_followup", pdf: pdfFrom(PDF) });
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(sendTemplate.mock.calls[0][0].document).toBeNull();
    expect(names()).toEqual(["quotation_followup_v2"]);
  });
});

describe("a value the record does not have", () => {
  const strip = (field) => {
    const data = { ...FULL_QUOTE.data };
    delete data[field];
    DB.quotes = [{ ...FULL_QUOTE, data }];
  };

  it("SKIPS THE SEND rather than filling the blank with a stand-in", async () => {
    strip("number");
    const out = await send({ pdf: pdfFrom(PDF) });

    expect(out.ok).toBe(false);
    expect(out.reason).toContain("Quotation number");
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("writes the skip into the history, so somebody can see it and fix it", async () => {
    strip("number");
    await send({ pdf: pdfFrom(PDF) });

    const row = DB.whatsapp_messages[0];
    expect(row.status).toBe("failed");
    expect(row.error).toContain("Quotation number");
    expect(row.customer_id).toBe("cu1");
    expect(row.record_id).toBe("q1");
  });

  it("names every missing field, not just the first", async () => {
    DB.quotes = [{ ...FULL_QUOTE, data: {} }];
    const out = await send();
    expect(out.reason).toContain("Quotation number");
    expect(out.reason).toContain("Product");
    expect(out.reason).toContain("Valid till");
  });

  it("a skipped message does not block the real one later", async () => {
    strip("number");
    await send();
    expect(DB.whatsapp_messages[0].status).toBe("failed");

    DB.quotes = [{ ...FULL_QUOTE }];
    const out = await send();
    expect(out.ok).toBe(true);
  });

  it("still sends when every blank has a value", async () => {
    const out = await send({ template: "payment_received", recordType: "bill", recordId: "b1" });
    expect(out.ok).toBe(true);
  });
});

describe("the preview", () => {
  const preview = (over = {}) => previewMessage(makeClient(), { ...ARGS, ...over });

  it("names the file that will be attached, and the template Meta will be asked for", async () => {
    const out = await preview({ pdf: pdfFrom(PDF) });
    expect(out.documentName).toBe("Quotation_TZ-26-27-0311.pdf");
    expect(out.metaTemplate).toBe("quotation_sent_v2");
    expect(out.willNotSend).toBe(false);
  });

  it("warns before anybody presses Send that the record has a hole in it", async () => {
    DB.quotes = [{ ...FULL_QUOTE, data: { number: "TZ/1" } }];
    const out = await preview({ pdf: pdfFrom(PDF) });
    expect(out.willNotSend).toBe(true);
    expect(out.missing).toContain("Product");
  });

  it("says there is no attachment when the PDF could not be built", async () => {
    const out = await preview();
    expect(out.documentName).toBe("");
    expect(out.metaTemplate).toBe("quotation_sent");
  });
});
