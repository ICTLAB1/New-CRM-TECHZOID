import { describe, expect, it } from "vitest";
import {
  alertEmailOf, autoEnabled, autoSwitches, mayMessage, optedIn, whatsappNumberOf,
} from "./whatsappConsent.mjs";
import { TEMPLATE_NAMES, TEMPLATES } from "./whatsappTemplates.mjs";

const customer = (data = {}) => ({ id: "c1", data: { company: "Acme Industries", ...data } });
const allOn = () => ({
  whatsapp: { auto: Object.fromEntries(TEMPLATE_NAMES.map((n) => [TEMPLATES[n].auto, true])) },
});

describe("consent", () => {
  it("is off unless the customer was ticked", () => {
    expect(optedIn(customer())).toBe(false);
    expect(optedIn(customer({ whatsappOptIn: false }))).toBe(false);
    expect(optedIn(customer({ whatsappOptIn: true }))).toBe(true);
  });

  it("is not something a stray truthy value can turn on", () => {
    /* A record imported from a spreadsheet can hold "no", "0" or "false"
       in that column. None of those is consent. */
    for (const v of ["yes", "true", 1, "1", "no", "false", 0, null, undefined, {}]) {
      expect(optedIn(customer({ whatsappOptIn: v }))).toBe(false);
    }
  });

  it("STOPS A SEND even with every switch on and a number on file", () => {
    const out = mayMessage({
      customer: customer({ whatsappPhone: "9810012345" }),
      settings: allOn(),
      template: "payment_due_reminder",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/has not agreed/i);
  });

  it("is not overridden by somebody pressing the button", () => {
    /* Consent belongs to the customer. A manual send skips the SWITCHES,
       never the tick. */
    const out = mayMessage({
      customer: customer({ whatsappPhone: "9810012345" }),
      settings: allOn(),
      template: "quotation_sent",
      manual: true,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/has not agreed/i);
  });
});

describe("which number is used", () => {
  it("takes the WhatsApp number when there is one", () => {
    expect(whatsappNumberOf(customer({ whatsappPhone: "+91 98100 12345", phone: "9811111111" })))
      .toBe("919810012345");
  });

  it("falls back to the phone on file, because the tick is the consent", () => {
    /* Ticking the box and leaving the WhatsApp field blank means "message
       me". Sending nothing would look broken rather than careful. */
    expect(whatsappNumberOf(customer({ phone: "9811111111" }))).toBe("919811111111");
  });

  it("comes back empty when neither number can be sent to", () => {
    expect(whatsappNumberOf(customer({ phone: "98100" }))).toBe("");
    expect(whatsappNumberOf(customer())).toBe("");
  });

  it("stops a send when there is nothing to send to, and says so", () => {
    const out = mayMessage({ customer: customer({ whatsappOptIn: true }), settings: allOn(), template: "quotation_sent" });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no WhatsApp number/i);
  });

  it("hands the resolved number back, so the log records where it went", () => {
    const out = mayMessage({
      customer: customer({ whatsappOptIn: true, whatsappPhone: "09810012345" }),
      settings: allOn(), template: "quotation_sent",
    });
    expect(out).toMatchObject({ ok: true, to: "919810012345" });
  });
});

describe("the eight switches", () => {
  it("are every one of them off when nobody has touched them", () => {
    const switches = autoSwitches({});
    expect(Object.keys(switches)).toHaveLength(8);
    expect(Object.values(switches).every((v) => v === false)).toBe(true);
  });

  it("are off for a settings row that has no whatsapp block at all", () => {
    for (const settings of [{}, { whatsapp: {} }, { whatsapp: { auto: {} } }, undefined]) {
      expect(autoEnabled(settings, "quotation_sent")).toBe(false);
    }
  });

  it("turn on one at a time, leaving the others alone", () => {
    const settings = { whatsapp: { auto: { quotationSent: true } } };
    expect(autoEnabled(settings, "quotation_sent")).toBe(true);
    expect(autoEnabled(settings, "payment_overdue_reminder")).toBe(false);
  });

  it("say OFF for a name that is not one of the eight", () => {
    /* autoEnabled is exported and the settings screen asks it per name. A
       typo in a name must not read as "switched on". */
    expect(autoEnabled(allOn(), "not_a_template")).toBe(false);
    expect(autoEnabled({}, "")).toBe(false);
  });

  it("need the value true, not merely something truthy", () => {
    const settings = { whatsapp: { auto: { quotationSent: "yes" } } };
    expect(autoEnabled(settings, "quotation_sent")).toBe(false);
  });

  it("stop an automatic send and say where the switch is", () => {
    const out = mayMessage({
      customer: customer({ whatsappOptIn: true, phone: "9810012345" }),
      settings: {},
      template: "payment_overdue_reminder",
    });
    expect(out.ok).toBe(false);
    expect(out.switchedOff).toBe(true);
    expect(out.reason).toContain("Settings → WhatsApp");
    expect(out.reason).toContain(TEMPLATES.payment_overdue_reminder.label);
  });

  it("do NOT stop a person pressing the button", () => {
    const out = mayMessage({
      customer: customer({ whatsappOptIn: true, phone: "9810012345" }),
      settings: {},
      template: "payment_overdue_reminder",
      manual: true,
    });
    expect(out.ok).toBe(true);
  });
});

describe("the alert address", () => {
  it("uses the one in settings, else the one it was given", () => {
    expect(alertEmailOf({ whatsapp: { alertEmail: "someone@techzoidtechnologies.com" } }, "fallback@x"))
      .toBe("someone@techzoidtechnologies.com");
    expect(alertEmailOf({}, "fallback@x")).toBe("fallback@x");
    expect(alertEmailOf({ whatsapp: { alertEmail: "   " } }, "fallback@x")).toBe("fallback@x");
  });
});

describe("a template nobody has heard of", () => {
  it("is refused before anything else is considered", () => {
    const out = mayMessage({
      customer: customer({ whatsappOptIn: true, phone: "9810012345" }),
      settings: allOn(), template: "made_up", manual: true,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no WhatsApp template/i);
  });
});
