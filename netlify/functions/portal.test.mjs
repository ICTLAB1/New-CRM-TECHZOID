import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The portal endpoints, exercised end to end against a stand-in database.
 *
 * The unit tests beside portalView.mjs prove the redaction. These prove the
 * plumbing around it: that a revoked link is refused, that the filter is on
 * the server rather than in the request, that a draft never appears, and that
 * the customer's answer to a quotation can only ever be the one thing it is
 * allowed to be.
 */

/* ── a stand-in for the service-role client ─────────────────────────── */

const DB = {
  portal_tokens: [],
  customers: [],
  settings: [{ id: "main", data: { company: { name: "TechZoid Technologies" } } }],
  quotes: [],
  proformas: [],
  invoices: [],
  purchase_orders: [],
};

/** Records every table the code under test touched, so a test can assert on
 *  what was NOT read as well as what was. */
let touched = [];

function makeClient() {
  const from = (table) => {
    touched.push(table);
    const filters = [];
    const q = {
      _table: table,
      select() { return q; },
      eq(col, val) { filters.push([col, val]); return q; },
      _rows() {
        return (DB[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      },
      maybeSingle() { return Promise.resolve({ data: q._rows()[0] ?? null, error: null }); },
      update(patch) {
        const target = q._rows();
        return {
          eq(col, val) { filters.push([col, val]); return this; },
          then(resolve) {
            for (const row of target) Object.assign(row, patch);
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
      },
      then(resolve) { return Promise.resolve({ data: q._rows(), error: null }).then(resolve); },
    };
    return q;
  };
  return { from, rpc: () => Promise.resolve({ data: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }], error: null }) };
}

vi.mock("../lib/auth.mjs", () => ({ adminClient: () => makeClient() }));

const { handler: read } = await import("./portal.mjs");
const { handler: respond } = await import("./portal-respond.mjs");
const { hashToken } = await import("../lib/portalToken.mjs");

/* A real-shaped token: 43 url-safe characters, as 32 random bytes encode. */
const TOKEN = "Xk3p_Qa9ZbLm2Rt7Yu4Wv1Nc8Hd5Ge0Jf6Ki3Ll9Ss";
const OTHER_TOKEN = "Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2Mm3Nn4O";

const get = (t) => read({ httpMethod: "GET", headers: {}, queryStringParameters: { t } });
const post = (body) => respond({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
  touched = [];
  DB.portal_tokens = [
    {
      id: "tok-1", customer_id: "cust-a", token_hash: hashToken(TOKEN),
      expires_at: new Date(Date.now() + 86400000).toISOString(), revoked_at: null, view_count: 0,
    },
    {
      id: "tok-2", customer_id: "cust-b", token_hash: hashToken(OTHER_TOKEN),
      expires_at: new Date(Date.now() + 86400000).toISOString(), revoked_at: null, view_count: 0,
    },
  ];
  DB.customers = [
    { id: "cust-a", data: { company: "Acme Pvt Ltd", stage: "negotiation", value: 2200000, notes: [] } },
    { id: "cust-b", data: { company: "Rival Industries" } },
  ];
  DB.quotes = [
    {
      id: "q-sent", customer_id: "cust-a",
      data: { number: "Q/0042", status: "Sent", date: "2026-03-01", items: [{ id: "i1", desc: "M365 E3", rate: 3100, cost: 2750 }] },
    },
    {
      id: "q-draft", customer_id: "cust-a",
      data: { number: "Q/0043", status: "Draft", date: "2026-03-05", items: [] },
    },
    {
      id: "q-theirs", customer_id: "cust-b",
      data: { number: "Q/9999", status: "Sent", date: "2026-03-02", items: [] },
    },
  ];
  DB.proformas = [];
  DB.invoices = [];
  DB.purchase_orders = [
    { id: "po-1", customer_id: "cust-a", data: { number: "PO/0001", status: "Sent", items: [{ rate: 2750 }] } },
  ];
});

describe("opening a portal link", () => {
  it("shows the customer their sent quotation", async () => {
    const out = parse(await get(TOKEN));
    expect(out.valid).toBe(true);
    expect(out.customer.company).toBe("Acme Pvt Ltd");
    expect(out.documents.map((d) => d.number)).toEqual(["Q/0042"]);
  });

  it("never shows a draft", async () => {
    const out = parse(await get(TOKEN));
    expect(out.documents.find((d) => d.number === "Q/0043")).toBeUndefined();
  });

  it("never shows another customer's document", async () => {
    const out = parse(await get(TOKEN));
    expect(JSON.stringify(out)).not.toContain("Q/9999");
    expect(JSON.stringify(out)).not.toContain("Rival Industries");
  });

  it("never reads the purchase orders, which carry what we paid", async () => {
    await get(TOKEN);
    expect(touched).not.toContain("purchase_orders");
    expect(touched).not.toContain("orders");
    expect(touched).not.toContain("profiles");
  });

  it("does not leak the cost of a line", async () => {
    const out = parse(await get(TOKEN));
    expect(JSON.stringify(out)).not.toContain("2750");
  });

  it("does not leak how the account is being run", async () => {
    const out = parse(await get(TOKEN));
    const json = JSON.stringify(out);
    expect(json).not.toContain("negotiation");
    expect(json).not.toContain("2200000");
  });

  it("counts the view, so a salesperson can tell it was opened", async () => {
    await get(TOKEN);
    expect(DB.portal_tokens[0].view_count).toBe(1);
    expect(DB.portal_tokens[0].last_seen_at).toBeTruthy();
  });

  /* The three ways a link stops working all answer identically, so trying
     tokens tells an attacker nothing about which ones ever existed. */
  it("answers a revoked, an expired and an invented link the same way", async () => {
    DB.portal_tokens[0].revoked_at = new Date().toISOString();
    const revoked = parse(await get(TOKEN));

    DB.portal_tokens[0].revoked_at = null;
    DB.portal_tokens[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const expired = parse(await get(TOKEN));

    const invented = parse(await get("Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp9Oo8Nn7Mm"));

    expect(revoked).toEqual({ valid: false });
    expect(expired).toEqual({ valid: false });
    expect(invented).toEqual({ valid: false });
  });

  it("refuses a token that is not even the right shape, without asking the database", async () => {
    const out = parse(await get("' or 1=1 --"));
    expect(out).toEqual({ valid: false });
    expect(touched).not.toContain("quotes");
  });
});

describe("answering a quotation", () => {
  it("records an acceptance", async () => {
    const out = parse(await post({ token: TOKEN, documentId: "q-sent", answer: "accept", signedBy: "Ravi Menon" }));
    expect(out.ok).toBe(true);
    expect(DB.quotes[0].data.status).toBe("Accepted");
    expect(DB.quotes[0].data.customerResponse.by).toBe("Ravi Menon");
  });

  it("puts it on the customer's timeline, unattributed to any of our staff", async () => {
    await post({ token: TOKEN, documentId: "q-sent", answer: "accept", signedBy: "Ravi Menon" });
    const note = DB.customers[0].data.notes[0];
    expect(note.text).toContain("accepted through the customer portal");
    expect(note.user).toBe("Ravi Menon");
    expect(note.userId).toBe("");
  });

  it("is safe to press twice", async () => {
    await post({ token: TOKEN, documentId: "q-sent", answer: "accept" });
    const again = parse(await post({ token: TOKEN, documentId: "q-sent", answer: "accept" }));
    expect(again.ok).toBe(true);
    expect(again.alreadyRecorded).toBe(true);
    expect(DB.quotes[0].data.status).toBe("Accepted");
  });

  it("will not let an acceptance be reversed by clicking the other button", async () => {
    await post({ token: TOKEN, documentId: "q-sent", answer: "accept" });
    const res = await post({ token: TOKEN, documentId: "q-sent", answer: "decline" });
    expect(res.statusCode).toBe(409);
    expect(DB.quotes[0].data.status).toBe("Accepted");
  });

  it("cannot answer a draft", async () => {
    const res = await post({ token: TOKEN, documentId: "q-draft", answer: "accept" });
    expect(res.statusCode).toBe(409);
    expect(DB.quotes[1].data.status).toBe("Draft");
  });

  it("cannot answer another customer's quotation, even knowing its id", async () => {
    const res = await post({ token: TOKEN, documentId: "q-theirs", answer: "accept" });
    expect(res.statusCode).toBe(404);
    expect(DB.quotes[2].data.status).toBe("Sent");
  });

  it("cannot set a status of its own choosing", async () => {
    const res = await post({ token: TOKEN, documentId: "q-sent", answer: "Paid" });
    expect(res.statusCode).toBe(400);
    expect(DB.quotes[0].data.status).toBe("Sent");
  });

  it("cannot smuggle other fields onto the document", async () => {
    await post({
      token: TOKEN, documentId: "q-sent", answer: "accept",
      data: { items: [{ rate: 1 }] }, status: "Paid", number: "Q/0001",
    });
    expect(DB.quotes[0].data.number).toBe("Q/0042");
    expect(DB.quotes[0].data.items[0].rate).toBe(3100);
  });

  it("refuses a revoked link", async () => {
    DB.portal_tokens[0].revoked_at = new Date().toISOString();
    const res = await post({ token: TOKEN, documentId: "q-sent", answer: "accept" });
    expect(res.statusCode).toBe(403);
    expect(DB.quotes[0].data.status).toBe("Sent");
  });
});
