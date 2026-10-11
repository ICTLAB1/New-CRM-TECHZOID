/**
 * Payment Tracker — which reminder a bill is owed today.
 *
 * A DELIBERATE SECOND COPY of src/domain/paymentTracker/schedule.ts, because
 * the reminder engine runs as plain JavaScript and cannot import the app's
 * TypeScript. src/domain/paymentTracker/schedule.test.ts runs the same cases
 * against both copies; change one and the tests fail until the other matches.
 */

export const DEFAULT_SCHEDULE = { offsets: [-7, 0, 3, 7, 15, 30], repeatEvery: 15 };

const MS_PER_DAY = 86_400_000;

export function daysBetween(fromISO, toISO) {
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

export function stepKey(offset) {
  return offset === 0 ? "d0" : offset > 0 ? `d+${offset}` : `d${offset}`;
}

export function toneFor(offset, schedule = DEFAULT_SCHEDULE) {
  if (offset < 0) return "upcoming";
  if (offset === 0) return "due";
  const last = Math.max(...schedule.offsets);
  if (offset >= last && last > 0) return "final";
  if (offset >= 15) return "firm";
  return "overdue";
}

export function outstandingOf(bill) {
  return Math.max(0, Math.round(((Number(bill.amount) || 0) - (Number(bill.amountPaid) || 0)) * 100) / 100);
}

/** A schedule read from settings, cleaned: anything unusable falls back. */
export function scheduleFrom(value) {
  const offsets = Array.isArray(value?.offsets)
    ? [...new Set(value.offsets.map(Number).filter((n) => Number.isInteger(n) && n >= -60 && n <= 365))]
    : [];
  const repeat = Number(value?.repeatEvery);
  return {
    offsets: offsets.length ? offsets.sort((a, b) => a - b) : DEFAULT_SCHEDULE.offsets,
    repeatEvery: Number.isInteger(repeat) && repeat >= 0 && repeat <= 90 ? repeat : DEFAULT_SCHEDULE.repeatEvery,
  };
}

/** The latest step whose day has arrived — never a backlog. */
export function stepDueToday(bill, today, schedule = DEFAULT_SCHEDULE) {
  if (bill.status !== "open" || !bill.remindersOn) return null;
  if (outstandingOf(bill) <= 0) return null;
  if (bill.pausedUntil && bill.pausedUntil >= today) return null;

  const days = daysBetween(bill.dueDate, today);
  const offsets = [...schedule.offsets].sort((a, b) => a - b);
  const reached = offsets.filter((o) => o <= days);
  if (reached.length === 0) return null;

  let offset = reached[reached.length - 1];
  const last = offsets[offsets.length - 1];
  if (offset === last && schedule.repeatEvery > 0 && days > last) {
    offset = last + Math.floor((days - last) / schedule.repeatEvery) * schedule.repeatEvery;
  }
  return { offset, key: stepKey(offset), tone: toneFor(offset, schedule) };
}

/** A database row as the shape the rules read. */
export function billFromRow(row) {
  return {
    id: String(row.id),
    status: String(row.status ?? "open"),
    dueDate: String(row.due_date ?? "").slice(0, 10),
    amount: Number(row.amount) || 0,
    amountPaid: Number(row.amount_paid) || 0,
    remindersOn: row.reminders_on !== false,
    pausedUntil: row.paused_until ? String(row.paused_until).slice(0, 10) : null,
  };
}
