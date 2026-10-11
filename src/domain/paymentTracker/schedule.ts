/**
 * Payment Tracker — when a bill falls due, and which reminder is owed today.
 *
 * Pure: `today` is always passed in. No I/O, no clock.
 *
 * A DELIBERATE SECOND COPY lives in netlify/lib/paymentRules.mjs, because the
 * reminder engine runs as plain JavaScript on the server and cannot import
 * TypeScript. Both copies run the same cases in schedule.test.ts, so if one
 * moves without the other the tests fail.
 */

export interface ReminderSchedule {
  /** Days relative to the due date: negative = before, 0 = on the day. */
  offsets: number[];
  /** After the last offset, keep reminding every N days until paid. 0 = stop. */
  repeatEvery: number;
}

/** 7 days before, on the day, then 3, 7, 15 and 30 days overdue. */
export const DEFAULT_SCHEDULE: ReminderSchedule = {
  offsets: [-7, 0, 3, 7, 15, 30],
  repeatEvery: 15,
};

export type ReminderTone = "upcoming" | "due" | "overdue" | "firm" | "final";

export interface BillForReminder {
  status: string;
  dueDate: string;
  amount: number;
  amountPaid: number;
  remindersOn: boolean;
  pausedUntil?: string | null;
}

const MS_PER_DAY = 86_400_000;

/** Whole calendar days from `fromISO` to `toISO`. */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

/** Invoice date + credit days. */
export function dueDateFor(invoiceDate: string, creditDays: number): string {
  const t = Date.parse(invoiceDate + "T00:00:00Z");
  if (!Number.isFinite(t)) return invoiceDate;
  return new Date(t + Math.round(creditDays || 0) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The key a step is logged under: "d-7", "d0", "d+3", "d+45". */
export function stepKey(offset: number): string {
  return offset === 0 ? "d0" : offset > 0 ? `d+${offset}` : `d${offset}`;
}

export function toneFor(offset: number, schedule: ReminderSchedule = DEFAULT_SCHEDULE): ReminderTone {
  if (offset < 0) return "upcoming";
  if (offset === 0) return "due";
  const last = Math.max(...schedule.offsets);
  if (offset >= last && last > 0) return "final";
  if (offset >= 15) return "firm";
  return "overdue";
}

export function outstandingOf(bill: Pick<BillForReminder, "amount" | "amountPaid">): number {
  return Math.max(0, Math.round(((Number(bill.amount) || 0) - (Number(bill.amountPaid) || 0)) * 100) / 100);
}

/**
 * The step owed today, or null.
 *
 * It is the LATEST step whose day has arrived — never a backlog. A bill
 * entered 20 days overdue gets the "15 days overdue" message once, not the
 * five earlier ones in a burst. Whether that step was already sent is the
 * log's business (one row per bill, step and channel), not this function's.
 */
export function stepDueToday(
  bill: BillForReminder,
  today: string,
  schedule: ReminderSchedule = DEFAULT_SCHEDULE,
): { offset: number; key: string; tone: ReminderTone } | null {
  if (bill.status !== "open" || !bill.remindersOn) return null;
  if (outstandingOf(bill) <= 0) return null;
  if (bill.pausedUntil && bill.pausedUntil >= today) return null;

  const days = daysBetween(bill.dueDate, today);
  const offsets = [...schedule.offsets].sort((a, b) => a - b);
  const reached = offsets.filter((o) => o <= days);
  if (reached.length === 0) return null;

  let offset = reached[reached.length - 1] ?? 0;
  const last = offsets[offsets.length - 1] ?? 0;
  if (offset === last && schedule.repeatEvery > 0 && days > last) {
    offset = last + Math.floor((days - last) / schedule.repeatEvery) * schedule.repeatEvery;
  }
  return { offset, key: stepKey(offset), tone: toneFor(offset, schedule) };
}

/** The next date a reminder will go out, for showing on screen. */
export function nextReminderDate(
  bill: BillForReminder,
  today: string,
  schedule: ReminderSchedule = DEFAULT_SCHEDULE,
): string | null {
  if (bill.status !== "open" || !bill.remindersOn || outstandingOf(bill) <= 0) return null;
  const from = bill.pausedUntil && bill.pausedUntil >= today
    ? dueDateFor(bill.pausedUntil, 1)
    : today;
  const startDays = daysBetween(bill.dueDate, from);
  const offsets = [...schedule.offsets].sort((a, b) => a - b);
  const last = offsets[offsets.length - 1] ?? 0;
  for (const o of offsets) if (o >= startDays) return dueDateFor(bill.dueDate, o);
  if (schedule.repeatEvery > 0) {
    const k = Math.ceil((startDays - last) / schedule.repeatEvery);
    return dueDateFor(bill.dueDate, last + Math.max(1, k) * schedule.repeatEvery);
  }
  return null;
}

/** Where a bill stands, for the colour of its row. */
export type BillStanding = "paid" | "written_off" | "upcoming" | "due_soon" | "due_today" | "overdue" | "critical";

export function standingOf(bill: BillForReminder, today: string): BillStanding {
  if (bill.status === "written_off") return "written_off";
  if (bill.status === "paid" || outstandingOf(bill) <= 0) return "paid";
  const d = daysBetween(bill.dueDate, today);
  if (d > 30) return "critical";
  if (d > 0) return "overdue";
  if (d === 0) return "due_today";
  if (d >= -7) return "due_soon";
  return "upcoming";
}

/**
 * The next reminder as the screen should show it: today when today's step is
 * owed and not yet in the log (sent or tried), otherwise the next scheduled
 * date after today.
 */
export function upcomingReminder(
  bill: BillForReminder,
  today: string,
  loggedSteps: ReadonlySet<string>,
  schedule: ReminderSchedule = DEFAULT_SCHEDULE,
): string | null {
  const now = stepDueToday(bill, today, schedule);
  if (now && !loggedSteps.has(now.key)) return today;
  /* Paused: the day it resumes, if a step will be owed then that has not
     gone already — which it usually will be, because the pause covered it. */
  if (bill.pausedUntil && bill.pausedUntil >= today) {
    const resume = dueDateFor(bill.pausedUntil, 1);
    const then = stepDueToday({ ...bill, pausedUntil: null }, resume, schedule);
    if (then && !loggedSteps.has(then.key)) return resume;
  }
  return nextReminderDate(bill, dueDateFor(today, 1), schedule);
}
