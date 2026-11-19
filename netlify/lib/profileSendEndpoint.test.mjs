import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The company-profile sender, end to end against a stand-in database.
 *
 * WHAT THESE TESTS ARE FOR. The feature makes one promise — thirty customers
 * get thirty separate emails, each addressed to that person alone — and the
 * promise is kept or broken in this one function. So the assertions are
 * mostly about the SHAPE OF WHAT REACHED THE TRANSPORT: how many calls, how
 * many addresses on each, and whether any recipient could see another.
 *
 * (This file lives in netlify/lib/ and not beside the function on purpose:
 * Netlify deploys every file in the functions directory as a function, and a
 * dotted name there fails the whole build. See portalEndpoints.test.mjs.)
 */

/* ── a stand-in for the service-role client ─────────────────────────── */

const DB = {
  company_members: [],
  company_profiles: [],
  profile_sends: [],
  profiles: [],
};

let rateLimited = false;

function makeClient() {
  const from = (table) => {
    const filters = [];
    const q = {
      select() { return q; },
      eq(col, val) { filters.push([col, val]); return q; },
      _rows() {
        return (DB[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      },
      maybeSingle() { return Promise.resolve({ data: q._rows()[0] ?? null, error: null }); },
      insert(row) {
        (DB[table] ??= []).push({ ...row });
        return Promise.resolve({ error: null });
      },
      then(resolve) { return Promise.resolve({ data: q._rows(), error: null }).then(resolve); },
    };
    return q;
  };
  return {
    from,
    rpc: () => Promise.resolve({
      data: [{ allowed: !rateLimited, remaining: 9, retry_after_seconds: rateLimited ? 600 : 0 }],
      error: null,
    }),
  };
}

/** Every call the function made to the transport, in order. */
let sends = [];
/** Addresses the transport should refuse, to test a partial failure. */
let bounce = new Set();
/** From this address onwards the transport answers "throttled". */
let throttleFrom = null;
/** Addresses for which the transport THROWS rather than answering — a
 *  dropped socket, which is not the same as a refusal. */
let explode = new Set();

/* THE PAUSE IS OFF FOR THESE TESTS, deliberately. Everything below is
   about what happens when a send actually runs — one message per person,
   nobody in anybody else's To line, the log row. The pause is tested
   where it lives, in bulkEmailPause.test.mjs, and leaving it on here
   would turn thirty assertions about sending into thirty assertions that
   nothing was sent. */
let paused = false;
vi.mock("./bulkEmailPause.mjs", () => ({
  get PAUSED() { return paused; },
  bulkEmailPaused: () => paused,
  PAUSE_REASON: "Bulk email is paused.",
  pausedLog: (what) => `${what}: skipped`,
}));

vi.mock("./auth.mjs", () => ({
  adminClient: () => makeClient(),
  signedInUser: async () => ({ id: "user-1", email: "abhinav@techzoid.example" }),
}));

vi.mock("./mailer.mjs", () => ({
  sendMail: async (args) => {
    sends.push(args);
    if (throttleFrom && args.to === throttleFrom) {
      return {
        ok: false, retryable: true, throttled: true, retryAfterSeconds: 300,
        error: "Microsoft is limiting how much this mailbox can send at once — not a problem with the address. "
          + "Nothing was sent to them. Try again in about 5 minutes.",
      };
    }
    if (explode.has(args.to)) throw new Error("socket hang up");
    if (bounce.has(args.to)) {
      return { ok: false, error: "Mailbox unavailable.", retryable: false };
    }
    return { ok: true, via: "microsoft", from: "abhinav@techzoid.example" };
  },
}));

const { handler } = await import("../functions/profile-send.mjs");

const COMPANY = "cc000000-0000-0000-0000-000000000001";
const BATCH = "b1c2d3e4-0000-4000-8000-000000000001";
/* 24 bytes of valid base64, standing in for the PDF. */
const PDF = Buffer.from("%PDF-1.7 a company profile").toString("base64");

const message = (email, name, customerId = null) => ({
  email,
  customerId,
  label: name,
  subject: "TechZoid Technologies — company profile",
  message: `Dear ${name},\n\nOur profile is attached.\n\nAbhinav Jain`,
  html: `<p>Dear ${name},</p><p>Our profile is attached.</p>`,
});

const post = (body) => handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const parse = (res) => JSON.parse(res.body);

const THIRTY = Array.from({ length: 30 }, (_, i) => message(`buyer${i}@company${i}.example`, `Buyer ${i}`));

beforeEach(() => {
  sends = [];
  bounce = new Set();
  paused = false;
  throttleFrom = null;
  explode = new Set();
  rateLimited = false;
  DB.company_members = [{ company_id: COMPANY, user_id: "user-1" }];
  DB.company_profiles = [{
    company_id: COMPANY,
    file_name: "TechZoid-Company-Profile.pdf",
    mime: "application/pdf",
    bytes: 26,
    content: PDF,
  }];
  DB.profile_sends = [];
  DB.profiles = [{ id: "user-1", email: "abhinav@techzoid.example" }];
});

describe("one message per recipient, and nobody sees anybody else", () => {
  it("calls the transport once for each person", async () => {
    const out = parse(await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 6) }));
    expect(out.sent).toBe(6);
    expect(sends).toHaveLength(6);
    expect(sends.map((s) => s.to)).toEqual(THIRTY.slice(0, 6).map((m) => m.email));
  });

  it("puts ONE address in To, and never a cc or bcc", async () => {
    /* THE WHOLE POINT. A single `to` string, and nothing that could carry a
       second recipient — if a cc ever appears here, thirty customers can
       read each other's addresses. */
    await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 6) });
    for (const s of sends) {
      expect(typeof s.to).toBe("string");
      expect(s.to.split(/[,;]/)).toHaveLength(1);
      expect(s.cc ?? []).toEqual([]);
      expect(s.bcc).toBeUndefined();
    }
  });

  it("lets no recipient's address into anybody else's message", async () => {
    await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 6) });
    for (const s of sends) {
      const others = sends.filter((o) => o.to !== s.to).map((o) => o.to);
      for (const other of others) {
        expect(s.message).not.toContain(other);
        expect(s.html).not.toContain(other);
        expect(s.subject).not.toContain(other);
      }
    }
  });

  it("sends each person the words that were written for them", async () => {
    await post({ companyId: COMPANY, batchId: BATCH, messages: [message("ravi@acme.example", "Ravi")] });
    expect(sends[0].message).toContain("Dear Ravi,");
    expect(sends[0].html).toContain("Dear Ravi,");
  });

  it("asks replies to come back to the person who sent it", async () => {
    await post({ companyId: COMPANY, batchId: BATCH, messages: [message("ravi@acme.example", "Ravi")] });
    expect(sends[0].replyTo).toBe("abhinav@techzoid.example");
  });
});

