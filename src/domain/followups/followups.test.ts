import { describe, expect, it } from "vitest";
import {
  autoFollowUpsOn, DEFAULT_FOLLOWUP_STEPS, describeSchedule, dueFollowUps, followUpBody,
  followUpSubject, planFollowUps, readSteps, stopReason, type FollowUp,
} from "./followups";

const SENT = "2026-08-24";

const row = (o: Partial<FollowUp> = {}): FollowUp => ({
  id: "f1", docType: "quotation", docId: "q1", docNumber: "TZ/QT/2627/0117",
  ownerId: "u1", step: 1, steps: 3, tone: "nudge", dueOn: "2026-08-27",
  state: "scheduled", to: "buyer@example.com", subject: "s", message: "m", ...o,
});

describe("planning a sequence", () => {
  it("lands the shipped cadence on the days it says", () => {
    expect(planFollowUps(SENT).map((s) => s.dueOn)).toEqual(["2026-08-27", "2026-08-31", "2026-09-07"]);
  });

  it("numbers the steps for a reader, not for an array", () => {
    expect(planFollowUps(SENT).map((s) => s.step)).toEqual([1, 2, 3]);
  });

  it("stops at the validity date rather than moving a step onto it", () => {
    // A chaser arriving after validity asks the customer to accept a
    // quotation that has expired.
    expect(planFollowUps(SENT, DEFAULT_FOLLOWUP_STEPS, "2026-09-01").map((s) => s.dueOn))
      .toEqual(["2026-08-27", "2026-08-31"]);
  });

  it("plans nothing at all when the quotation has no room to be chased", () => {
    // Honest, and better than one chaser on the morning it lapses.
    expect(planFollowUps(SENT, DEFAULT_FOLLOWUP_STEPS, "2026-08-26")).toEqual([]);
  });

  it("never sends two on one day", () => {
    const steps = [
      { afterDays: 3, tone: "nudge" as const },
      { afterDays: 3, tone: "check" as const },
      { afterDays: 9, tone: "final" as const },
    ];
    expect(planFollowUps(SENT, steps).map((s) => s.dueOn)).toEqual(["2026-08-27", "2026-09-02"]);
  });

  it("throws out a step that is not a number of days", () => {
    const steps = [{ afterDays: NaN, tone: "nudge" as const }, { afterDays: 5, tone: "check" as const }];
    expect(planFollowUps(SENT, steps).map((s) => s.dueOn)).toEqual(["2026-08-29"]);
  });

  it("orders by date whatever order the cadence was written in", () => {
    const steps = [{ afterDays: 10, tone: "final" as const }, { afterDays: 2, tone: "nudge" as const }];
    expect(planFollowUps(SENT, steps).map((s) => s.tone)).toEqual(["nudge", "final"]);
  });
});

