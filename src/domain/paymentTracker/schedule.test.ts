import { describe, expect, it } from "vitest";
import * as ts from "./schedule";
// @ts-expect-error — plain JS module, the server's copy of the same rules
import * as mjs from "../../../netlify/lib/paymentRules.mjs";

const bill = (dueDate: string, over: Partial<ts.BillForReminder> = {}): ts.BillForReminder => ({
  status: "open", dueDate, amount: 100000, amountPaid: 0, remindersOn: true, pausedUntil: null, ...over,
});

const due = "2026-10-20";
const day = (n: number) => ts.dueDateFor(due, n);

/* [days relative to due date, expected step key or null] */
const CASES: [number, string | null][] = [
  [-10, null], [-8, null],
  [-7, "d-7"], [-3, "d-7"],
  [0, "d0"], [2, "d0"],
  [3, "d+3"], [6, "d+3"],
  [7, "d+7"], [14, "d+7"],
  [15, "d+15"], [29, "d+15"],
  [30, "d+30"], [44, "d+30"],
  [45, "d+45"], [59, "d+45"], [60, "d+60"], [200, "d+195"],
];

describe("payment tracker schedule — both copies agree", () => {
  for (const impl of [ts, mjs] as const) {
    const name = impl === ts ? "app" : "server";
    it.each(CASES)(`${name}: %i days from due → %s`, (offset, expected) => {
      const step = impl.stepDueToday(bill(due), day(offset));
      expect(step ? step.key : null).toBe(expected);
    });
  }

  it("server and app give the same tone for every step", () => {
    for (const [offset] of CASES) {
      expect(mjs.stepDueToday(bill(due), day(offset))?.tone).toBe(ts.stepDueToday(bill(due), day(offset))?.tone);
    }
  });
});

describe("when not to remind", () => {
  it("paid in full", () => {
    expect(ts.stepDueToday(bill(due, { amountPaid: 100000 }), day(5))).toBeNull();
  });
  it("part-paid still gets reminded", () => {
    expect(ts.stepDueToday(bill(due, { amountPaid: 40000 }), day(5))?.key).toBe("d+3");
  });
  it("marked paid or written off", () => {
    expect(ts.stepDueToday(bill(due, { status: "paid" }), day(5))).toBeNull();
    expect(ts.stepDueToday(bill(due, { status: "written_off" }), day(5))).toBeNull();
  });
  it("reminders switched off", () => {
    expect(ts.stepDueToday(bill(due, { remindersOn: false }), day(5))).toBeNull();
  });
  it("paused until a promised date, then resumes the day after", () => {
    const paused = bill(due, { pausedUntil: day(10) });
    expect(ts.stepDueToday(paused, day(10))).toBeNull();
    expect(ts.stepDueToday(paused, day(11))?.key).toBe("d+7");
    expect(mjs.stepDueToday(paused, day(10))).toBeNull();
  });
});

describe("tones", () => {
  it("get firmer as the bill ages", () => {
    expect(ts.toneFor(-7)).toBe("upcoming");
    expect(ts.toneFor(0)).toBe("due");
    expect(ts.toneFor(3)).toBe("overdue");
    expect(ts.toneFor(15)).toBe("firm");
    expect(ts.toneFor(30)).toBe("final");
    expect(ts.toneFor(60)).toBe("final");
  });
});

describe("dates", () => {
  it("due date is invoice date plus credit days", () => {
    expect(ts.dueDateFor("2026-10-01", 30)).toBe("2026-10-31");
    expect(ts.dueDateFor("2026-10-01", 60)).toBe("2026-11-30");
    expect(ts.dueDateFor("2026-12-15", 45)).toBe("2027-01-29");
  });
  it("next reminder date", () => {
    expect(ts.nextReminderDate(bill(due), "2026-10-01")).toBe("2026-10-13");
    expect(ts.nextReminderDate(bill(due), "2026-10-14")).toBe("2026-10-20");
    expect(ts.nextReminderDate(bill(due), "2026-11-25")).toBe("2026-12-04");
    expect(ts.nextReminderDate(bill(due, { status: "paid" }), "2026-10-14")).toBeNull();
  });
  it("standing", () => {
    expect(ts.standingOf(bill(due), "2026-10-01")).toBe("upcoming");
    expect(ts.standingOf(bill(due), "2026-10-15")).toBe("due_soon");
    expect(ts.standingOf(bill(due), due)).toBe("due_today");
    expect(ts.standingOf(bill(due), "2026-10-25")).toBe("overdue");
    expect(ts.standingOf(bill(due), "2026-12-25")).toBe("critical");
  });
});

describe("server schedule settings are cleaned", () => {
  it("falls back when nonsense is stored", () => {
    expect(mjs.scheduleFrom(null)).toEqual(mjs.DEFAULT_SCHEDULE);
    expect(mjs.scheduleFrom({ offsets: ["x"], repeatEvery: -4 })).toEqual(mjs.DEFAULT_SCHEDULE);
    expect(mjs.scheduleFrom({ offsets: [10, -3, 10], repeatEvery: 7 })).toEqual({ offsets: [-3, 10], repeatEvery: 7 });
  });
});

describe("what the screen shows as the next reminder", () => {
  it("today, when today's step has not been sent", () => {
    expect(ts.upcomingReminder(bill(due), day(48), new Set())).toBe(day(48));
  });
  it("the next date, once today's step is in the log", () => {
    expect(ts.upcomingReminder(bill(due), day(48), new Set(["d+45"]))).toBe(day(60));
  });
  it("while paused, the day after the pause", () => {
    expect(ts.upcomingReminder(bill(due, { pausedUntil: day(20) }), day(16), new Set())).toBe(day(21));
  });
  it("while paused, but that step already went before the pause: the next one", () => {
    expect(ts.upcomingReminder(bill(due, { pausedUntil: day(20) }), day(16), new Set(["d+15"]))).toBe(day(30));
  });
});
