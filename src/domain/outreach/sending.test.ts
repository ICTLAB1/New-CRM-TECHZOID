import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE, EXCLUSION_LABELS, audienceSummary, buildAudience,
  excludedByReason, localParts, perHourCeiling, sendWindow, workingDaysNeeded,
  type Candidate, type Schedule,
} from "./sending";

const parts = { subject: "A question about {{company_name}}", body: "Hi {{first_name}}, ..." };

const person = (over: Partial<Candidate> & { id: string; email: string }): Candidate => ({
  values: { first_name: "Ravi", company_name: "Acme" },
  /* What a freshly imported prospect actually carries: local verification
     cannot prove an address is deliverable, so it never returns "Valid". */
  verificationStatus: "Unknown",
  ...over,
});

/* ── who gets written to ───────────────────────────────────────────── */

describe("deciding who a campaign may write to", () => {
  it("sends to a clean, complete prospect", () => {
    const a = buildAudience({ candidates: [person({ id: "1", email: "ravi@acme.example" })], parts });
    expect(a.send.map((r) => r.email)).toEqual(["ravi@acme.example"]);
    expect(a.excluded).toEqual([]);
  });

  /* THE RULE WITH A LEGAL EDGE. Somebody who unsubscribed must not receive
     another campaign, and there is deliberately no argument to override it. */
  it("never writes to a suppressed address, whatever else is true of them", () => {
    const a = buildAudience({
      candidates: [person({ id: "1", email: "ravi@acme.example", verificationStatus: "Valid" })],
      parts,
      suppressed: new Set(["ravi@acme.example"]),
      allowMissing: true,
    });
    expect(a.send).toEqual([]);
    expect(a.excluded[0]!.reason).toBe("suppressed");
  });

  it("matches the suppression list regardless of case or stray spacing", () => {
    const a = buildAudience({
      candidates: [person({ id: "1", email: "  Ravi@Acme.Example " })],
      parts,
      suppressed: new Set(["ravi@acme.example"]),
    });
    expect(a.excluded[0]!.reason).toBe("suppressed");
  });

  it("holds back a quarantined prospect until somebody clears it", () => {
    const a = buildAudience({
      candidates: [person({ id: "1", email: "ravi@acme.example", quarantined: true })],
      parts,
    });
    expect(a.excluded[0]!.reason).toBe("quarantined");
  });

  it("will not write to an address verification rejected", () => {
    const a = buildAudience({
      candidates: [person({ id: "1", email: "ravi@acme.example", verificationStatus: "Invalid" })],
      parts,
    });
    expect(a.excluded[0]!.reason).toBe("unverified");
  });

  /* In this business procurement@ and it@ are frequently the RIGHT person to
     write to, so verify.ts leaves them eligible and this must not undo it. */
  it("still writes to a role address like procurement@", () => {
    const a = buildAudience({
      candidates: [person({ id: "1", email: "procurement@acme.example", verificationStatus: "Role-based" })],
      parts,
    });
    expect(a.send).toHaveLength(1);
  });

  it("does not write to the same person twice in one campaign", () => {
    const a = buildAudience({
      candidates: [person({ id: "1", email: "ravi@acme.example" })],
      parts,
      alreadySent: new Set(["ravi@acme.example"]),
    });
    expect(a.excluded[0]!.reason).toBe("already-sent");
  });

  /* "Hello ," in a stranger's inbox says plainly that nobody checked. */
  it("holds back a prospect whose details would leave a hole, and names the field", () => {
    const a = buildAudience({
      candidates: [person({ id: "1", email: "x@acme.example", values: { company_name: "Acme" } })],
      parts,
    });
    expect(a.send).toEqual([]);
    expect(a.excluded[0]!).toMatchObject({ reason: "missing-data", missing: ["first_name"] });
  });

  it("sends anyway when somebody deliberately chooses to", () => {
    const a = buildAudience({
      candidates: [person({ id: "1", email: "x@acme.example", values: { company_name: "Acme" } })],
      parts,
      allowMissing: true,
    });
    expect(a.send).toHaveLength(1);
    expect(a.excluded).toEqual([]);
  });

  it("reports the first reason when several apply, in the order the rules are written", () => {
    const a = buildAudience({
      candidates: [person({
        id: "1", email: "ravi@acme.example", quarantined: true, verificationStatus: "Invalid",
        values: {},
      })],
      parts,
      suppressed: new Set(["ravi@acme.example"]),
    });
    expect(a.excluded).toHaveLength(1);
    expect(a.excluded[0]!.reason).toBe("suppressed");
  });

  it("flags a misspelled variable once for the campaign, not once per person", () => {
    const a = buildAudience({
      candidates: [person({ id: "1", email: "a@x.example" }), person({ id: "2", email: "b@x.example" })],
      parts: { subject: "Hi {{frist_name}}", body: "..." },
      allowMissing: true,
    });
    expect(a.unknownVariables).toEqual(["frist_name"]);
  });

  /* A count that does not add up is how people stop trusting a tool. */
  it("puts every candidate in exactly one list", () => {
    const candidates = [
      person({ id: "1", email: "ok@acme.example" }),
      person({ id: "2", email: "gone@acme.example" }),
      person({ id: "3", email: "held@acme.example", quarantined: true }),
      person({ id: "4", email: "bad@acme.example", verificationStatus: "Invalid" }),
      person({ id: "5", email: "thin@acme.example", values: {} }),
    ];
    const a = buildAudience({ candidates, parts, suppressed: new Set(["gone@acme.example"]) });
    const summary = audienceSummary(a);
    expect(summary.total).toBe(candidates.length);
    expect(summary.sending + summary.excluded).toBe(candidates.length);
    expect(new Set([...a.send.map((r) => r.id), ...a.excluded.map((e) => e.id)]).size).toBe(candidates.length);
  });

  it("groups the exclusions so a screen can explain the shortfall", () => {
    const a = buildAudience({
      candidates: [
        person({ id: "1", email: "a@x.example" }),
        person({ id: "2", email: "b@x.example", quarantined: true }),
        person({ id: "3", email: "c@x.example", quarantined: true }),
      ],
      parts,
    });
    expect(excludedByReason(a)).toEqual([
      { reason: "quarantined", label: EXCLUSION_LABELS.quarantined, count: 2 },
    ]);
  });

  it("treats a blank address as suppressed rather than sending into the void", () => {
    const a = buildAudience({ candidates: [person({ id: "1", email: "   " })], parts });
    expect(a.excluded[0]!.reason).toBe("suppressed");
  });
});