describe("the attachment", () => {
  it("attaches the stored profile, the same one for everybody", async () => {
    const out = parse(await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 3) }));
    expect(out.attachment).toEqual({ name: "TechZoid-Company-Profile.pdf", bytes: 26 });
    for (const s of sends) {
      expect(s.attachment.name).toBe("TechZoid-Company-Profile.pdf");
      expect(s.attachment.base64).toBe(PDF);
    }
  });

  it("takes NOTHING the browser offers as an attachment", async () => {
    /* The browser must not be able to put a file on an email that goes out
       under the company's name to thirty customers. The only attachment is
       the one an Admin uploaded. */
    await post({
      companyId: COMPANY, batchId: BATCH,
      messages: [message("ravi@acme.example", "Ravi")],
      attachmentBase64: Buffer.from("not the profile").toString("base64"),
      attachmentName: "invoice.pdf",
    });
    expect(sends[0].attachment.name).toBe("TechZoid-Company-Profile.pdf");
    expect(sends[0].attachment.base64).toBe(PDF);
  });

  it("refuses the whole send when no profile is on file", async () => {
    DB.company_profiles = [];
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 2) });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/no company profile on file/i);
    expect(sends).toHaveLength(0);
  });

  it("refuses a stored file too large for the transport", async () => {
    DB.company_profiles[0].content = "A".repeat(6 * 1024 * 1024);
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 2) });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/cannot be sent/i);
    expect(sends).toHaveLength(0);
  });
});

describe("who may send it", () => {
  it("refuses somebody who is not in that company", async () => {
    DB.company_members = [];
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 2) });
    expect(res.statusCode).toBe(403);
    expect(sends).toHaveLength(0);
  });

  it("refuses a company the caller named but does not belong to", async () => {
    const res = await post({
      companyId: "cc000000-0000-0000-0000-00000000ffff", batchId: BATCH, messages: THIRTY.slice(0, 1),
    });
    expect(res.statusCode).toBe(403);
    expect(sends).toHaveLength(0);
  });

  it("refuses when the rate limit is spent", async () => {
    rateLimited = true;
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 2) });
    expect(res.statusCode).toBe(429);
    expect(sends).toHaveLength(0);
  });
});

