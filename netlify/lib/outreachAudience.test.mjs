import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as server from "./outreachAudience.mjs";
import { buildAudience as clientAudience, sendWindow as clientWindow, DEFAULT_SCHEDULE }
  from "../../src/domain/outreach/sending";
import { renderHtml, unsubscribeUrl, withUnsubscribe, UNSUBSCRIBE_PLACEHOLDER, renderCampaignFor }
  from "./outreachRender.mjs";

/**
 * The two implementations of the sending rules must agree.
 *
 * outreachAudience.mjs exists because Netlify functions are plain .mjs and
 * the screens are TypeScript. Two copies of a rule that decides whether to
 * email a stranger is a liability; this file is how it is paid for. Every
 * case runs through BOTH and the results are compared.
 *
 * If you change a rule in one place and not the other, these fail. That is
 * the point — do not reconcile a difference by editing the expectation.
 */

const CASES = [
  {
    name: "a clean prospect",
    candidates: [{ id: "1", email: "ravi@acme.example", values: { first_name: "Ravi", company_name: "Acme" }, verificationStatus: "Unknown" }],
  },
  {
    name: "a suppressed prospect",
    candidates: [{ id: "1", email: "ravi@acme.example", values: { first_name: "Ravi", company_name: "Acme" }, verificationStatus: "Valid" }],
    suppressed: ["ravi@acme.example"],
  },
  {
    name: "a suppressed address written with different case",
    candidates: [{ id: "1", email: " Ravi@ACME.example ", values: { first_name: "Ravi", company_name: "Acme" }, verificationStatus: "Unknown" }],
    suppressed: ["ravi@acme.example"],
  },
  {
    name: "a quarantined prospect",
    candidates: [{ id: "1", email: "a@x.example", values: { first_name: "A", company_name: "X" }, quarantined: true, verificationStatus: "Unknown" }],
  },
  {
    name: "an address verification rejected",
    candidates: [{ id: "1", email: "a@x.example", values: { first_name: "A", company_name: "X" }, verificationStatus: "Invalid" }],
  },
  {
    name: "a disposable address",
    candidates: [{ id: "1", email: "a@x.example", values: { first_name: "A", company_name: "X" }, verificationStatus: "Disposable" }],
  },
  {
    name: "a role address, which stays eligible",
    candidates: [{ id: "1", email: "procurement@x.example", values: { first_name: "Team", company_name: "X" }, verificationStatus: "Role-based" }],
  },
  {
    name: "a catch-all domain",
    candidates: [{ id: "1", email: "a@x.example", values: { first_name: "A", company_name: "X" }, verificationStatus: "Catch-all" }],
  },
  {
    name: "somebody already written to",
    candidates: [{ id: "1", email: "a@x.example", values: { first_name: "A", company_name: "X" }, verificationStatus: "Unknown" }],
    alreadySent: ["a@x.example"],
  },
  {
    name: "a prospect missing the name the template needs",
    candidates: [{ id: "1", email: "a@x.example", values: { company_name: "X" }, verificationStatus: "Unknown" }],
  },
  {
    name: "a prospect missing a name, sent anyway",
    candidates: [{ id: "1", email: "a@x.example", values: { company_name: "X" }, verificationStatus: "Unknown" }],
    allowMissing: true,
  },
  {
    name: "whitespace-only data, which is missing data",
    candidates: [{ id: "1", email: "a@x.example", values: { first_name: "   ", company_name: "X" }, verificationStatus: "Unknown" }],
  },
  {
    name: "a blank address",
    candidates: [{ id: "1", email: "   ", values: { first_name: "A", company_name: "X" }, verificationStatus: "Unknown" }],
  },
  {
    name: "several reasons at once — the first rule wins",
    candidates: [{ id: "1", email: "a@x.example", values: {}, quarantined: true, verificationStatus: "Invalid" }],
    suppressed: ["a@x.example"],
  },
  {
    name: "a mixed list",
    candidates: [
      { id: "1", email: "ok@x.example", values: { first_name: "A", company_name: "X" }, verificationStatus: "Unknown" },
      { id: "2", email: "gone@x.example", values: { first_name: "B", company_name: "X" }, verificationStatus: "Unknown" },
      { id: "3", email: "held@x.example", values: { first_name: "C", company_name: "X" }, quarantined: true, verificationStatus: "Unknown" },
      { id: "4", email: "bad@x.example", values: { first_name: "D", company_name: "X" }, verificationStatus: "Invalid" },
      { id: "5", email: "thin@x.example", values: { company_name: "X" }, verificationStatus: "Unknown" },
    ],
    suppressed: ["gone@x.example"],
  },
];

const PARTS = { subject: "A question about {{company_name}}", body: "Hi {{first_name}}, ..." };

