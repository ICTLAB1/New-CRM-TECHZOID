import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_CAP, MAX_DAILY_CAP, allowanceFor, dailyCapFrom, sentTodayCount, spentMessage,
} from "./profileSendLimit.mjs";

/* A stand-in for the one query this module makes: a count of today's sent
   rows for one company. It records what it was asked, because WHICH rows
   are counted is the whole correctness of the thing. */
function makeClient(rows = []) {
  const asked = {};
  const client = {
    from(table) {
      asked.table = table;
      const q = {
        select(_cols, opts) { asked.head = !!opts?.head; asked.count = opts?.count; return q; },
        eq(col, val) { (asked.eq ??= {})[col] = val; return q; },
        gte(col, val) { (asked.gte ??= {})[col] = val; return q; },
        then(res) {
          const matched = rows.filter((r) =>
            Object.entries(asked.eq ?? {}).every(([c, v]) => r[c] === v)
            && Object.entries(asked.gte ?? {}).every(([c, v]) => String(r[c]) >= String(v)));
          return Promise.resolve({ count: matched.length, error: null }).then(res);
        },
      };
      return q;
    },
  };
  return { client, asked };
}

describe("what a company allows itself", () => {
  it("uses a deliberately low default when nobody has chosen", () => {
    expect(dailyCapFrom({})).toBe(DEFAULT_DAILY_CAP);
    expect(dailyCapFrom(undefined)).toBe(DEFAULT_DAILY_CAP);
    expect(dailyCapFrom({ profile: {} })).toBe(DEFAULT_DAILY_CAP);
  });

  it("takes the company's own number when it has set one", () => {
    expect(dailyCapFrom({ profile: { dailySendLimit: 75 } })).toBe(75);
  });

  /* A limit that can be set to zero, or to minus one, or to "lots" is not a
     limit. Every one of these falls back to the default rather than to
     "unlimited", which is the direction a mistake has to fail in. */
  it("falls back to the default rather than to no limit at all", () => {
    for (const bad of [0, -5, "", "lots", null, NaN, Infinity]) {
      expect(dailyCapFrom({ profile: { dailySendLimit: bad } }), String(bad)).toBe(DEFAULT_DAILY_CAP);
    }
  });

  it("will not let the field be raised past what a business mailbox should send", () => {
    expect(dailyCapFrom({ profile: { dailySendLimit: 5000 } })).toBe(MAX_DAILY_CAP);
  });

  it("rounds a fraction down, so 10.9 never means eleven", () => {
    expect(dailyCapFrom({ profile: { dailySendLimit: 10.9 } })).toBe(10);
  });
});

describe("how many went today", () => {
  const COMPANY = "co-1";
  const now = new Date("2026-11-18T06:00:00Z"); // 11:30 on the 18th in India

  it("counts only this company's successful sends", async () => {
    const { client, asked } = makeClient([]);
    await sentTodayCount(client, COMPANY, now);
    expect(asked.table).toBe("profile_sends");
    expect(asked.eq).toMatchObject({ company_id: COMPANY, status: "sent" });
    /* A head count, not the rows: this runs before every send and has no
       use for the bodies. */
    expect(asked.head).toBe(true);
  });

  /* THE DAY IS THE BUSINESS'S, NOT UTC'S. Midnight UTC is half past five in
     the evening in India, so a UTC day would hand a second full allowance
     to anyone who waited until after tea. */
  it("starts the day at midnight in India, not at midnight UTC", async () => {
    const { client, asked } = makeClient([]);
    await sentTodayCount(client, COMPANY, now);
    expect(asked.gte.created_at).toBe(new Date("2026-11-17T18:30:00Z").toISOString());
  });

  it("counts what is inside the day and ignores what is not", async () => {
    const rows = [
      { company_id: COMPANY, status: "sent", created_at: "2026-11-18T05:00:00Z" },   // today
      { company_id: COMPANY, status: "sent", created_at: "2026-11-17T19:00:00Z" },   // today (after 00:00 IST)
      { company_id: COMPANY, status: "sent", created_at: "2026-11-17T17:00:00Z" },   // yesterday in India
      { company_id: COMPANY, status: "failed", created_at: "2026-11-18T05:00:00Z" }, // never reached anybody
      { company_id: "co-2", status: "sent", created_at: "2026-11-18T05:00:00Z" },    // another company
    ];
    const { client } = makeClient(rows);
    expect(await sentTodayCount(client, COMPANY, now)).toBe(2);
  });
});

describe("what is left of today", () => {
  const now = new Date("2026-11-18T06:00:00Z");
  const sentRows = (n) => Array.from({ length: n }, () => ({
    company_id: "co-1", status: "sent", created_at: "2026-11-18T05:00:00Z",
  }));

  it("is the whole allowance before anything has gone", async () => {
    const { client } = makeClient([]);
    expect(await allowanceFor(client, "co-1", {}, now))
      .toEqual({ cap: DEFAULT_DAILY_CAP, sentToday: 0, remaining: DEFAULT_DAILY_CAP });
  });

  it("shrinks as the day is used", async () => {
    const { client } = makeClient(sentRows(12));
    const out = await allowanceFor(client, "co-1", { profile: { dailySendLimit: 20 } }, now);
    expect(out).toEqual({ cap: 20, sentToday: 12, remaining: 8 });
  });

  /* Never negative. A company whose limit was lowered below what it had
     already sent today has nothing left, not minus six left — and anything
     reading `remaining` to slice a list would take six off the END of it. */
  it("never goes below nothing, even when the limit is lowered mid-day", async () => {
    const { client } = makeClient(sentRows(30));
    const out = await allowanceFor(client, "co-1", { profile: { dailySendLimit: 24 } }, now);
    expect(out.remaining).toBe(0);
  });
});

describe("what the sender is told when the day is spent", () => {
  const said = spentMessage({ cap: 40, sentToday: 40 });

  it("names the numbers rather than saying 'limit reached'", () => {
    expect(said).toContain("40 of 40");
  });

  /* The next thing somebody does with a bare refusal is press Send again.
     The message has to say why it exists, when it lifts, and where it is
     changed — otherwise it reads as a fault in the CRM. */
  it("says why there is a limit, when it lifts, and where to change it", () => {
    expect(said).toMatch(/domain/i);
    expect(said).toMatch(/midnight/i);
    expect(said).toMatch(/Settings/);
  });
});
