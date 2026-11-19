import { describe, expect, it } from "vitest";
import { replyWindow, threadsFrom, windowOpen, type WhatsAppMessage } from "./whatsapp";

const msg = (over: Partial<WhatsAppMessage>): WhatsAppMessage => ({
  id: "m", direction: "out", customerId: null, phone: "919810012345", contactName: "",
  template: "", body: "", status: "sent", error: "", trigger: "", documentName: "",
  at: "2026-11-15T10:00:00Z", ...over,
});

describe("the 24-hour window", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("is open just inside a day of their message", () => {
    expect(windowOpen("2026-11-14T12:30:00Z", now)).toBe(true);
    expect(windowOpen("2026-11-15T11:59:00Z", now)).toBe(true);
  });

  it("is shut just outside it", () => {
    expect(windowOpen("2026-11-14T11:30:00Z", now)).toBe(false);
    expect(windowOpen("2026-11-10T12:00:00Z", now)).toBe(false);
  });

  it("is shut when they have never written", () => {
    expect(windowOpen("", now)).toBe(false);
    expect(windowOpen("not a date", now)).toBe(false);
  });
});

/* ── why the reply box is missing ─────────────────────────────────────
   REPORTED, from a phone: "There is no chatting option in this." Part of
   that was the layout; part was this. Three of the five threads on the
   live inbox were ones the COMPANY had started — a quotation sent, a
   profile broadcast to a number nobody has written from — and the screen
   told the reader "more than 24 hours since they wrote" about people who
   had never written a word. That reads as the CRM having lost their
   replies, which is the one thing this inbox exists to disprove. */
describe("which of the three states a thread is in", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("is open inside a day of their message", () => {
    expect(replyWindow("2026-11-15T11:59:00Z", now)).toBe("open");
    expect(replyWindow("2026-11-14T12:30:00Z", now)).toBe("open");
  });

  it("is closed once a day has passed SINCE THEY WROTE", () => {
    expect(replyWindow("2026-11-14T11:30:00Z", now)).toBe("closed");
    expect(replyWindow("2026-11-10T12:00:00Z", now)).toBe("closed");
  });

  it("is NEVER, not closed, when they have not written at all", () => {
    /* The distinction the screen was missing. "Closed" promises there was
       a message once. */
    expect(replyWindow("", now)).toBe("never");
  });

  it("treats an unreadable date as never rather than guessing", () => {
    expect(replyWindow("not a date", now)).toBe("never");
  });

  it("never disagrees with windowOpen about whether the box shows", () => {
    /* The two must not drift: windowOpen is what the rest of the CRM
       asks, and a third state that said "open" where it says shut would
       offer somebody a message Meta will refuse. */
    for (const at of ["", "not a date", "2026-11-14T11:30:00Z", "2026-11-15T11:59:00Z"]) {
      expect(replyWindow(at, now) === "open", at).toBe(windowOpen(at, now));
    }
  });
});

describe("threads", () => {
  it("groups by number, oldest message first inside each", () => {
    const threads = threadsFrom([
      msg({ id: "b", at: "2026-11-15T11:00:00Z", body: "second" }),
      msg({ id: "a", at: "2026-11-15T10:00:00Z", body: "first" }),
      msg({ id: "c", phone: "919899999999", at: "2026-11-15T09:00:00Z" }),
    ]);
    expect(threads).toHaveLength(2);
    const acme = threads.find((t) => t.phone === "919810012345")!;
    expect(acme.messages.map((m) => m.body)).toEqual(["first", "second"]);
  });

  it("puts the thread with the newest message at the top", () => {
    const threads = threadsFrom([
      msg({ phone: "919811111111", at: "2026-11-15T08:00:00Z" }),
      msg({ phone: "919822222222", at: "2026-11-15T18:00:00Z" }),
    ]);
    expect(threads[0]!.phone).toBe("919822222222");
  });

  it("marks a thread where THEY spoke last as needing an answer", () => {
    const [thread] = threadsFrom([
      msg({ at: "2026-11-15T10:00:00Z", direction: "out" }),
      msg({ at: "2026-11-15T11:00:00Z", direction: "in", body: "Can you send the PO format?" }),
    ]);
    expect(thread!.unanswered).toBe(true);
    expect(thread!.lastInboundAt).toBe("2026-11-15T11:00:00Z");
  });

  it("does not mark one we have already answered", () => {
    const [thread] = threadsFrom([
      msg({ at: "2026-11-15T11:00:00Z", direction: "in" }),
      msg({ at: "2026-11-15T11:30:00Z", direction: "out" }),
    ]);
    expect(thread!.unanswered).toBe(false);
    /* The window is still open — they wrote half an hour ago. */
    expect(windowOpen(thread!.lastInboundAt, new Date("2026-11-15T12:00:00Z"))).toBe(true);
  });

  it("keeps a thread from a number nobody has on file", () => {
    /* A stranger messaging the business number is a new enquiry. */
    const [thread] = threadsFrom([msg({ direction: "in", customerId: null, contactName: "Ravi" })]);
    expect(thread!.customerId).toBeNull();
    expect(thread!.name).toBe("Ravi");
  });

  it("finds the customer and the name from anywhere in the thread", () => {
    const [thread] = threadsFrom([
      msg({ at: "2026-11-15T10:00:00Z", customerId: null, contactName: "" }),
      msg({ at: "2026-11-15T11:00:00Z", customerId: "cust-1", contactName: "Ravi Sharma", direction: "in" }),
    ]);
    expect(thread!.customerId).toBe("cust-1");
    expect(thread!.name).toBe("Ravi Sharma");
  });

  it("ignores a row with no number rather than making a thread for it", () => {
    expect(threadsFrom([msg({ phone: "" })])).toEqual([]);
    expect(threadsFrom([])).toEqual([]);
  });
});