describe("what is due", () => {
  const rows = [
    row({ id: "a", dueOn: "2026-08-20" }),
    row({ id: "b", dueOn: "2026-08-24" }),
    row({ id: "c", dueOn: "2026-09-01" }),
    row({ id: "d", dueOn: "2026-08-01", state: "sent" }),
    row({ id: "e", dueOn: "2026-08-01", state: "cancelled" }),
  ];

  it("includes today and everything behind it, oldest first", () => {
    // A day the scheduler was down is not a reason to skip a customer.
    expect(dueFollowUps(rows, "2026-08-24").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("leaves the future alone", () => {
    expect(dueFollowUps(rows, "2026-08-24").map((r) => r.id)).not.toContain("c");
  });

  it("never sends one twice, or one somebody stopped", () => {
    const ids = dueFollowUps(rows, "2026-09-30").map((r) => r.id);
    expect(ids).not.toContain("d");
    expect(ids).not.toContain("e");
  });
});

describe("when to stop chasing", () => {
  it("keeps going while the document is out with the customer", () => {
    expect(stopReason({ status: "Sent" })).toBeNull();
    expect(stopReason({ status: "Issued" })).toBeNull();
  });

  it("stops the moment somebody moves it on, and says why", () => {
    expect(stopReason({ status: "Accepted" })).toBe("the customer accepted it");
    expect(stopReason({ status: "Rejected" })).toBe("the customer turned it down");
    expect(stopReason({ status: "Expired" })).toBe("it has expired");
    expect(stopReason({ status: "Draft" })).toBe("it is back to a draft");
  });

  it("stops rather than guessing at a status it does not know", () => {
    expect(stopReason({ status: "Cancelled" })).toBe("its status is now Cancelled");
    expect(stopReason({})).toBe("it is back to a draft");
  });
});

describe("what a follow-up says", () => {
  const facts = {
    label: "Quotation", number: "TZ/QT/2627/0117", date: "24 Aug 2026",
    validUntil: "23 Sept 2026", contact: "Rajesh Kumar", senderName: "Priyanshi Sharma",
  };

  it("names the document, the date it went and who is writing", () => {
    const body = followUpBody("nudge", facts);
    expect(body).toContain("Dear Rajesh Kumar,");
    expect(body).toContain("TZ/QT/2627/0117");
    expect(body).toContain("24 Aug 2026");
    expect(body.trimEnd().endsWith("Priyanshi Sharma")).toBe(true);
  });

  it("NEVER claims the customer has not replied", () => {
    // Nothing in this product can read a mailbox, so that sentence is a
    // guess — and it is humiliating on the day it is wrong.
    for (const tone of ["nudge", "check", "final"] as const) {
      const body = followUpBody(tone, facts).toLowerCase();
      expect(body).not.toContain("haven't heard");
      expect(body).not.toContain("have not heard");
      expect(body).not.toContain("no response");
      expect(body).not.toContain("did not reply");
      expect(body).not.toContain("still waiting");
    }
  });

  it("names only the validity the document itself carries", () => {
    expect(followUpBody("final", facts)).toContain("23 Sept 2026");
    const undated = followUpBody("final", { ...facts, validUntil: null });
    expect(undated).not.toContain("valid until");
    expect(undated).toContain("re-issued with current pricing");
  });

  it("opens with no greeting rather than a greeting to nobody", () => {
    // "Dear Sir/Madam" announces that the sender did not know who they were
    // writing to.
    const body = followUpBody("nudge", { ...facts, contact: undefined });
    expect(body.startsWith("I wanted to make sure")).toBe(true);
    expect(body).not.toContain("Dear");
  });

  it("gives each tone a different ask", () => {
    const bodies = (["nudge", "check", "final"] as const).map((t) => followUpBody(t, facts));
    expect(new Set(bodies).size).toBe(3);
    expect(bodies[1]).toContain("call");
    expect(bodies[2]).toContain("stop chasing");
  });

  it("keeps the number in the subject so it threads with the original", () => {
    expect(followUpSubject("nudge", facts)).toContain("TZ/QT/2627/0117");
    expect(followUpSubject("final", facts)).toContain("TZ/QT/2627/0117");
  });
});

describe("describing a schedule", () => {
  it("says what is coming and when", () => {
    const rows = [row({ dueOn: "2026-08-27" }), row({ id: "f2", dueOn: "2026-08-31" })];
    expect(describeSchedule(rows, "2026-08-24")).toBe("2 follow-ups scheduled — next on 27 Aug 2026.");
  });

  it("counts what has already gone", () => {
    const rows = [row({ state: "sent" }), row({ id: "f2", dueOn: "2026-08-31" })];
    expect(describeSchedule(rows, "2026-08-24")).toBe("1 follow-up scheduled — next on 31 Aug 2026, 1 already sent.");
  });

  it("says plainly when there is nothing left", () => {
    expect(describeSchedule([], "2026-08-24")).toBe("No follow-ups scheduled.");
    expect(describeSchedule([row({ state: "sent" })], "2026-08-24"))
      .toBe("1 follow-up sent. Nothing further scheduled.");
  });

  it("does not say a due one is in the future", () => {
    expect(describeSchedule([row({ dueOn: "2026-08-24" })], "2026-08-24"))
      .toBe("1 follow-up scheduled — next due today.");
  });
});

describe("a configured cadence", () => {
  it("falls back to the shipped one when there is nothing stored", () => {
    expect(readSteps(undefined)).toEqual(DEFAULT_FOLLOWUP_STEPS);
    expect(readSteps([])).toEqual(DEFAULT_FOLLOWUP_STEPS);
    expect(readSteps("3,7,14")).toEqual(DEFAULT_FOLLOWUP_STEPS);
  });

  it("throws out a step nobody could have meant", () => {
    // Half-read cadence means a customer emailed on a day nobody chose.
    expect(readSteps([{ afterDays: 0, tone: "nudge" }, { afterDays: 400, tone: "final" }, { afterDays: 5, tone: "check" }]))
      .toEqual([{ afterDays: 5, tone: "check" }]);
  });

  it("sorts and caps what it keeps", () => {
    const many = [9, 1, 7, 3, 5, 11, 13].map((afterDays) => ({ afterDays, tone: "check" }));
    expect(readSteps(many).map((s) => s.afterDays)).toEqual([1, 3, 5, 7, 9]);
  });
});

describe("the workspace switch", () => {
  it("is on until somebody turns it off", () => {
    expect(autoFollowUpsOn({})).toBe(true);
    expect(autoFollowUpsOn({ autoFollowUps: true })).toBe(true);
    expect(autoFollowUpsOn({ autoFollowUps: false })).toBe(false);
  });
});
