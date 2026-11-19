import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAUSE_REASON, PAUSED, bulkEmailPaused, pausedLog } from "./bulkEmailPause.mjs";

const FUNCTIONS = join(import.meta.dirname, "..", "functions");
const read = (name) => readFileSync(join(FUNCTIONS, name), "utf8");

/* Everything that sends to many people, or sends without a person pressing
   a button for one named customer. */
const BULK = [
  "profile-send.mjs",
  "outreach-launch.mjs",
  "outreach-run.mjs",
  "followups-run.mjs",
  "payment-reminders-run.mjs",
];

/* One message, one customer, one person behind it. Pausing these would
   stop the company trading.

   outreach-test-send is here on purpose even though it belongs to the
   campaign system: it sends ONE message, to the signed-in user's own
   address, read server-side. That makes it the cheapest way to find out
   whether Microsoft has lifted the restriction — which is exactly what
   somebody will want the moment they think it has. */
const NOT_BULK = ["email-send.mjs", "discount-approval-notify.mjs", "outreach-test-send.mjs"];

describe("the pause on automated email", () => {
  it("is on", () => {
    /* This test states the current position rather than asserting a
       constant can never change: when Microsoft lifts the restriction,
       PAUSED goes false, this flips with it, and the change is visible in
       a diff rather than silent. */
    expect(PAUSED).toBe(true);
    expect(bulkEmailPaused()).toBe(true);
  });

  it("says why, where it is lifted, and that nothing was lost", () => {
    expect(PAUSE_REASON).toMatch(/restricted/i);
    expect(PAUSE_REASON).toMatch(/Nothing has been lost/i);
    expect(PAUSE_REASON).toMatch(/Restricted entities/);
  });

  it("names the job in a log line, so a job that did nothing says so", () => {
    expect(pausedLog("follow-ups")).toMatch(/^follow-ups: skipped/);
  });
});

describe("which senders the pause reaches", () => {
  /* THE LIST IS THE POINT. A new bulk sender added later without this
     guard is a mailshot that goes out while the mailbox is restricted,
     and nothing else in the codebase would notice. */
  it("stops every send that goes to many people or runs unattended", () => {
    for (const name of BULK) {
      const src = read(name);
      expect(src, `${name} does not import the pause`).toContain("bulkEmailPause.mjs");
      expect(src, `${name} imports the pause but never asks it`).toMatch(/bulkEmailPaused\(\)/);
    }
  });

  it("leaves one message to one customer alone", () => {
    for (const name of NOT_BULK) {
      expect(read(name), `${name} should not be paused`).not.toContain("bulkEmailPause.mjs");
    }
  });

  /* A scheduled job must return BEFORE it reads any rows. Letting it run
     and refuse each send one at a time would mark today's follow-ups
     failed, and a failed follow-up has to be armed again by hand. */
  it("stops a scheduled job before it does any work at all", () => {
    for (const name of ["followups-run.mjs", "payment-reminders-run.mjs", "outreach-run.mjs"]) {
      const src = read(name);
      const guard = src.indexOf("bulkEmailPaused()");
      expect(guard, `${name} has no guard`).toBeGreaterThan(0);

      /* The first thing the handler actually does: read rows, or hand off
         to the library that does. Whichever comes first has to come after
         the guard. outreach-run reads nothing itself — it calls
         drainQueue — so looking only for `.from(` would pass it blindly. */
      const work = [src.indexOf(".from("), src.indexOf("await ")]
        .filter((i) => i > 0);
      expect(work.length, `${name} appears to do nothing`).toBeGreaterThan(0);
      expect(guard, `${name} starts work before checking the pause`).toBeLessThan(Math.min(...work));
    }
  });

  it("answers a person with words rather than a silent nothing", () => {
    for (const name of ["profile-send.mjs", "outreach-launch.mjs"]) {
      expect(read(name)).toContain("PAUSE_REASON");
    }
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
