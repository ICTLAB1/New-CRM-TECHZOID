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
  settings: [],
};

let rateLimited = false;

function makeClient() {
  const from = (table) => {
    const filters = [];
    const atLeast = [];
    const q = {
      /* The second argument is how the real client asks for a head count —
         the daily send limit uses one, and a stub that ignored it would let
         that query look like it worked while counting nothing. */
      select() { return q; },
      eq(col, val) { filters.push([col, val]); return q; },
      gte(col, val) { atLeast.push([col, val]); return q; },
      _rows() {
        return (DB[table] ?? [])
          .filter((r) => filters.every(([c, v]) => r[c] === v))
          .filter((r) => atLeast.every(([c, v]) => String(r[c] ?? "") >= String(v)));
      },
      maybeSingle() { return Promise.resolve({ data: q._rows()[0] ?? null, error: null }); },
      insert(row) {
        /* created_at is written by the database in life, so the stub has to
           write one too: without it every logged send is outside every day
           and the limit counts nothing. */
        (DB[table] ??= []).push({ created_at: new Date().toISOString(), ...row });
        return Promise.resolve({ error: null });
      },
      then(resolve) {
        const rows = q._rows();
        return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve);
      },
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
/** Addresses for which the transport THROWS rather than answering — a
 *  dropped socket, which is not the same as a refusal. */
let explode = new Set();

vi.mock("./auth.mjs", () => ({
  adminClient: () => makeClient(),
  signedInUser: async () => ({ id: "user-1", email: "abhinav@techzoid.example" }),
}));

vi.mock("./mailer.mjs", () => ({
  sendMail: async (args) => {
    sends.push(args);
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
  DB.settings = [{ company_id: COMPANY, data: {} }];
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

/* ── the day's sending limit ──────────────────────────────────────────
   What is being protected is not the mailbox — Microsoft would take
   thousands — but the DOMAIN'S reputation at the receiving end, which is
   the same reputation that carries this company's quotations and invoices.
   A sudden jump in volume is the shape of a compromised account, and the
   filtering that follows is slow to notice and slow to undo. Hence a stop
   on the server rather than a warning on a screen. */
describe("the day's sending limit", () => {
  /** Rows for mail this company already sent today. */
  const alreadySentToday = (n) => Array.from({ length: n }, (_, i) => ({
    company_id: COMPANY,
    batch_id: BATCH,
    email: `earlier${i}@company.example`,
    status: "sent",
    created_at: new Date().toISOString(),
  }));

  it("sends normally while there is allowance left", async () => {
    DB.settings = [{ company_id: COMPANY, data: { profile: { dailySendLimit: 10 } } }];
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 3) });
    expect(res.statusCode).toBe(200);
    expect(parse(res).sent).toBe(3);
    /* And it says what is left, so the screen need not ask. */
    expect(parse(res).limit).toEqual({ cap: 10, sentToday: 3, remaining: 7 });
  });

  it("REFUSES once the day is spent, before a single message leaves", async () => {
    DB.settings = [{ company_id: COMPANY, data: { profile: { dailySendLimit: 5 } } }];
    DB.profile_sends = alreadySentToday(5);

    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 3) });
    expect(res.statusCode).toBe(429);
    expect(sends).toHaveLength(0);
    expect(DB.profile_sends).toHaveLength(5);
  });

  it("says what the numbers are, when it lifts and where to change it", async () => {
    DB.settings = [{ company_id: COMPANY, data: { profile: { dailySendLimit: 5 } } }];
    DB.profile_sends = alreadySentToday(5);

    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 1) });
    const said = parse(res).error ?? res.body;
    expect(said).toContain("5 of 5");
    expect(said).toMatch(/domain/i);
    expect(said).toMatch(/midnight/i);
  });

  /* A LIST LONGER THAN WHAT IS LEFT IS CUT, NOT REFUSED. Refusing the whole
     piece would waste the allowance that was still there and leave the
     sender guessing where their list stopped. */
  it("sends what it can and names the ones it held back", async () => {
    DB.settings = [{ company_id: COMPANY, data: { profile: { dailySendLimit: 4 } } }];
    DB.profile_sends = alreadySentToday(2);

    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 5) });
    const out = parse(res);

    expect(res.statusCode).toBe(200);
    expect(out.sent).toBe(2);
    expect(sends.map((s) => s.to)).toEqual([THIRTY[0].email, THIRTY[1].email]);

    const held = out.results.filter((r) => !r.ok);
    expect(held.map((r) => r.email)).toEqual(THIRTY.slice(2, 5).map((m) => m.email));
    expect(held[0].error).toMatch(/Only 2 of today's 4 are left/);
    /* Tomorrow they will go, so the screen must offer them again. */
    expect(held.every((r) => r.retryable)).toBe(true);
    expect(out.limit.remaining).toBe(0);
  });

  it("does not spend the allowance on mail that never left", async () => {
    DB.settings = [{ company_id: COMPANY, data: { profile: { dailySendLimit: 3 } } }];
    bounce = new Set([THIRTY[0].email, THIRTY[1].email]);

    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 3) });
    /* Two bounced, so only one of the three counts against the day. */
    expect(parse(res).limit).toMatchObject({ sentToday: 1, remaining: 2 });
  });

  it("uses the safe default when the company has set nothing", async () => {
    DB.settings = [{ company_id: COMPANY, data: {} }];
    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 1) });
    expect(parse(res).limit.cap).toBe(40);
  });

  /* A COUNT THAT CANNOT BE READ STOPS THE SEND. Sending an unknown number
     on top of an unknown number is the one outcome the limit exists to
     prevent, so the failure direction is "nothing goes". */
  it("sends nothing rather than guess, when the count cannot be read", async () => {
    const broken = { ...DB };
    Object.defineProperty(DB, "profile_sends", {
      configurable: true,
      get() { throw new Error("profile_sends unreadable"); },
    });

    const res = await post({ companyId: COMPANY, batchId: BATCH, messages: THIRTY.slice(0, 2) });
    delete DB.profile_sends;
    DB.profile_sends = broken.profile_sends ?? [];

    expect(res.statusCode).toBe(503);
    expect(sends).toHaveLength(0);
  });
});
