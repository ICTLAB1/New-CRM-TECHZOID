import { describe, expect, it } from "vitest";
import {
  awaitingAnswer, daysOverdue, followUpDueToday, paymentDueToday, paymentOverdueToday,
  remindersAllowed, renewalDueToday, stillOwed, todayInIndia,
} from "./whatsappSchedule.mjs";

/**
 * These four rules decide how often a customer hears from this company
 * without anybody choosing to send anything. Getting one wrong does not
 * fail loudly — it just quietly annoys every customer on the list, every
 * morning, until somebody complains.
 */

describe("the day, decided in India", () => {
  it("is tomorrow's date in India while it is still today in London", () => {
    /* The job runs at 10:00 IST, which is 04:30 UTC. A rule reading the
       server's own date would be reading yesterday's. */
    const lateUtcEvening = new Date("2026-11-15T20:30:00Z");
    expect(todayInIndia(lateUtcEvening)).toBe("2026-11-16");
  });

  it("is today's date at the moment the job actually runs", () => {
    expect(todayInIndia(new Date("2026-11-15T04:30:00Z"))).toBe("2026-11-15");
  });

  it("gives the shape every date in the product is stored in", () => {
    expect(todayInIndia(new Date("2026-01-05T06:00:00Z"))).toBe("2026-01-05");
  });
});

describe("payment due in three days", () => {
  it("fires on the third day before, and on no other day", () => {
    const due = "2026-11-15";
    expect(paymentDueToday(due, "2026-11-12")).toBe(true);
    for (const day of ["2026-11-11", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]) {
      expect(paymentDueToday(due, day), day).toBe(false);
    }
  });

  it("counts across a month end", () => {
    expect(paymentDueToday("2026-12-02", "2026-11-29")).toBe(true);
  });
});

describe("payment overdue", () => {
  it("fires the day after it was due", () => {
    expect(paymentOverdueToday("2026-11-15", "2026-11-16")).toBe(true);
  });

  it("then every seventh day, and not in between", () => {
    const due = "2026-11-15";
    const fires = [];
    for (let d = 0; d <= 30; d += 1) {
      const day = new Date(Date.UTC(2026, 10, 15 + d)).toISOString().slice(0, 10);
      if (paymentOverdueToday(due, day)) fires.push(d);
    }
    /* Days overdue 1, 8, 15, 22, 29 — once a week, not once a day. */
    expect(fires).toEqual([1, 8, 15, 22, 29]);
  });

  it("does not fire before the due date, or on it", () => {
    expect(paymentOverdueToday("2026-11-15", "2026-11-14")).toBe(false);
    expect(paymentOverdueToday("2026-11-15", "2026-11-15")).toBe(false);
  });

  it("says how many days overdue, for the message itself", () => {
    expect(daysOverdue("2026-11-15", "2026-11-23")).toBe(8);
    expect(daysOverdue("2026-11-15", "2026-11-10")).toBe(0);
  });
});

describe("a renewal in thirty days", () => {
  it("fires thirty days before, and on no other day", () => {
    expect(renewalDueToday("2026-12-15", "2026-11-15")).toBe(true);
    expect(renewalDueToday("2026-12-15", "2026-11-14")).toBe(false);
    expect(renewalDueToday("2026-12-15", "2026-11-16")).toBe(false);
  });

  it("does not fire for something that has already expired", () => {
    expect(renewalDueToday("2026-01-01", "2026-11-15")).toBe(false);
  });
});

describe("chasing a quotation", () => {
  it("fires three days after it was sent", () => {
    expect(followUpDueToday("2026-11-12", "2026-11-15")).toBe(true);
    expect(followUpDueToday("2026-11-12", "2026-11-14")).toBe(false);
    expect(followUpDueToday("2026-11-12", "2026-11-16")).toBe(false);
  });

  it("only chases one the customer has not answered", () => {
    expect(awaitingAnswer("Sent")).toBe(true);
    for (const answered of ["Accepted", "Rejected", "Expired", "Draft", ""]) {
      expect(awaitingAnswer(answered), answered).toBe(false);
    }
  });
});

describe("which bills are chased at all", () => {
  const bill = (over = {}) => ({ status: "open", amount: 118000, amount_paid: 0, reminders_on: true, ...over });

  it("leaves a paid one alone", () => {
    expect(stillOwed(bill())).toBe(true);
    expect(stillOwed(bill({ status: "paid" }))).toBe(false);
    expect(stillOwed(bill({ status: "written_off" }))).toBe(false);
    expect(stillOwed(bill({ amount_paid: 118000 }))).toBe(false);
  });

  it("chases the balance when part has been paid", () => {
    expect(stillOwed(bill({ amount_paid: 100000 }))).toBe(true);
  });

  it("ignores a rounding remainder rather than chasing fifty paise", () => {
    expect(stillOwed(bill({ amount_paid: 117999.6 }))).toBe(false);
  });

  it("honours the Payment Tracker's own switch and its pause", () => {
    /* The two channels must not say different things about the same
       invoice on the same morning. */
    expect(remindersAllowed(bill(), "2026-11-15")).toBe(true);
    expect(remindersAllowed(bill({ reminders_on: false }), "2026-11-15")).toBe(false);
    expect(remindersAllowed(bill({ paused_until: "2026-11-20" }), "2026-11-15")).toBe(false);
    expect(remindersAllowed(bill({ paused_until: "2026-11-14" }), "2026-11-15")).toBe(true);
  });
});
