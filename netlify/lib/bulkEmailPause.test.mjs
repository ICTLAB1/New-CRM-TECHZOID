import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAUSE_REASON, PAUSED, bulkEmailPaused, pausedLog } from "./bulkEmailPause.mjs";

const FUNCTIONS = join(import.meta.dirname, "..", "functions");
const read = (name) => readFileSync(join(FUNCTIONS, name), "utf8");

/* The one thing the pause covers: the company-profile mailshot. */
const BULK = ["profile-send.mjs"];

/* Everything that keeps running, at the company's instruction and after
   being told what it means while the mailbox is still restricted.

   The line is volume per send rather than whether somebody is watching: a
   follow-up is one customer, one document they asked about, no
   attachment, a handful a morning. The mailshot is hundreds of cold
   introductions carrying two megabytes each, which is what Microsoft
   objected to. */
const NOT_BULK = [
  "email-send.mjs",
  "discount-approval-notify.mjs",
  "outreach-test-send.mjs",
  "outreach-launch.mjs",
  "outreach-run.mjs",
  "followups-run.mjs",
  "payment-reminders-run.mjs",
];

describe("the pause on automated email", () => {
  it("is off", () => {
    /* This test states the current position rather than asserting a
       constant can never change. It was written to flip when the pause
       was lifted, so that the change is visible in a diff rather than
       silent — lifted 21 November 2026 at the company's instruction. */
    expect(PAUSED).toBe(false);
    expect(bulkEmailPaused()).toBe(false);
  });

  it("answers the question the call sites ask, rather than its own", () => {
    /* `bulkEmailPaused()` has to READ PAUSED and not be a second constant
       beside it, or putting the pause back would be a change that
       silently did nothing. */
    expect(bulkEmailPaused()).toBe(PAUSED);
  });

  it("says why, where it is lifted, and that nothing was lost", () => {
    expect(PAUSE_REASON).toMatch(/restricted/i);
    expect(PAUSE_REASON).toMatch(/Nothing has been lost/i);
    expect(PAUSE_REASON).toMatch(/Restricted entities/);
    /* It has to say what still works, or somebody reads "paused" and
       assumes their quotations are stuck too. */
    expect(PAUSE_REASON).toMatch(/Follow-ups, payment reminders/i);
  });

  it("names the job in a log line, so a job that did nothing says so", () => {
    expect(pausedLog("follow-ups")).toMatch(/^follow-ups: skipped/);
  });
});

describe("which senders the pause reaches", () => {
  /* THE LIST IS THE POINT. A new bulk sender added later without this
     guard is a mailshot that goes out while the mailbox is restricted,
     and nothing else in the codebase would notice. */
  it("stops the company-profile mailshot", () => {
    for (const name of BULK) {
      const src = read(name);
      expect(src, `${name} does not import the pause`).toContain("bulkEmailPause.mjs");
      expect(src, `${name} imports the pause but never asks it`).toMatch(/bulkEmailPaused\(\)/);
    }
  });

  it("leaves follow-ups, reminders, campaigns and single sends alone", () => {
    for (const name of NOT_BULK) {
      expect(read(name), `${name} should not be paused`).not.toContain("bulkEmailPause.mjs");
    }
  });

  /* THE MAILSHOT IS STOPPED BEFORE IT READS ANYTHING, so a paused send
     costs nothing and answers with the reason rather than a wall of
     refusals one recipient at a time. */
  it("stops the mailshot before it reads the profile or the list", () => {
    const src = read("profile-send.mjs");
    const guard = src.indexOf("bulkEmailPaused()");
    const firstRead = src.indexOf(".from(");
    expect(guard).toBeGreaterThan(0);
    expect(guard, "the mailshot reads rows before checking the pause").toBeLessThan(firstRead);
  });

  it("answers a person with words rather than a silent nothing", () => {
    expect(read("profile-send.mjs")).toContain("PAUSE_REASON");
  });
});

describe("what the codebase must not grow quietly", () => {
  /* If a new function starts sending mail, somebody has to decide whether
     it is bulk. This fails until they do. */
  it("knows about every function that sends email", () => {
    const senders = readdirSync(FUNCTIONS)
      .filter((f) => f.endsWith(".mjs"))
      .filter((f) => /\bsendMail\b/.test(read(f)));

    const known = new Set([
      ...BULK, ...NOT_BULK,
      /* Sends to the person who just signed in, about their own mailbox. */
      "ms-oauth-start.mjs",
      /* One receipt to the one customer whose payment just arrived. */
      "payment-reminders-send.mjs",
      /* An alert to the company about an inbound WhatsApp message. */
      "whatsapp-webhook.mjs",
    ]);

    const unaccounted = senders.filter((f) => !known.has(f));
    expect(unaccounted, "a new email sender appeared — is it bulk? add it above").toEqual([]);
  });
});
