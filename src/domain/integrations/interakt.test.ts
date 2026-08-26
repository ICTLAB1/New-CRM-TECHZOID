import { describe, expect, it } from "vitest";
import {
  addressee, DEFAULT_TEMPLATE_NAMES, mayWhatsApp, splitNumber, templateFor,
} from "./interakt";

const facts = {
  contact: "Rajesh Kumar",
  company: "Acme Manufacturing India Pvt Ltd",
  number: "TZ/QT/2627/0117",
  date: "24 Aug 2026",
  validUntil: "08 Sept 2026",
};

describe("who the message is addressed to", () => {
  it("uses the person where we have one", () => {
    expect(addressee(facts)).toBe("Rajesh Kumar");
  });

  it("falls back to the company, then to something ordinary", () => {
    // Meta refuses a send with an empty placeholder, so the failure mode of
    // a missing name is not "Dear ," — it is a message that never arrives.
    expect(addressee({ contact: "", company: "Acme" })).toBe("Acme");
    expect(addressee({ contact: "   ", company: "  " })).toBe("there");
    expect(addressee({})).toBe("there");
  });
});

describe("choosing a template", () => {
  it("uses the tone's own template and three values", () => {
    const send = templateFor("nudge", facts);
    expect(send.templateName).toBe(DEFAULT_TEMPLATE_NAMES.nudge);
    expect(send.bodyValues).toEqual(["Rajesh Kumar", "TZ/QT/2627/0117", "24 Aug 2026"]);
  });

  it("gives the expiry template the expiry date, not the document date", () => {
    expect(templateFor("final", facts).bodyValues[2]).toBe("08 Sept 2026");
  });

  it("never invents an expiry date it does not have", () => {
    // A template that says "expires on —" is worse than one tone quieter.
    const send = templateFor("final", { ...facts, validUntil: null });
    expect(send.templateName).toBe(DEFAULT_TEMPLATE_NAMES.check);
    expect(send.bodyValues[2]).toBe("24 Aug 2026");
  });

  it("uses the names actually registered with Meta when they are set", () => {
    const send = templateFor("check", facts, { check: "tz_quote_checkin_v2" });
    expect(send.templateName).toBe("tz_quote_checkin_v2");
  });

  it("ignores a name that is only whitespace", () => {
    expect(templateFor("check", facts, { check: "   " }).templateName).toBe(DEFAULT_TEMPLATE_NAMES.check);
  });

  it("always fills every placeholder", () => {
    for (const tone of ["nudge", "check", "final"] as const) {
      const send = templateFor(tone, { number: "Q1", date: "1 Jan 2026", validUntil: null });
      expect(send.bodyValues, tone).toHaveLength(3);
      for (const value of send.bodyValues) expect(value.trim(), tone).not.toBe("");
    }
  });
});

describe("splitting a number for Interakt", () => {
  it("splits an Indian number typed any of the usual ways", () => {
    for (const raw of ["+91 98100 12345", "9810012345", "09810012345", "919810012345"]) {
      expect(splitNumber(raw), raw).toEqual({ countryCode: "+91", phoneNumber: "9810012345" });
    }
  });

  it("handles the other country codes this company sells into", () => {
    expect(splitNumber("+971 50 123 4567")).toEqual({ countryCode: "+971", phoneNumber: "501234567" });
    expect(splitNumber("+44 7700 900123")).toEqual({ countryCode: "+44", phoneNumber: "7700900123" });
  });

  it("prefers the longer country code where two could match", () => {
    // 971 and 97 both start the same way; reading the short one leaves a
    // number that belongs to somebody else entirely.
    expect(splitNumber("+971501234567")?.countryCode).toBe("+971");
  });

  it("refuses rather than guesses", () => {
    // Sending to a mis-split number is not a failure anybody sees — it is a
    // stranger receiving a customer's quotation reminder.
    expect(splitNumber("")).toBeNull();
    expect(splitNumber("12345")).toBeNull();
    expect(splitNumber("not a phone")).toBeNull();
    expect(splitNumber("+99 123456789012")).toBeNull();
  });
});

describe("whether a customer may be messaged", () => {
  it("needs both consent and a number", () => {
    expect(mayWhatsApp({ whatsappOptIn: true, phone: "9810012345" })).toBe(true);
  });

  it("treats anything short of a yes as a no", () => {
    // Meta requires opt-in before a business writes first. An unticked box
    // is not consent, and neither is a missing field on a legacy record.
    expect(mayWhatsApp({ phone: "9810012345" })).toBe(false);
    expect(mayWhatsApp({ whatsappOptIn: false, phone: "9810012345" })).toBe(false);
    expect(mayWhatsApp({ whatsappOptIn: true, phone: "" })).toBe(false);
    expect(mayWhatsApp({ whatsappOptIn: true, phone: "nonsense" })).toBe(false);
  });
});