describe("the server and the browser agree on who may be written to", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const args = {
        candidates: c.candidates,
        parts: PARTS,
        suppressed: new Set(c.suppressed ?? []),
        alreadySent: new Set(c.alreadySent ?? []),
        allowMissing: !!c.allowMissing,
      };

      const a = server.buildAudience(args);
      const b = clientAudience(args);

      expect(a.send.map((r) => r.id), "who would be sent to").toEqual(b.send.map((r) => r.id));
      expect(
        a.excluded.map((e) => ({ id: e.id, reason: e.reason, missing: e.missing })),
        "who would be held back, and why",
      ).toEqual(b.excluded.map((e) => ({ id: e.id, reason: e.reason, missing: e.missing })));
    });
  }

  it("agrees about a misspelled variable", () => {
    const args = {
      candidates: [{ id: "1", email: "a@x.example", values: { first_name: "A" }, verificationStatus: "Unknown" }],
      parts: { subject: "Hi {{frist_name}}", body: "..." },
      allowMissing: true,
    };
    expect(server.buildAudience(args).unknownVariables)
      .toEqual(clientAudience(args).unknownVariables);
    expect(server.buildAudience(args).unknownVariables).toEqual(["frist_name"]);
  });
});

describe("the server and the browser agree on when to send", () => {
  const MOMENTS = [
    ["a Wednesday mid-morning", "2026-09-02T05:30:00Z"],
    ["the middle of the night", "2026-09-01T21:42:00Z"],
    ["exactly the closing hour", "2026-09-02T12:30:00Z"],
    ["a Saturday", "2026-09-05T05:30:00Z"],
    ["a Sunday at noon", "2026-09-06T06:30:00Z"],
    ["one minute before the opening hour", "2026-09-02T03:29:00Z"],
  ];

  for (const [name, iso] of MOMENTS) {
    it(name, () => {
      const args = {
        now: new Date(iso),
        schedule: DEFAULT_SCHEDULE,
        sentToday: 0,
        lastSentAt: null,
        batchLimit: 20,
      };
      expect(server.sendWindow(args)).toEqual(clientWindow(args));
    });
  }

  it("agrees when the daily cap is spent", () => {
    const args = {
      now: new Date("2026-09-02T05:30:00Z"),
      schedule: DEFAULT_SCHEDULE,
      sentToday: 50,
      lastSentAt: null,
      batchLimit: 20,
    };
    expect(server.sendWindow(args)).toEqual(clientWindow(args));
    expect(server.sendWindow(args).hold).toBe("daily-cap");
  });

  it("agrees when a message went out moments ago", () => {
    const now = new Date("2026-09-02T05:30:00Z");
    const args = {
      now,
      schedule: DEFAULT_SCHEDULE,
      sentToday: 1,
      lastSentAt: new Date(now.getTime() - 30_000),
      batchLimit: 20,
    };
    expect(server.sendWindow(args)).toEqual(clientWindow(args));
    expect(server.sendWindow(args).hold).toBe("too-soon");
  });

  /* The gap is an allowance, not a gate — both sides must earn sends from
     elapsed time identically, or the composer's estimate and what actually
     goes out drift apart. */
  for (const [label, ago, expected] of [
    ["one gap", 91_000, 1],
    ["five minutes", 300_000, 3],
    ["half an hour", 1_800_000, 20],
  ]) {
    it(`agrees how many sends ${label} has earned`, () => {
      const now = new Date("2026-09-02T05:30:00Z");
      const args = {
        now,
        schedule: DEFAULT_SCHEDULE,
        sentToday: 1,
        lastSentAt: new Date(now.getTime() - ago),
        batchLimit: 20,
      };
      expect(server.sendWindow(args)).toEqual(clientWindow(args));
      expect(server.sendWindow(args).allowed).toBe(expected);
    });
  }

  it("reads a campaign row's throttle into the shape the rules expect", () => {
    expect(server.scheduleOf({
      daily_cap: 25, min_gap_seconds: 120, send_from_hour: 10, send_to_hour: 17,
      send_days: [1, 2, 3], timezone: "Asia/Dubai",
    })).toEqual({
      dailyCap: 25, minGapSeconds: 120, sendFromHour: 10, sendToHour: 17,
      sendDays: [1, 2, 3], timezone: "Asia/Dubai",
    });
  });

  it("falls back to the safe defaults for a row with nothing set", () => {
    expect(server.scheduleOf({})).toEqual({
      dailyCap: 50, minGapSeconds: 90, sendFromHour: 9, sendToHour: 18,
      sendDays: [1, 2, 3, 4, 5], timezone: "Asia/Kolkata",
    });
  });
});

/* ── the unsubscribe line ──────────────────────────────────────────── */

