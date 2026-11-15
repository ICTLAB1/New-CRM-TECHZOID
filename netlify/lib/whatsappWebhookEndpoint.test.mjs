import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook, end to end against a stand-in database.
 *
 * The business number is API-only — no phone, no app, nobody holding it —
 * so everything here is really one question: can a customer's reply be
 * lost? The answers it must give are that an unknown number is still
 * filed, a repeat delivery is not duplicated, a status never moves
 * backwards, and a failure to email somebody never costs the message.
 *
 * (In netlify/lib/ and not beside the function: Netlify deploys every file
 * in the functions directory as a function, and a dotted name there fails
 * the whole build. See portalEndpoints.test.mjs.)
 */

const DB = { companies: [], customers: [], settings: [], whatsapp_messages: [] };
let rpcCalls = [];
/* One answer per database function, because the webhook asks two: whose
   number this is, and which company that customer is in. */
let rpcAnswers = {};
let mails = [];
let mailResult = { ok: true, via: "microsoft" };
let mailThrows = false;

function makeClient() {
  const from = (table) => {
    const filters = [];
    const q = {
      select() { return q; },
      eq(col, val) { filters.push([col, val]); return q; },
      order() { return q; },
      limit() { return Promise.resolve({ data: q._rows(), error: null }); },
      _rows() { return (DB[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v)); },
      maybeSingle() { return Promise.resolve({ data: q._rows()[0] ?? null, error: null }); },
      insert(row) {
        const saved = { id: `row-${(DB[table] ?? []).length + 1}`, ...row };
        (DB[table] ??= []).push(saved);
        return {
          select: () => ({ maybeSingle: async () => ({ data: saved, error: null }) }),
          then: (resolve) => Promise.resolve({ data: saved, error: null }).then(resolve),
        };
      },
      update(patch) {
        const target = q._rows();
        return {
          eq(col, val) { filters.push([col, val]); return this; },
          then(resolve) {
            for (const row of q._rows()) Object.assign(row, patch);
            void target;
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
      },
      then(resolve) { return Promise.resolve({ data: q._rows(), error: null }).then(resolve); },
    };
    return q;
  };
  return {
    from,
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: rpcAnswers[name] ?? null, error: null }; },
  };
}

vi.mock("./auth.mjs", () => ({ adminClient: () => makeClient() }));
vi.mock("./mailer.mjs", () => ({
  sendMail: async (args) => {
    mails.push(args);
    if (mailThrows) throw new Error("socket hang up");
    return mailResult;
  },
}));

const { handler } = await import("../functions/whatsapp-webhook.mjs");

const COMPANY = "c1";
const envelope = (value) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", ...value } }] }],
});

const post = (payload, headers = {}) => handler({
  httpMethod: "POST", headers, body: JSON.stringify(payload),
});
const get = (params) => handler({ httpMethod: "GET", headers: {}, queryStringParameters: params });

const incoming = (over = {}) => envelope({
  contacts: [{ wa_id: "919810012345", profile: { name: "Ravi Sharma" } }],
  messages: [{
    from: "919810012345", id: "wamid.IN1", timestamp: "1763222400",
    type: "text", text: { body: "Yes, please go ahead" }, ...over,
  }],
});

beforeEach(() => {
  DB.companies = [{ id: COMPANY, name: "TechZoid", created_at: "2026-01-01" }];
  DB.customers = [{ id: "cust-1", owner_id: "user-1", company_id: COMPANY, data: { company: "Acme Industries" } }];
  DB.settings = [{ company_id: COMPANY, data: {} }];
  DB.whatsapp_messages = [];
  rpcCalls = [];
  rpcAnswers = { whatsapp_customer_for: "cust-1", whatsapp_company_for: COMPANY };
  mails = [];
  mailResult = { ok: true, via: "microsoft" };
  mailThrows = false;
  process.env.WHATSAPP_VERIFY_TOKEN = "a-token-only-meta-and-we-know";
  delete process.env.WHATSAPP_APP_SECRET;
});

