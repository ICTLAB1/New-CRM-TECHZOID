import { describe, expect, it } from "vitest";
import { AUTOMATED_NOTICE, automatedNotice, type AutomatedKind } from "./automated";
import {
  AUTOMATED_NOTICE as SERVER_NOTICE,
  automatedNotice as serverNotice,
} from "../../../netlify/lib/automatedNotice.mjs";

/**
 * The line that tells a customer a machine sent this. It is written twice
 * — once for the browser, once for the server that sends the payment
 * reminders — and the two must say exactly the same thing.
 */

const KINDS: AutomatedKind[] = ["follow-up", "payment-reminder", "payment-receipt", "internal"];

describe("the automatic-message line", () => {
  it("names the company, so it does not read as a stranger's machine", () => {
    expect(automatedNotice("follow-up", "TechZoid Technologies Private Limited"))
      .toContain("TechZoid Technologies Private Limited");
  });

  it("tells a customer who has already paid to ignore a payment reminder", () => {
    /* Without this sentence an automatic reminder reads as an accusation to
       somebody whose transfer has not been matched yet. */
    expect(automatedNotice("payment-reminder", "TechZoid")).toContain("already paid");
  });

  it("says a reply reaches a person, and never says not to reply", () => {
    /* These go out from a real mailbox with a real reply-to. "Do not reply"
       on a message chasing somebody for money is how a supplier becomes
       unreachable at the worst moment. */
    for (const kind of KINDS) {
      const line = automatedNotice(kind, "TechZoid");
      expect(line.toLowerCase(), kind).not.toContain("do not reply");
      expect(line.toLowerCase(), kind).not.toContain("noreply");
    }
    /* What it must say instead: that there is somebody on the other end. */
    for (const kind of ["follow-up", "payment-reminder", "payment-receipt"] as const) {
      expect(automatedNotice(kind, "TechZoid").toLowerCase(), kind).toContain("person");
    }
  });

  it("says plainly that it was automatic, whichever message it is on", () => {
    for (const kind of KINDS) {
      expect(automatedNotice(kind, "TechZoid").toLowerCase(), kind).toContain("automatically");
    }
  });

  it("drops the name rather than inventing one when there is none", () => {
    expect(automatedNotice("follow-up", "")).toContain("our system");
    expect(automatedNotice("follow-up", "   ")).not.toContain("%s");
  });

  it("is word-for-word the same on the server, which renders its own", () => {
    expect(SERVER_NOTICE).toEqual(AUTOMATED_NOTICE);
    for (const kind of KINDS) {
      expect(serverNotice(kind, "TechZoid"), kind).toBe(automatedNotice(kind, "TechZoid"));
      expect(serverNotice(kind, ""), kind).toBe(automatedNotice(kind, ""));
    }
  });
});
