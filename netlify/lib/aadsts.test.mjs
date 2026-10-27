import { describe, expect, it } from "vitest";
import { codeOf, explain, refreshFailure } from "./aadsts.mjs";

/**
 * "Your Microsoft 365 connection has expired. Reconnect it."
 *
 * One sentence for every refresh failure there is. It is right when the
 * grant really is stale and a trap when it is not: reconnecting cannot
 * replace an expired client secret, and the person who follows the advice
 * reconnects successfully, sends again, and reads the same sentence. These
 * tests are about the difference between those two.
 */

const payload = (error, ...codes) => ({
  error,
  error_codes: codes,
  error_description: codes.length ? `AADSTS${codes[0]}: something Microsoft said` : "",
});

describe("reading Microsoft's reason", () => {
  it("finds the code wherever it turns up", () => {
    expect(codeOf({ error_codes: [7000222] })).toBe("AADSTS7000222");
    expect(codeOf({ error_description: "AADSTS700082: token expired" })).toBe("AADSTS700082");
    expect(codeOf({ error: "invalid_grant" })).toBe(null);
    expect(codeOf({})).toBe(null);
    expect(codeOf(undefined)).toBe(null);
  });

  it("translates only codes it actually knows", () => {
    expect(explain("AADSTS7000215")).toContain("Secret ID");
    expect(explain("AADSTS99999999")).toBe(null);
    expect(explain(null)).toBe(null);
  });
});

describe("whether reconnecting is the fix", () => {
  it("says reconnect for a grant that has genuinely gone stale", () => {
    for (const p of [payload("invalid_grant", 700082), payload("invalid_grant", 50173), payload("invalid_grant")]) {
      const why = refreshFailure(p);
      expect(why.reconnect).toBe(true);
      expect(why.error).toContain("Reconnect it in Settings");
    }
  });

  it("does NOT say reconnect when the app's client secret has expired", () => {
    /* THE TRAP. Every mailbox in the company fails on the same day, each
       person reconnects successfully, and nobody can send. */
    const why = refreshFailure(payload("invalid_client", 7000222));
    expect(why.reconnect).toBe(false);
    expect(why.error).not.toContain("Reconnect it in Settings");
    expect(why.error).toContain("MS_CLIENT_SECRET");
  });

  it("treats invalid_client as the app's fault even with no code attached", () => {
    const why = refreshFailure({ error: "invalid_client" });
    expect(why.reconnect).toBe(false);
    expect(why.error).toContain("reconnecting will not help");
  });

  it("does not send somebody to reconnect over a wrong app id or tenant", () => {
    expect(refreshFailure(payload("unauthorized_client", 700016)).reconnect).toBe(false);
    expect(refreshFailure(payload("invalid_request", 900023)).reconnect).toBe(false);
  });

  it("falls back to the likely answer, and carries the code with it", () => {
    /* A stale grant is much the commonest reason a refresh fails, so it
       stays the default — but as the likely case, with Microsoft's code
       attached rather than lost in a log. */
    const why = refreshFailure(payload("something_new", 123456));
    expect(why.reconnect).toBe(true);
    expect(why.error).toContain("AADSTS123456");
    expect(why.error).toContain("usually a connection Microsoft has retired");
  });

  it("names the thing that failed, so an inbox is not called a mailbox", () => {
    expect(refreshFailure({ error: "invalid_grant" }, { what: "inbox connection" }).error).toContain("inbox connection");
    expect(refreshFailure({}).error).toContain("Microsoft 365 connection");
  });

  it("names the shared mailbox, and sends you to the panel it is on", () => {
    /* THE SECOND HALF OF THE TRAP. A payment reminder sends from the
       company's accounts@ address, which is a different row in a different
       table from the sender's own mailbox. "Your Microsoft 365 connection
       has expired" sent somebody to reconnect their own — which worked, and
       changed nothing, because the mailbox that failed was never theirs. */
    const why = refreshFailure({ error: "invalid_grant" }, {
      email: "accounts@techzoidtechnologies.com", shared: true,
    });
    expect(why.error).toContain("The shared mailbox accounts@techzoidtechnologies.com");
    expect(why.error).not.toContain("Your Microsoft 365 connection");
    expect(why.error).toContain("Shared mailboxes");
  });

  it("names the address on a personal mailbox too", () => {
    const why = refreshFailure({ error: "invalid_grant" }, { email: "abhinav.jain@example.com" });
    expect(why.error).toContain("abhinav.jain@example.com");
    /* Not the shared panel: that is not where this one is reconnected. */
    expect(why.error).not.toContain("Shared mailboxes");
  });

  it("never contradicts itself: advice follows the diagnosis", () => {
    /* The bug in one line. A message saying "reconnect" while reconnect is
       false is the loop this exists to end. */
    const cases = [
      payload("invalid_grant", 700082), payload("invalid_client", 7000222),
      payload("invalid_client"), payload("unauthorized_client", 700016),
      payload("whatever", 123456), {},
    ];
    for (const p of cases) {
      for (const who of [{}, { email: "a@b.com" }, { email: "accounts@b.com", shared: true }]) {
        const why = refreshFailure(p, who);
        expect(why.error.includes("Reconnect it in Settings"), JSON.stringify([p, who])).toBe(why.reconnect);
      }
    }
  });
});