describe("every campaign email carries a way out", () => {
  it("renders the unsubscribe footer into the HTML", () => {
    const html = renderHtml({ body: "Hello.", unsubscribe: "https://x.example/u?s=1" });
    expect(html).toContain("unsubscribe");
    expect(html).toContain("https://x.example/u?s=1");
  });

  /* The link needs the send row's id, which does not exist until the row is
     inserted — so launch stores a placeholder and the sender fills it in. */
  it("stores a placeholder at launch and substitutes the real link at send time", () => {
    const rendered = renderCampaignFor(
      { subject: "Hi {{first_name}}", body: "Hello {{first_name}}." },
      { first_name: "Ravi" },
    );
    expect(rendered.subject).toBe("Hi Ravi");
    expect(rendered.html).toContain(UNSUBSCRIBE_PLACEHOLDER);

    const out = withUnsubscribe({ id: "abc", subject: rendered.subject, body: rendered.body, html: rendered.html }, "https://crm.example");
    expect(out.html).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(out.html).toContain("outreach-unsubscribe?s=abc");
  });

  /* A plain-text-only client must still be able to opt out. */
  it("puts the link in the plain-text part too", () => {
    const out = withUnsubscribe({ id: "abc", subject: "S", body: "B", html: "" }, "https://crm.example");
    expect(out.message).toContain("outreach-unsubscribe?s=abc");
  });

  it("does not double the slash when the site URL has a trailing one", () => {
    expect(unsubscribeUrl("https://crm.example/", "abc"))
      .toBe("https://crm.example/.netlify/functions/outreach-unsubscribe?s=abc");
  });

  it("escapes a recipient's details rather than letting them close a tag", () => {
    const html = renderHtml({ body: 'Hello <script>alert("x")</script>', unsubscribe: "" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

/* ── the greeting fallback ─────────────────────────────────────────── */

describe("greeting somebody whose name is not known", () => {
  const parts = { subject: "Hi", body: "Hello {{first_name}}," };
  const nameless = [{ id: "1", email: "procurement@acme.example", values: { company_name: "Acme" }, verificationStatus: "Role-based" }];

  it("holds a nameless recipient back when the campaign has not asked for it", () => {
    const a = server.buildAudience({ candidates: nameless, parts });
    expect(a.send).toEqual([]);
    expect(a.excluded[0].reason).toBe("missing-data");
  });

  /* Applied BEFORE the rules, so the person is not missing a name rather
     than being excluded and then smuggled past the exclusion. */
  it("sends to them once it has been asked for, with a real greeting", () => {
    const candidates = nameless.map((c) => ({ ...c, values: server.withGreetingFallback(c.values, true) }));
    const a = server.buildAudience({ candidates, parts });
    expect(a.send).toHaveLength(1);
    expect(server.fill(parts.body, a.send[0].values).text).toBe("Hello there,");
  });

  it("never overwrites a name somebody actually has", () => {
    expect(server.withGreetingFallback({ first_name: "Ravi" }, true).first_name).toBe("Ravi");
  });

  it("does nothing at all unless the campaign asked", () => {
    expect(server.withGreetingFallback({ first_name: "" }, false).first_name).toBe("");
  });

  it("uses the same word as the browser does", async () => {
    const { GREETING_FALLBACK } = await import("../../src/domain/outreach/personalise");
    expect(server.GREETING_FALLBACK).toBe(GREETING_FALLBACK);
  });

  /* The failure this guards: the screen previews "Hello there," and the
     server renders "Hello {{first_name}}," into the email that goes out. */
  it("does not leave a literal variable in the rendered message", () => {
    const values = server.withGreetingFallback({ company_name: "Acme" }, true);
    const rendered = renderCampaignFor({ subject: "Hi", body: "Hello {{first_name}}," }, values);
    expect(rendered.body).toBe("Hello there,");
    expect(rendered.body).not.toContain("{{");
  });
});

/* ── the test send ─────────────────────────────────────────────────── */

describe("sending yourself a test", () => {
  /* An authenticated endpoint that sends to an address in the request is a
     relay: one leaked session and this company's domain delivers somebody
     else's mail. The recipient must come from the profile, server-side. */
  it("takes no recipient from the request at all", () => {
    const src = readFileSync(
      new URL("../functions/outreach-test-send.mjs", import.meta.url), "utf8",
    );
    /* The only assignment to `to` is from the caller's profile. */
    expect(src).toContain("const to = String(caller.profile?.email");
    expect(src).not.toMatch(/\bto\s*=\s*(?:String\()?body\./);
    expect(src).not.toMatch(/body\.(to|recipient|email)\b/);
  });

  it("never writes to the send queue, so a test cannot spend the day's limit", () => {
    const src = readFileSync(
      new URL("../functions/outreach-test-send.mjs", import.meta.url), "utf8",
    );
    /* The table is NAMED in a comment saying it is not written to, so this
       looks for the call rather than the word. */
    expect(src).not.toMatch(/\.from\(\s*["']outreach_sends["']/);
    expect(src).not.toMatch(/\.from\(\s*["']outreach_campaigns["']\s*\)[\s\S]{0,200}\.update\(/);
    expect(src).not.toMatch(/last_contacted_at/);
  });

  it("checks the mailbox is one the caller may send from", () => {
    const src = readFileSync(
      new URL("../functions/outreach-test-send.mjs", import.meta.url), "utf8",
    );
    expect(src).toContain("may_manage_email_account");
  });

  it("marks the subject so a test cannot be mistaken for a real send", () => {
    const src = readFileSync(
      new URL("../functions/outreach-test-send.mjs", import.meta.url), "utf8",
    );
    expect(src).toContain("[Test]");
  });
});
