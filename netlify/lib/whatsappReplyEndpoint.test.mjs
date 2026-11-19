import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reply endpoint, against a stand-in database.
 *
 * WHAT A BROWSER MAY ATTACH IS DECIDED HERE. The file picker decides what
 * is easy to choose; this decides what is actually sent, because a request
 * can be made without the screen. A check that only lives in the browser
 * is not a check.
 *
 * (In netlify/lib/ rather than beside the function: a dotted file name in
 * the functions directory is an illegal function name and fails the whole
 * deploy. See portalEndpoints.test.mjs.)
 */

const DB = { company_members: [], whatsapp_messages: [] };

function makeClient() {
  const from = (table) => {
    const filters = [];
    const q = {
      select() { return q; },
      eq(col, val) { filters.push([col, val]); return q; },
      gte() { return q; },
      order() { return q; },
      limit() { return q; },
      insert: async (row) => { (DB[table] ??= []).push(row); return { error: null }; },
      _rows() { return (DB[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v)); },
      maybeSingle: () => Promise.resolve({ data: q._rows()[0] ?? null, error: null }),
      then(resolve) { return Promise.resolve({ data: q._rows(), error: null }).then(resolve); },
    };
    return q;
  };
  return { from };
}

vi.mock("./auth.mjs", () => ({
  adminClient: () => makeClient(),
  signedInUser: async () => ({ id: "u1", email: "sales@example.com" }),
}));
vi.mock("./ratelimit.mjs", () => ({
  consume: async () => ({ allowed: true }),
  tooManyMessage: () => "too many",
}));
vi.mock("./whatsappSender.mjs", async (orig) => {
  const real = await orig();
  return { ...real, replyInWords: vi.fn(async () => ({ ok: true, id: "wamid.1" })) };
});

const { replyInWords } = await import("./whatsappSender.mjs");
const { handler } = await import("../functions/whatsapp-notify.mjs");

const base64 = (bytes) => Buffer.from(bytes).toString("base64");
const sized = (n) => base64(Buffer.alloc(n, 7));

const reply = (over = {}) => handler({
  httpMethod: "POST",
  headers: {},
  body: JSON.stringify({
    action: "reply", companyId: "c1", phone: "919810012345", body: "Here you go", ...over,
  }),
});
const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
  DB.company_members = [{ company_id: "c1", user_id: "u1" }];
  /* An inbound message just now, so the 24-hour window is open. */
  DB.whatsapp_messages = [{
    company_id: "c1", phone: "919810012345", direction: "in",
    created_at: new Date().toISOString(),
  }];
  replyInWords.mockClear();
  replyInWords.mockResolvedValue({ ok: true, id: "wamid.1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a reply with no file", () => {
  it("still goes, exactly as before", async () => {
    const res = await reply();
    expect(res.statusCode).toBe(200);
    expect(replyInWords.mock.calls[0][1].attachment).toBeNull();
  });

  it("is refused when there are no words either", async () => {
    const res = await reply({ body: "   " });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toContain("nothing to send");
  });
});

describe("a reply with a file", () => {
  it("passes the decoded bytes, the kind and the type to the sender", async () => {
    const res = await reply({ attachment: { filename: "Price list.pdf", base64: base64("hello") } });
    expect(res.statusCode).toBe(200);
    const sent = replyInWords.mock.calls[0][1].attachment;
    expect(sent.filename).toBe("Price list.pdf");
    expect(sent.kind).toBe("document");
    expect(sent.mimeType).toBe("application/pdf");
    expect(Buffer.from(sent.bytes).toString()).toBe("hello");
  });

  it("decides an image is an image", async () => {
    await reply({ attachment: { filename: "rack.png", base64: base64("x") } });
    const sent = replyInWords.mock.calls[0][1].attachment;
    expect(sent.kind).toBe("image");
    expect(sent.mimeType).toBe("image/png");
  });

  it("goes with a file and NO words — a file on its own is a message", async () => {
    const res = await reply({ body: "", attachment: { filename: "a.pdf", base64: base64("x") } });
    expect(res.statusCode).toBe(200);
  });
});

describe("what the server refuses whatever the browser says", () => {
  it("refuses a file type that is not on the list", async () => {
    const res = await reply({ attachment: { filename: "setup.exe", base64: base64("MZ") } });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toContain(".exe");
    expect(replyInWords).not.toHaveBeenCalled();
  });

  it("refuses a file with no extension to name it by", async () => {
    const res = await reply({ attachment: { filename: "whatever", base64: base64("x") } });
    expect(res.statusCode).toBe(400);
    expect(replyInWords).not.toHaveBeenCalled();
  });

  it("MEASURES THE DECODED FILE, not any size the browser claimed", async () => {
    /* The whole point of checking here. A browser that says "2 KB" about
       a 20 MB file would otherwise get 20 MB through. */
    const res = await reply({
      attachment: { filename: "huge.pdf", base64: sized(9 * 1024 * 1024), size: 2048, bytes: 2048 },
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toContain("have to be under");
    expect(replyInWords).not.toHaveBeenCalled();
  });

  it("holds a picture to the smaller limit", async () => {
    const between = 6 * 1024 * 1024;
    expect((await reply({ attachment: { filename: "ok.pdf", base64: sized(between) } })).statusCode).toBe(200);
    replyInWords.mockClear();
    const res = await reply({ attachment: { filename: "big.jpg", base64: sized(between) } });
    expect(res.statusCode).toBe(400);
    expect(replyInWords).not.toHaveBeenCalled();
  });

  it("refuses an empty file rather than uploading nothing", async () => {
    const res = await reply({ attachment: { filename: "a.pdf", base64: "" } });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toContain("empty");
  });

  it("refuses a message too long to ride with a file, and says the limit", async () => {
    const res = await reply({
      body: "x".repeat(1025),
      attachment: { filename: "a.pdf", base64: base64("x") },
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toContain("1024");
    expect(replyInWords).not.toHaveBeenCalled();
  });

  it("allows that same long message with NO file, where the limit is higher", async () => {
    const res = await reply({ body: "x".repeat(1025) });
    expect(res.statusCode).toBe(200);
  });
});

describe("the checks that were already there still hold", () => {
  it("refuses a file outside the 24-hour window, like any other reply", async () => {
    DB.whatsapp_messages = [];
    const res = await reply({ attachment: { filename: "a.pdf", base64: base64("x") } });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toContain("24 hours");
    expect(replyInWords).not.toHaveBeenCalled();
  });

  it("refuses somebody sending from a company they are not in", async () => {
    DB.company_members = [];
    const res = await reply({ attachment: { filename: "a.pdf", base64: base64("x") } });
    expect(res.statusCode).toBe(403);
    expect(replyInWords).not.toHaveBeenCalled();
  });
});