/* ── how fast, and when ────────────────────────────────────────────── */

/* Wednesday 2 September 2026, 11:00 in India (05:30 UTC). */
const WED_11AM = new Date("2026-09-02T05:30:00Z");
const base = { schedule: DEFAULT_SCHEDULE, sentToday: 0, lastSentAt: null, batchLimit: 25 };

describe("deciding how many may go out right now", () => {
  it("reads the wall clock in the campaign's timezone, not the server's", () => {
    /* 21:00 UTC on a Tuesday is already Wednesday 02:30 in India. A server
       in UTC would call this Tuesday evening and send. */
    expect(localParts(new Date("2026-09-01T21:00:00Z"), "Asia/Kolkata"))
      .toEqual({ weekday: 3, hour: 2, date: "2026-09-02" });
  });

  it("sends during the working day", () => {
    expect(sendWindow({ now: WED_11AM, ...base })).toEqual({ allowed: 25 });
  });

  it("stays quiet overnight — nobody believes an email that arrives at 03:12", () => {
    const threeAm = new Date("2026-09-01T21:42:00Z"); // 03:12 IST Wednesday
    expect(sendWindow({ now: threeAm, ...base })).toEqual({ allowed: 0, hold: "outside-hours" });
  });

  it("stops at the closing hour rather than sending through it", () => {
    const sixPm = new Date("2026-09-02T12:30:00Z"); // 18:00 IST exactly
    expect(sendWindow({ now: sixPm, ...base }).hold).toBe("outside-hours");
  });

  it("does not send at the weekend by default", () => {
    const saturday = new Date("2026-09-05T05:30:00Z"); // Sat 11:00 IST
    expect(sendWindow({ now: saturday, ...base }).hold).toBe("not-a-sending-day");
  });

  it("sends at the weekend when a campaign asks for it", () => {
    const saturday = new Date("2026-09-05T05:30:00Z");
    const schedule: Schedule = { ...DEFAULT_SCHEDULE, sendDays: [1, 2, 3, 4, 5, 6, 7] };
    expect(sendWindow({ now: saturday, ...base, schedule }).allowed).toBe(25);
  });

  /* The rule that protects the company's real mailbox. */
  it("stops at the daily cap", () => {
    expect(sendWindow({ now: WED_11AM, ...base, sentToday: 50 }))
      .toEqual({ allowed: 0, hold: "daily-cap" });
  });

  it("never offers more than the cap has left", () => {
    expect(sendWindow({ now: WED_11AM, ...base, sentToday: 47 }).allowed).toBe(3);
  });

  it("never offers more than one run can finish", () => {
    expect(sendWindow({ now: WED_11AM, ...base, batchLimit: 5 }).allowed).toBe(5);
  });

  it("waits out the gap between two messages", () => {
    const justSent = new Date(WED_11AM.getTime() - 30_000);
    expect(sendWindow({ now: WED_11AM, ...base, lastSentAt: justSent }))
      .toEqual({ allowed: 0, hold: "too-soon" });
  });

  /* THE GAP IS AN ALLOWANCE, NOT A GATE, and treating it as a gate was a bug:
     a run either sent nothing or sent its whole batch back to back, so "90
     seconds between messages" was true of the first message of a run and
     false of every one after it. */
  it("earns exactly one send when one gap has passed", () => {
    const oneGap = new Date(WED_11AM.getTime() - 91_000);
    expect(sendWindow({ now: WED_11AM, ...base, lastSentAt: oneGap }).allowed).toBe(1);
  });

  it("earns more as more time passes, so a pause catches up", () => {
    const fiveMinutes = new Date(WED_11AM.getTime() - 5 * 60_000);
    /* Five minutes at ninety seconds apart is three. */
    expect(sendWindow({ now: WED_11AM, ...base, lastSentAt: fiveMinutes }).allowed).toBe(3);
  });

  it("never lets catching up outrun the batch", () => {
    const anHour = new Date(WED_11AM.getTime() - 3600_000);
    expect(sendWindow({ now: WED_11AM, ...base, lastSentAt: anHour, batchLimit: 5 }).allowed).toBe(5);
  });

  it("never lets catching up outrun the daily cap", () => {
    const anHour = new Date(WED_11AM.getTime() - 3600_000);
    expect(sendWindow({ now: WED_11AM, ...base, lastSentAt: anHour, sentToday: 48 }).allowed).toBe(2);
  });

  /* A campaign that has never sent has nothing to space itself from. */
  it("lets the first message go without waiting", () => {
    expect(sendWindow({ now: WED_11AM, ...base, lastSentAt: null }).allowed).toBe(25);
  });

  it("holds on the day before the hours — a Sunday at noon is not a sending day", () => {
    const sunday = new Date("2026-09-06T06:30:00Z"); // Sun 12:00 IST
    expect(sendWindow({ now: sunday, ...base }).hold).toBe("not-a-sending-day");
  });
});

describe("telling somebody how long a campaign will take", () => {
  it("counts the gap, not just the daily cap", () => {
    /* 9 hours at 90 seconds apart is 360 — well above the cap of 50, so the
       cap is what binds. */
    expect(perHourCeiling(DEFAULT_SCHEDULE)).toBe(360);
    expect(workingDaysNeeded(400, DEFAULT_SCHEDULE)).toBe(8);
  });

  it("lets the gap bind when it is the tighter of the two", () => {
    const slow: Schedule = { ...DEFAULT_SCHEDULE, dailyCap: 500, minGapSeconds: 3600 };
    expect(perHourCeiling(slow)).toBe(9);
    expect(workingDaysNeeded(400, slow)).toBe(45);
  });

  it("says one day for a campaign that fits in one", () => {
    expect(workingDaysNeeded(10, DEFAULT_SCHEDULE)).toBe(1);
  });

  it("says nothing is needed for nothing left", () => {
    expect(workingDaysNeeded(0, DEFAULT_SCHEDULE)).toBe(0);
  });
});
