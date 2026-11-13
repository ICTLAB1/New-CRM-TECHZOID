import { describe, expect, it } from "vitest";
import { buildArmedSteps, type Armable } from "./armedSteps";
import { followUpBody, followUpSubject } from "../../domain/followups/followups";
import {
  buildEmailHtml, buildEmailText,
  type EmailCompany, type EmailQuotation, type EmailSender,
} from "../../domain/integrations/emailTemplate";

/**
 * The messages a sequence will send are rendered when it is armed and
 * stored, so that what was queued is what the customer receives.
 *
 * This builder used to live inside the email dialog's send handler, which
 * meant a sequence could only be armed by emailing from inside the CRM.
 * It has two callers now — the email dialog, and recording a send that
 * went out by hand — so what it produces is pinned here rather than left
 * to whichever caller somebody happens to test.
 */

const sender: EmailSender = { name: "A Sales Person", email: "sales@example.com" };
const company: EmailCompany = { name: "A Company" };
const quotation: EmailQuotation | null = null;

const armable: Armable = {
  ownerId: "owner-1",
  docType: "quotation",
  docId: "doc-1",
  docNumber: "TZ/QT/2026-27/0042",
  customerId: "cust-1",
  customerName: "A Customer Pvt Ltd",
  facts: {
    label: "Quotation",
    number: "TZ/QT/2026-27/0042",
    date: "02 Nov 2026",
    validUntil: "09 Nov 2026",
    contact: "R Kumar",
    senderName: "A Sales Person",
  },
  plan: [
    { step: 1, tone: "nudge", dueOn: "2026-11-04" },
    { step: 2, tone: "check", dueOn: "2026-11-06" },
    { step: 3, tone: "final", dueOn: "2026-11-09" },
  ],
  whatsapp: { to: "+91 98100 12345", why: "" },
  templateNames: { nudge: "tz_nudge", check: "tz_check", final: "tz_final" },
  company: "A Customer Pvt Ltd",
};

const build = (channels: { email: boolean; whatsapp: boolean }) =>
  buildArmedSteps({ armable, sender, company, quotation, channels });

describe("the messages a sequence is armed with", () => {
  it("renders one email per planned step, with the words already written", () => {
    const steps = build({ email: true, whatsapp: false });

    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.channel)).toEqual(["email", "email", "email"]);
    expect(steps.map((s) => s.dueOn)).toEqual(["2026-11-04", "2026-11-06", "2026-11-09"]);
    /* Rendered NOW and stored: nothing re-templates these weeks later. */
    for (const s of steps) {
      expect(s.subject).toBeTruthy();
      expect(s.message).toContain("TZ/QT/2026-27/0042");
      expect(s.html).toContain("<");
    }
    expect(steps[0]!.subject).toBe(followUpSubject("nudge", armable.facts));
  });

  it("records how many steps the sequence has on every step", () => {
    /* "2 of 3" in the customer's own portal and in the follow-up list reads
       off this, so a row that does not know the total reads "2 of 0". */
    for (const s of build({ email: true, whatsapp: false })) expect(s.steps).toBe(3);
  });

  it("renders the plain follow-up email, with no festive greeting on it", () => {
    /* A chaser arriving in December wishing somebody a happy Diwali is the
       exact failure the dated greeting window exists to prevent — so the
       armed markup must be the body and nothing else. Compared whole
       against the builder called without one: anything extra shows up. */
    const steps = build({ email: true, whatsapp: false });
    expect(steps[0]!.html).toBe(buildEmailHtml({
      body: followUpBody("nudge", armable.facts),
      sender, company, quotation, attachmentName: null,
    }));
    expect(steps[0]!.message).toBe(buildEmailText({
      body: followUpBody("nudge", armable.facts),
      sender, company, quotation, attachmentName: null,
    }));
  });

  it("queues the Meta-approved template, not words of its own, on WhatsApp", () => {
    const steps = build({ email: false, whatsapp: true });

    expect(steps.map((s) => s.channel)).toEqual(["whatsapp", "whatsapp", "whatsapp"]);
    expect(steps.map((s) => s.templateName)).toEqual(["tz_nudge", "tz_check", "tz_final"]);
    expect(steps.map((s) => s.toPhone)).toEqual(["+91 98100 12345", "+91 98100 12345", "+91 98100 12345"]);
    /* The words are Meta's. All this side decides is what goes in the
       placeholders — and the last step quotes the expiry, not the date. */
    expect(steps[0]!.templateValues).toEqual(["R Kumar", "TZ/QT/2026-27/0042", "02 Nov 2026"]);
    expect(steps[2]!.templateValues).toEqual(["R Kumar", "TZ/QT/2026-27/0042", "09 Nov 2026"]);
    for (const s of steps) expect(s.message).toBeUndefined();
  });

  it("sends on both channels when both are picked", () => {
    const steps = build({ email: true, whatsapp: true });
    expect(steps).toHaveLength(6);
    expect(steps.filter((s) => s.channel === "email")).toHaveLength(3);
    expect(steps.filter((s) => s.channel === "whatsapp")).toHaveLength(3);
  });

  it("queues nothing at all when neither channel is picked", () => {
    /* The caller arms on the strength of this being empty — a sequence of
       no messages must not be stored as a live sequence. */
    expect(build({ email: false, whatsapp: false })).toEqual([]);
  });

  it("leaves WhatsApp out when there is no number, however it was asked for", () => {
    /* Consent and a cleanly split number are hard gates upstream; this is
       the backstop, because a row queued with no number fails a day later
       in a cron job nobody is watching. */
    const steps = buildArmedSteps({
      armable: { ...armable, whatsapp: { to: "", why: "No consent on record." } },
      sender, company, quotation, channels: { email: false, whatsapp: true },
    });
    expect(steps).toEqual([]);
  });
});
