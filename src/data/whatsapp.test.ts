import { describe, expect, it } from "vitest";
import { threadsFrom, windowOpen, type WhatsAppMessage } from "./whatsapp";

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