describe("validation happens before anything leaves", () => {
  it("sends none of them when the fourth address is malformed", async () => {
    /* Sending the first three and then failing leaves somebody working out
       which half of their list is in an inbox. */
    const list = [...THIRTY.slice(0, 3), message("not-an-address", "Nobody"), ...THIRTY.slice(4, 6)];
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: list });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toContain("not-an-address");
    expect(sends).toHaveLength(0);
  });

  it("refuses a message with no subject, naming who it was for", async () => {
    const res = await post({
      companyId: COMPANY, batchId: BATCH,
      messages: [{ ...message("ravi@acme.example", "Ravi"), subject: "" }],
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toContain("ravi@acme.example");
    expect(sends).toHaveLength(0);
  });

  it("refuses an empty list and a batch with no id", async () => {
    expect((await post({ companyId: COMPANY, batchId: BATCH, messages: [] })).statusCode).toBe(400);
    expect((await post({ companyId: COMPANY, batchId: "nope", messages: THIRTY.slice(0, 1) })).statusCode).toBe(400);
    expect(sends).toHaveLength(0);
  });

  it("refuses more than it can send inside one request", async () => {
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(/at a time/i);
    expect(sends).toHaveLength(0);
  });
});

describe("a variable nothing filled in", () => {
  it("refuses a subject that still has a token in it", async () => {
    /* It happened: nine emails went out reading "{{sender_company}} —
       company profile" because the company name had never been filled in
       on the settings row. The screen blocks it now; this is the wall
       behind the screen. */
    const res = await post({
      companyId: COMPANY, batchId: BATCH,
      messages: [{ ...message("ravi@acme.example", "Ravi"), subject: "{{sender_company}} — company profile" }],
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toContain("{{sender_company}}");
    expect(sends).toHaveLength(0);
  });

  it("refuses a body with a token, and sends none of the batch", async () => {
    const res = await post({
      companyId: COMPANY, batchId: BATCH,
      messages: [
        message("ravi@acme.example", "Ravi"),
        { ...message("priya@beta.example", "Priya"), message: "Dear {{first_name}}, our profile is attached." },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(sends).toHaveLength(0);
  });

  it("refuses a token hiding in the HTML alone", async () => {
    const res = await post({
      companyId: COMPANY, batchId: BATCH,
      messages: [{ ...message("ravi@acme.example", "Ravi"), html: "<p>Dear {{first_name}},</p>" }],
    });
    expect(res.statusCode).toBe(400);
    expect(sends).toHaveLength(0);
  });

  it("lets ordinary braces through", async () => {
    /* A customer whose name has a brace in it is not a template. Only the
       {{name}} shape is a variable. */
    const res = await post({
      companyId: COMPANY, batchId: BATCH,
      messages: [{ ...message("ravi@acme.example", "Ravi"), message: "Dear Ravi,\n\nRates for {2026} attached." }],
    });
    expect(res.statusCode).toBe(200);
    expect(sends).toHaveLength(1);
  });
});

describe("where replies go", () => {
  it("uses the sender's own address from their session", async () => {
    await post({ companyId: COMPANY, batchId: BATCH, messages: [message("ravi@acme.example", "Ravi")] });
    expect(sends[0].replyTo).toBe("abhinav@techzoid.example");
  });

  it("falls back to their profile row when the session carries no email", async () => {
    /* Not every sign-in path puts an email in the token. A profile email
       that cannot be answered is a leaflet. */
    const auth = await import("./auth.mjs");
    const was = auth.signedInUser;
    auth.signedInUser = async () => ({ id: "user-1", email: null });
    try {
      await post({ companyId: COMPANY, batchId: BATCH, messages: [message("ravi@acme.example", "Ravi")] });
      expect(sends[0].replyTo).toBe("abhinav@techzoid.example");
    } finally {
      auth.signedInUser = was;
    }
  });

  it("takes no reply-to from the request", async () => {
    /* A client-named reply-to is a way to have the company's own mailbox
       invite replies to somewhere else. */
    await post({
      companyId: COMPANY, batchId: BATCH,
      messages: [message("ravi@acme.example", "Ravi")],
      replyTo: "attacker@elsewhere.example",
    });
    expect(sends[0].replyTo).toBe("abhinav@techzoid.example");
  });
});

describe("when one of them bounces", () => {
  it("sends the rest and says exactly who failed", async () => {
    bounce = new Set(["buyer2@company2.example"]);
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 5) });
    const out = parse(res);
    expect(res.statusCode).toBe(200);
    expect(out.sent).toBe(4);
    expect(out.failed).toBe(1);
    const bad = out.results.find((r) => !r.ok);
    expect(bad.email).toBe("buyer2@company2.example");
    expect(bad.error).toBe("Mailbox unavailable.");
    /* The other four still went. */
    expect(sends).toHaveLength(5);
  });

  it("carries on when the transport throws rather than answers", async () => {
    /* A dropped socket on the first of three must not cost the other two.
       An unhandled throw here would end the loop and leave the rest of a
       list unsent, with a 500 that says nothing about which went. */
    explode = new Set(["buyer0@company0.example"]);
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 3) });
    const out = parse(res);
    expect(res.statusCode).toBe(200);
    expect(out.sent).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.results[0].error).toBe("socket hang up");
    expect(sends).toHaveLength(3);
    expect(DB.profile_sends.map((r) => r.status)).toEqual(["failed", "sent", "sent"]);
  });
});

