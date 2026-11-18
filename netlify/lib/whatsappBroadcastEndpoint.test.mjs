import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── a stand-in database ────────────────────────────────────────────── */
const DB = {
  company_members: [],
  company_profiles: [],
  customers: [],
  settings: [],
  whatsapp_messages: [],
};

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
        const saved = { id: `row-${(DB[table] ?? []).length + 1}`, created_at: new Date().toISOString(), ...row };
        (DB[table] ??= []).push(saved);
        return { select: () => ({ maybeSingle: async () => ({ data: saved, error: null }) }) };
      },
      update(patch) {
        return { eq: async (c, v) => { for (const r of DB[table] ?? []) if (r[c] === v) Object.assign(r, patch); return {}; } };
      },
      then(res) {
        const rows = q._rows();
        return Promise.resolve({ data: rows, count: rows.length, error: null }).then(res);
      },
    };
    return q;
  };
  return {
    from,
    rpc: () => Promise.resolve({ data: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }], error: null }),
  };
}

/** Every template send, in order. */
let sent = [];
let uploads = 0;

vi.mock("./auth.mjs", () => ({
  adminClient: () => makeClient(),
  signedInUser: async () => ({ id: "user-1", email: "abhinav@techzoid.example" }),
}));

vi.mock("./whatsappMeta.mjs", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    metaAccount: () => ({ token: "t", phoneNumberId: "p", wabaId: "w" }),
    approvedTemplates: async () => ({ ok: false, templates: {} }),
    uploadDocument: async () => { uploads += 1; return { ok: true, id: "media-shared-1" }; },
    sendTemplate: async (args) => { sent.push(args); return { ok: true, id: `wamid.${sent.length}`, to: args.to }; },
  };
});

const { handler } = await import("../functions/whatsapp-profile-send.mjs");

const COMPANY = "cc000000-0000-0000-0000-000000000001";
const PDF = Buffer.from("%PDF-1.7 a company profile").toString("base64");

const post = (body) => handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const parse = (res) => JSON.parse(res.body);

const customer = (id, over = {}) => ({
  id, company_id: COMPANY,
  data: { company: `Firm ${id}`, contact: `Buyer ${id}`, phone: "9810012345", whatsappOptIn: true, ...over },
});

beforeEach(() => {
  DB.company_members = [{ company_id: COMPANY, user_id: "user-1" }];
  DB.company_profiles = [{ company_id: COMPANY, file_name: "profile.pdf", mime: "application/pdf", bytes: 25, content: PDF }];
  DB.customers = [customer("c1"), customer("c2", { phone: "9820099887" })];
  DB.settings = [{ company_id: COMPANY, data: { company: { name: "TechZoid Technologies Private Limited" } } }];
  DB.whatsapp_messages = [];
  sent = [];
  uploads = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("sending the profile to customers on file", () => {
  it("sends one message each, with the profile attached", async () => {
    const res = await post({ companyId: COMPANY, customerIds: ["c1", "c2"] });
    expect(res.statusCode).toBe(200);
    expect(parse(res).sent).toBe(2);
    expect(sent).toHaveLength(2);
    for (const s of sent) {
      expect(s.templateName).toBe("company_profile");
      expect(s.document).toMatchObject({ id: "media-shared-1" });
    }
  });

  /* THE FILE GOES UP ONCE. Two hundred recipients used to mean two hundred
     uploads of the same few megabytes for an identical id. */
  it("uploads the profile once for the whole piece", async () => {
    await post({ companyId: COMPANY, customerIds: ["c1", "c2"] });
    expect(uploads).toBe(1);
  });

  it("greets each person by their own name", async () => {
    await post({ companyId: COMPANY, customerIds: ["c1", "c2"] });
    expect(sent.map((s) => s.values[0])).toEqual(["Buyer c1", "Buyer c2"]);
    expect(sent[0].values[1]).toBe("TechZoid Technologies Private Limited");
  });

  /* Meta's rule, not a preference, and the record is the evidence. */
  it("refuses a customer who has not agreed, and says why", async () => {
    DB.customers = [customer("c1", { whatsappOptIn: false })];
    const res = await post({ companyId: COMPANY, customerIds: ["c1"] });
    expect(parse(res).sent).toBe(0);
    expect(parse(res).results[0].error).toMatch(/has not agreed/i);
    expect(sent).toHaveLength(0);
  });
});

describe("sending to a pasted list of numbers", () => {
  const numbers = [{ phone: "+919811122233", label: "Anoop Samdani" }];

  /* A pasted number has no record and therefore no tick. The sender says
     these people agreed, and that declaration is recorded against their
     own user id — without it nothing goes. */
  it("will not send to a pasted number unless somebody declares consent", async () => {
    const res = await post({ companyId: COMPANY, numbers });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/agreed to hear from you/i);
    expect(sent).toHaveLength(0);
  });

  it("sends when consent is declared", async () => {
    const res = await post({ companyId: COMPANY, numbers, declaredConsent: true });
    expect(parse(res).sent).toBe(1);
    expect(sent[0].values[0]).toBe("Anoop Samdani");
  });

  /* The log has to answer "why did this stranger get this?" the way every
     other row does. `sent_by` names the person; the trigger names what
     they asserted. */
  it("records who vouched for the number", async () => {
    await post({ companyId: COMPANY, numbers, declaredConsent: true });
    const row = DB.whatsapp_messages.at(-1);
    expect(row.sent_by).toBe("user-1");
    expect(row.trigger).toMatch(/consent declared by user-1/);
  });

  it("greets a number that came with no name, rather than refusing it", async () => {
    await post({ companyId: COMPANY, numbers: [{ phone: "+919811122233", label: "" }], declaredConsent: true });
    expect(sent[0].values[0]).toBe("there");
  });

  it("sends to customers and pasted numbers in one go", async () => {
    const res = await post({
      companyId: COMPANY, customerIds: ["c1"], numbers, declaredConsent: true,
    });
    expect(parse(res).sent).toBe(2);
    expect(uploads).toBe(1);
  });
});

describe("who may send a broadcast at all", () => {
  it("refuses somebody who is not a member of that company", async () => {
    DB.company_members = [];
    const res = await post({ companyId: COMPANY, customerIds: ["c1"] });
    expect(res.statusCode).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("refuses when there is no profile to attach", async () => {
    DB.company_profiles = [];
    const res = await post({ companyId: COMPANY, customerIds: ["c1"] });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/no company profile/i);
    expect(uploads).toBe(0);
  });

  /* The second blank is the company's own name, and an empty blank fails
     the whole message at Meta. Better to say so than to send nothing and
     report a wall of refusals. */
  it("refuses when the company has no name set", async () => {
    DB.settings = [{ company_id: COMPANY, data: {} }];
    const res = await post({ companyId: COMPANY, customerIds: ["c1"] });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/company name is not set/i);
  });

  it("refuses an empty list", async () => {
    const res = await post({ companyId: COMPANY, customerIds: [] });
    expect(res.statusCode).toBe(400);
  });
});
