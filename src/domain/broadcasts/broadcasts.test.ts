import { describe, expect, it } from "vitest";
import { describeAudience, isSendable, pending, whyNotSendable, type Broadcast } from "./broadcasts";

const NOW = Date.UTC(2026, 7, 27, 10);
const HOUR = 3_600_000;
const b = (o: Partial<Broadcast>): Broadcast => ({
  id: "b1", fromId: "u1", title: "Notice", body: "", tone: "info",
  expiresAt: NOW + HOUR, createdAt: NOW, ...o,
});

describe("which messages interrupt somebody", () => {
  it("shows what has not been dismissed, newest first", () => {
    const list = [b({ id: "old", createdAt: NOW - HOUR }), b({ id: "new", createdAt: NOW })];
    expect(pending(list, [], NOW).map((x) => x.id)).toEqual(["new", "old"]);
  });

  it("never shows one twice", () => {
    // A popup that comes back is a popup people learn to dismiss without
    // reading, and then the one that mattered gets dismissed too.
    expect(pending([b({ id: "x" })], ["x"], NOW)).toEqual([]);
  });

  it("stops at expiry, read or not", () => {
    expect(pending([b({ id: "gone", expiresAt: NOW - 1 })], [], NOW)).toEqual([]);
    expect(pending([b({ id: "live", expiresAt: NOW + 1 })], [], NOW)).toHaveLength(1);
  });

  it("has nothing to say about an empty list", () => {
    expect(pending([], [], NOW)).toEqual([]);
    expect(pending([], ["anything"], NOW)).toEqual([]);
  });
});

describe("who a message went to", () => {
  it("names the person, or says everyone", () => {
    expect(describeAudience({ toId: null })).toBe("everyone");
    expect(describeAudience({ toId: "" })).toBe("everyone");
    expect(describeAudience({ toId: "u2", toName: "Rashmi Verma" })).toBe("Rashmi Verma");
    expect(describeAudience({ toId: "u2" })).toBe("one person");
  });
});

describe("what can be sent", () => {
  it("needs something written", () => {
    expect(isSendable({ title: "", body: "" })).toBe(false);
    expect(isSendable({ title: "  ", body: " " })).toBe(false);
    expect(whyNotSendable({ title: "", body: "" })).toContain("Write the message");
    // Either one alone is enough — a heading can be the whole message.
    expect(isSendable({ title: "Portal is down", body: "" })).toBe(true);
    expect(isSendable({ title: "", body: "Portal is down" })).toBe(true);
  });

  it("refuses a heading that is really a paragraph", () => {
    expect(whyNotSendable({ title: "x".repeat(121), body: "" })).toContain("headline");
    expect(whyNotSendable({ title: "x".repeat(120), body: "" })).toBe("");
  });

  it("refuses an essay", () => {
    // A popup is an interruption, not a document.
    expect(whyNotSendable({ title: "Notice", body: "x".repeat(2001) })).toContain("too long");
  });
});