describe("the log", () => {
  it("writes one row per recipient, with what was sent", async () => {
    await post({
      companyId: COMPANY, batchId: BATCH,
      messages: [message("ravi@acme.example", "Ravi Sharma", "cust-7")],
    });
    expect(DB.profile_sends).toHaveLength(1);
    expect(DB.profile_sends[0]).toMatchObject({
      company_id: COMPANY,
      batch_id: BATCH,
      customer_id: "cust-7",
      email: "ravi@acme.example",
      recipient_name: "Ravi Sharma",
      status: "sent",
      via: "microsoft",
      sent_by: "user-1",
    });
  });

  it("records a failure as a failure, with the reason", async () => {
    bounce = new Set(["ravi@acme.example"]);
    await post({ companyId: COMPANY, batchId: BATCH, messages: [message("ravi@acme.example", "Ravi")] });
    expect(DB.profile_sends[0]).toMatchObject({ status: "failed", error: "Mailbox unavailable." });
  });

  it("puts every piece of one list under the same batch", async () => {
    await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 6) });
    await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(6, 12) });
    expect(DB.profile_sends).toHaveLength(12);
    expect(new Set(DB.profile_sends.map((r) => r.batch_id))).toEqual(new Set([BATCH]));
  });

  it("records a pasted address with no customer rather than inventing one", async () => {
    await post({ companyId: COMPANY, batchId: BATCH, messages: [message("stranger@elsewhere.example", "Stranger")] });
    expect(DB.profile_sends[0].customer_id).toBeNull();
  });
});

/* ── when Microsoft limits how much the mailbox may upload ──────────────
   "Application is over its IncomingBytes limit" is a BYTE budget per
   mailbox over a short window, not a problem with any address. A mailshot
   carrying a two-megabyte profile reaches it in roughly fifty messages.
   Read as a refusal it produced a screen of identical failures against
   thirty real customers, and no hint that the answer was to wait. */
describe("when the mailbox is throttled mid-list", () => {
  beforeEach(() => {
    throttleFrom = null;
  });

  it("stops rather than spending the rest of the list on the same error", async () => {
    throttleFrom = THIRTY[2].email;
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 6) });
    const out = parse(res);

    /* Two went. The third was throttled, and nothing after it was even
       attempted — the transport is called twice, not six times. */
    expect(out.sent).toBe(2);
    expect(sends).toHaveLength(3);
    expect(out.results.filter((r) => !r.ok)).toHaveLength(4);
  });

  it("says it is a limit and not the address, and how long to wait", async () => {
    throttleFrom = THIRTY[0].email;
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 3) });
    const said = parse(res).results[0].error;
    expect(said).toMatch(/limiting how much/i);
    expect(said).toMatch(/not a problem with the address/i);
    expect(said).toMatch(/Nothing was sent to them/i);
    expect(said).toMatch(/minute/);
  });

  /* They can all be sent again once the window clears, so the screen must
     offer them rather than treating them as dead. */
  it("marks every one of them as worth trying again", async () => {
    throttleFrom = THIRTY[0].email;
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 3) });
    expect(parse(res).results.every((r) => r.retryable)).toBe(true);
  });
});


describe("while bulk email is paused", () => {
  /* The company's mailbox was restricted by Microsoft after a large
     mailshot. Nothing further must go out, and the person pressing Send
     must be told why rather than meeting a wall of refusals. */
  it("sends nothing at all, and says why", async () => {
    paused = true;
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 3) });
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatch(/paused/i);
    expect(sends).toHaveLength(0);
    expect(DB.profile_sends).toHaveLength(0);
  });

  it("refuses before reading the profile or the company, so nothing is charged for", async () => {
    paused = true;
    DB.company_profiles = [];
    DB.company_members = [];
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 1) });
    /* Not "no profile on file" and not "not a member" — the pause answers
       first, because it is the true reason nothing is going out. */
    expect(res.statusCode).toBe(503);
  });
});
