import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { looksSendable, markRead, metaConfigured, sendTemplate, sendText, waNumber } from "./whatsappMeta.mjs";

/**
 * The transport, against a stand-in for Meta.
 *
 * What matters here is the shape of the request — a wrong `type`, a missing
 * `messaging_product` or a number without its country code is a message
 * that never arrives, with nothing on any screen to say so.
 */

let calls = [];
let reply = { ok: true, body: { messages: [{ id: "wamid.TEST" }], contacts: [{ wa_id: "919810012345" }] } };

const fetchImpl = async (url, opts) => {
  calls.push({ url, opts, body: JSON.parse(opts.body) });
  return { ok: reply.ok, json: async () => reply.body };
};

const ENV = { ...process.env };

beforeEach(() => {
  calls = [];
  reply = { ok: true, body: { messages: [{ id: "wamid.TEST" }], contacts: [{ wa_id: "919810012345" }] } };
  process.env.WHATSAPP_TOKEN = "EAAG-test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
  process.env.WHATSAPP_WABA_ID = "987654321";
});

afterEach(() => {
  process.env = { ...ENV };
});

describe("the number, before anything is sent", () => {
  it("makes 91XXXXXXXXXX out of what people actually type", () => {
    for (const typed of ["9810012345", "09810012345", "+91 98100 12345", "91-9810012345", "+919810012345"]) {
      expect(waNumber(typed)).toBe("919810012345");
    }
  });

  it("leaves a number that already has another country code alone", () => {
    expect(waNumber("+971 50 123 4567")).toBe("971501234567");
  });

  it("knows what cannot be sent to", () => {
    expect(looksSendable("98100")).toBe(false);
    expect(looksSendable("")).toBe(false);
    expect(looksSendable("9810012345")).toBe(true);
  });

  it("refuses rather than posting a half-number", async () => {
    const out = await sendTemplate({ to: "98100", templateName: "quotation_sent", values: ["a"] }, { fetchImpl });
    expect(out.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("sending an approved template", () => {
  it("posts to the phone number id, with the token in the header", async () => {
    await sendTemplate({ to: "9810012345", templateName: "quotation_sent", values: ["a", "b", "c", "d"] }, { fetchImpl });
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/123456789/messages");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer EAAG-test-token");
  });

  it("sends the blanks in the order they were given", async () => {
    await sendTemplate(
      { to: "9810012345", templateName: "payment_overdue_reminder", values: ["Acme", "INV/42", "1,18,000", "15 Nov 2026", "8"] },
      { fetchImpl },
    );
    const body = calls[0].body;
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("payment_overdue_reminder");
    expect(body.template.language).toEqual({ code: "en" });
    expect(body.template.components[0].parameters.map((p) => p.text))
      .toEqual(["Acme", "INV/42", "1,18,000", "15 Nov 2026", "8"]);
    expect(body.template.components[0].parameters.every((p) => p.type === "text")).toBe(true);
  });

  it("sends the number with its country code and nothing else", async () => {
    await sendTemplate({ to: "+91 98100 12345", templateName: "quotation_sent", values: ["a"] }, { fetchImpl });
    expect(calls[0].body.to).toBe("919810012345");
  });

  it("records the id Meta gave it, and where it really went", async () => {
    const out = await sendTemplate({ to: "9810012345", templateName: "quotation_sent", values: ["a"] }, { fetchImpl });
    expect(out).toMatchObject({ ok: true, id: "wamid.TEST", to: "919810012345" });
  });

  it("sends no body component when a template takes no blanks", async () => {
    await sendTemplate({ to: "9810012345", templateName: "x", values: [] }, { fetchImpl });
    expect(calls[0].body.template.components).toEqual([]);
  });
});

describe("free text, which only works inside the window", () => {
  it("posts a text message", async () => {
    await sendText({ to: "9810012345", body: "Thanks, sending that across now." }, { fetchImpl });
    expect(calls[0].body.type).toBe("text");
    expect(calls[0].body.text.body).toBe("Thanks, sending that across now.");
    expect(calls[0].body.text.preview_url).toBe(false);
  });

  it("refuses an empty one and an enormous one", async () => {
    expect((await sendText({ to: "9810012345", body: "   " }, { fetchImpl })).ok).toBe(false);
    expect((await sendText({ to: "9810012345", body: "x".repeat(5000) }, { fetchImpl })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("explains the closed window in words, not a code", async () => {
    reply = { ok: false, body: { error: { code: 131047, message: "Re-engagement message" } } };
    const out = await sendText({ to: "9810012345", body: "hello" }, { fetchImpl });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/24 hours/);
    expect(out.error).not.toMatch(/131047/);
  });
});

describe("marking a customer's message read", () => {
  it("sends the read receipt for that message", async () => {
    await markRead({ messageId: "wamid.IN" }, { fetchImpl });
    expect(calls[0].body).toMatchObject({ status: "read", message_id: "wamid.IN" });
  });
});

describe("when Meta says no", () => {
  const refuse = (error) => { reply = { ok: false, body: { error } }; };

  it("names the token when the token is the problem", async () => {
    refuse({ code: 190, message: "Error validating access token" });
    const out = await sendTemplate({ to: "9810012345", templateName: "t", values: ["a"] }, { fetchImpl });
    expect(out.error).toContain("WHATSAPP_TOKEN");
    expect(out.error).toMatch(/expires after 24 hours/);
  });

  it("points at the templates when the template is the problem", async () => {
    refuse({ code: 132001, message: "Template name does not exist in the translation" });
    const out = await sendTemplate({ to: "9810012345", templateName: "t", values: ["a"] }, { fetchImpl });
    expect(out.error).toMatch(/Settings → WhatsApp/);
  });

  it("says plainly that a number is not on WhatsApp", async () => {
    refuse({ code: 131026, message: "Message undeliverable" });
    expect((await sendText({ to: "9810012345", body: "hi" }, { fetchImpl })).error).toMatch(/not on WhatsApp/);
  });

  it("explains a rate limit as temporary, and marks it worth retrying", async () => {
    refuse({ code: 131056, message: "Too many messages" });
    const out = await sendTemplate({ to: "9810012345", templateName: "t", values: ["a"] }, { fetchImpl });
    expect(out.error).toMatch(/rate-limiting/);
    expect(out.retryable).toBe(true);
  });

  it("does not mark a refusal on its merits as retryable", async () => {
    refuse({ code: 131026, message: "Message undeliverable" });
    const out = await sendTemplate({ to: "9810012345", templateName: "t", values: ["a"] }, { fetchImpl });
    expect(out.retryable).toBe(false);
  });

  it("treats a dropped connection as worth retrying, and sends nothing twice", async () => {
    const out = await sendTemplate(
      { to: "9810012345", templateName: "t", values: ["a"] },
      { fetchImpl: async () => { throw new Error("socket hang up"); } },
    );
    expect(out).toMatchObject({ ok: false, retryable: true });
    expect(out.error).toContain("socket hang up");
  });
});

describe("the credentials", () => {
  it("knows whether WhatsApp is set up at all", () => {
    expect(metaConfigured()).toBe(true);
    delete process.env.WHATSAPP_TOKEN;
    expect(metaConfigured()).toBe(false);
  });

  it("says who can fix it, without printing the token", async () => {
    delete process.env.WHATSAPP_TOKEN;
    const out = await sendTemplate({ to: "9810012345", templateName: "t", values: ["a"] }, { fetchImpl });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Ask an admin/);
    expect(calls).toHaveLength(0);
  });

  it("NEVER puts the token anywhere but the Authorization header", async () => {
    /* A token that reaches a log line, an error message or the body of a
       request is a token somebody can read later. */
    await sendTemplate({ to: "9810012345", templateName: "t", values: ["a"] }, { fetchImpl });
    expect(calls[0].opts.body).not.toContain("EAAG-test-token");
    expect(calls[0].url).not.toContain("EAAG-test-token");

    reply = { ok: false, body: { error: { code: 190, message: "bad token" } } };
    const out = await sendTemplate({ to: "9810012345", templateName: "t", values: ["a"] }, { fetchImpl });
    expect(JSON.stringify(out)).not.toContain("EAAG-test-token");
  });
});

describe("the error a first test run meets", () => {
  it("explains the test list rather than repeating Meta's wording", async () => {
    const out = await sendTemplate({
      to: "919810012345",
      templateName: "quotation_sent",
      values: ["A", "B", "C", "D"],
    }, {
      fetchImpl: async () => new Response(JSON.stringify({ error: {
        message: "Recipient phone number not in allowed list",
        code: 131030, type: "OAuthException",
      } }), { status: 400 }),
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("test list");
    expect(out.error).toContain("API Setup");
  });

  it("says the same when Meta sends the words without the code", async () => {
    const out = await sendTemplate({
      to: "919810012345",
      templateName: "quotation_sent",
      values: ["A", "B", "C", "D"],
    }, {
      fetchImpl: async () => new Response(JSON.stringify({ error: {
        message: "This number is not in allowed list for this app",
      } }), { status: 400 }),
    });
    expect(out.error).toContain("test list");
  });
});