describe("Meta checking it has the right address", () => {
  it("echoes the challenge back as plain text", async () => {
    const res = await get({
      "hub.mode": "subscribe",
      "hub.verify_token": "a-token-only-meta-and-we-know",
      "hub.challenge": "1158201444",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("1158201444");
    expect(res.headers["Content-Type"]).toBe("text/plain");
  });

  it("refuses a wrong token, and says nothing about why", async () => {
    const res = await get({ "hub.mode": "subscribe", "hub.verify_token": "guessed", "hub.challenge": "123" });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("token");
  });

  it("refuses a token of a different length without leaking that either", async () => {
    const res = await get({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "123" });
    expect(res.statusCode).toBe(403);
  });

  it("refuses when the mode is not subscribe", async () => {
    const res = await get({
      "hub.mode": "unsubscribe", "hub.verify_token": "a-token-only-meta-and-we-know", "hub.challenge": "123",
    });
    expect(res.statusCode).toBe(403);
  });

  it("says it is not configured rather than letting anything through", async () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    const res = await get({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "123" });
    expect(res.statusCode).toBe(500);
  });
});

describe("a customer's reply", () => {
  it("is filed against the customer, with their words", async () => {
    const res = await post(incoming());
    expect(res.statusCode).toBe(200);
    expect(DB.whatsapp_messages).toHaveLength(1);
    expect(DB.whatsapp_messages[0]).toMatchObject({
      company_id: COMPANY,
      direction: "in",
      customer_id: "cust-1",
      phone: "919810012345",
      contact_name: "Ravi Sharma",
      body: "Yes, please go ahead",
      status: "received",
    });
  });

  it("IS STILL FILED when the number belongs to nobody", async () => {
    /* A stranger messaging the business number is a new enquiry, not an
       error. Dropping it would lose it entirely — nobody else is holding
       this number. */
    rpcAnswers = {};
    await post(incoming({ from: "919899999999" }));
    expect(DB.whatsapp_messages).toHaveLength(1);
    expect(DB.whatsapp_messages[0].customer_id).toBeNull();
    expect(DB.whatsapp_messages[0].phone).toBe("919899999999");
  });

  it("is still filed when the matcher itself breaks", async () => {
    rpcAnswers = {};
    rpcCalls = [];
    await post(incoming());
    expect(DB.whatsapp_messages).toHaveLength(1);
    expect(rpcCalls.map((c) => c.name)).toContain("whatsapp_customer_for");
  });

  it("files it under the company the number's customer is in, not the oldest", async () => {
    /* A CRM holds more than one company — a leftover stub beside the real
       one is normal — and "the oldest" put every reply in the empty one. */
    DB.companies = [
      { id: "c-old", name: "My company", created_at: "2020-01-01" },
      { id: COMPANY, name: "TechZoid", created_at: "2026-01-01" },
    ];
    await post(incoming());
    expect(DB.whatsapp_messages[0].company_id).toBe(COMPANY);
  });

  it("falls back to the oldest company only for a number nobody has on file", async () => {
    DB.companies = [
      { id: "c-old", name: "My company", created_at: "2020-01-01" },
      { id: COMPANY, name: "TechZoid", created_at: "2026-01-01" },
    ];
    rpcAnswers = {};
    await post(incoming({ from: "919899999999" }));
    expect(DB.whatsapp_messages[0].company_id).toBe("c-old");
    expect(DB.whatsapp_messages[0].customer_id).toBeNull();
  });

  it("asks which company by the number alone, never by a company it chose first", async () => {
    rpcCalls = [];
    await post(incoming());
    const ask = rpcCalls.find((c) => c.name === "whatsapp_company_for");
    expect(ask?.args).toEqual({ p_digits: "919810012345" });
  });

  it("is not stored twice when Meta retries the same delivery", async () => {
    await post(incoming());
    await post(incoming());
    expect(DB.whatsapp_messages).toHaveLength(1);
  });

  it("keeps a photo or a document as something that happened", async () => {
    await post(incoming({ id: "wamid.IN9", type: "document", document: { filename: "PO-4471.pdf" }, text: undefined }));
    expect(DB.whatsapp_messages[0].body).toContain("PO-4471.pdf");
  });
});

describe("telling somebody about it", () => {
  it("emails the alert address with the customer's words", async () => {
    await post(incoming());
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("abhinav.jain@techzoidtechnologies.com");
    expect(mails[0].subject).toContain("Acme Industries");
    expect(mails[0].message).toContain("Yes, please go ahead");
  });

  it("sends it from the salesperson who owns the account", async () => {
    await post(incoming());
    expect(mails[0].userId).toBe("user-1");
  });

  it("uses the address set in Settings when there is one", async () => {
    DB.settings[0].data = { whatsapp: { alertEmail: "inbox@techzoidtechnologies.com" } };
    await post(incoming());
    expect(mails[0].to).toBe("inbox@techzoidtechnologies.com");
  });

  it("says plainly when the number is on no record", async () => {
    rpcAnswers = {};
    await post(incoming({ from: "919899999999" }));
    expect(mails[0].message).toMatch(/not on any customer record/i);
  });

  it("NEVER COSTS THE MESSAGE when the mailer throws outright", async () => {
    /* Stored first, told about second. A mailbox that throws rather than
       answering must not turn a filed reply into a retry. */
    mailThrows = true;
    const res = await post(incoming());
    expect(res.statusCode).toBe(200);
    expect(DB.whatsapp_messages).toHaveLength(1);
    expect(DB.whatsapp_messages[0].body).toBe("Yes, please go ahead");
  });

  it("NEVER COSTS THE MESSAGE when the email cannot be sent", async () => {
    /* The reply is already stored. An unreachable mailbox must not turn a
       filed message into a 500 and a retry. */
    mailResult = { ok: false, error: "Mailbox not connected" };
    const res = await post(incoming());
    expect(res.statusCode).toBe(200);
    expect(DB.whatsapp_messages).toHaveLength(1);
  });
});

describe("delivery reports", () => {
  const sent = (over = {}) => {
    DB.whatsapp_messages.push({
      id: "m1", company_id: COMPANY, direction: "out", wa_message_id: "wamid.OUT1",
      status: "sent", error: "", ...over,
    });
  };

  it("moves a message on to delivered, then read", async () => {
    sent();
    await post(envelope({ statuses: [{ id: "wamid.OUT1", status: "delivered" }] }));
    expect(DB.whatsapp_messages[0].status).toBe("delivered");
    await post(envelope({ statuses: [{ id: "wamid.OUT1", status: "read" }] }));
    expect(DB.whatsapp_messages[0].status).toBe("read");
  });

  it("does not walk a read message back to delivered", async () => {
    sent({ status: "read" });
    await post(envelope({ statuses: [{ id: "wamid.OUT1", status: "delivered" }] }));
    expect(DB.whatsapp_messages[0].status).toBe("read");
  });

  it("records a failure with the reason a person can read", async () => {
    sent();
    await post(envelope({
      statuses: [{ id: "wamid.OUT1", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] }],
    }));
    expect(DB.whatsapp_messages[0].status).toBe("failed");
    expect(DB.whatsapp_messages[0].error).toBe("Message undeliverable");
  });

  it("ignores a status for a message this CRM never sent", async () => {
    const res = await post(envelope({ statuses: [{ id: "wamid.SOMEBODY_ELSE", status: "read" }] }));
    expect(res.statusCode).toBe(200);
    expect(DB.whatsapp_messages).toHaveLength(0);
  });
});

describe("who may call this", () => {
  const SECRET = "app-secret";
  const signed = (payload) => ({
    "x-hub-signature-256": "sha256=" + createHmac("sha256", SECRET).update(JSON.stringify(payload), "utf8").digest("hex"),
  });

  it("accepts a correctly signed payload when an app secret is set", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const payload = incoming();
    const res = await post(payload, signed(payload));
    expect(res.statusCode).toBe(200);
    expect(DB.whatsapp_messages).toHaveLength(1);
  });

  it("REFUSES a payload somebody else signed", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const res = await post(incoming(), { "x-hub-signature-256": "sha256=" + "0".repeat(64) });
    expect(res.statusCode).toBe(401);
    expect(DB.whatsapp_messages).toHaveLength(0);
  });

  it("refuses an unsigned payload once a secret is configured", async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const res = await post(incoming());
    expect(res.statusCode).toBe(401);
  });

  it("still works before an app secret has been added", async () => {
    /* Meta's verification already proved the URL is ours. Refusing
       everything until an optional secret is configured would mean no
       replies at all. */
    const res = await post(incoming());
    expect(res.statusCode).toBe(200);
    expect(DB.whatsapp_messages).toHaveLength(1);
  });
});

describe("rubbish, and other methods", () => {
  it("acknowledges something it cannot parse rather than asking for a retry", async () => {
    const res = await handler({ httpMethod: "POST", headers: {}, body: "{not json" });
    expect(res.statusCode).toBe(200);
  });

  it("acknowledges a change it does not act on", async () => {
    const res = await post({ entry: [{ changes: [{ field: "message_template_status_update", value: {} }] }] });
    expect(res.statusCode).toBe(200);
    expect(DB.whatsapp_messages).toHaveLength(0);
  });

  it("refuses an enormous body", async () => {
    const res = await handler({ httpMethod: "POST", headers: {}, body: "x".repeat(300_000) });
    expect(res.statusCode).toBe(413);
  });

  it("answers a preflight and refuses anything else", async () => {
    expect((await handler({ httpMethod: "OPTIONS", headers: {} })).statusCode).toBe(204);
    expect((await handler({ httpMethod: "DELETE", headers: {} })).statusCode).toBe(405);
  });
});
