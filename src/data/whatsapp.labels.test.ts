import { describe, expect, it } from "vitest";
import { WHATSAPP_FOR, WHATSAPP_LABELS, whatsappLabel } from "./whatsapp";
/* The server's own definitions. Imported so that the screens and the sender
   cannot drift apart: a template renamed on the server fails this. They are
   plain JavaScript on purpose — they run in the Function App, which has no
   build step — so the shapes are named here rather than inferred. */
// @ts-expect-error -- untyped .mjs, shape asserted below
import { TEMPLATES as RAW_TEMPLATES, documentFor } from "../../netlify/lib/whatsappTemplates.mjs";
// @ts-expect-error -- untyped .mjs, shape asserted below
import { RECORD_FOR as RAW_RECORD_FOR } from "../../netlify/lib/whatsappFacts.mjs";

const TEMPLATES = RAW_TEMPLATES as Record<string, {
  label: string; metaName: string; legacyName: string;
  /** Set only on a template created in Meta with a document header; says
   *  what the attached file is called and which fact holds its number. */
  document?: { kind: string; numberFrom: string };
}>;
const RECORD_FOR = RAW_RECORD_FOR as Record<string, string>;

describe("the screens' copy of the template names", () => {
  it("names every template the server has, and no others", () => {
    expect(Object.keys(WHATSAPP_LABELS).sort()).toEqual(Object.keys(TEMPLATES).sort());
  });

  it("uses the same words the server uses", () => {
    for (const [name, label] of Object.entries(WHATSAPP_LABELS)) {
      expect(label, `label for ${name}`).toBe(TEMPLATES[name]?.label);
    }
  });

  it("offers each template on the kind of record the server builds it from", () => {
    for (const [template, recordType] of Object.entries(RECORD_FOR)) {
      expect(WHATSAPP_FOR[recordType] ?? [], `${template} on a ${recordType}`).toContain(template);
    }
  });

  it("offers nothing that does not belong to the record it is listed under", () => {
    for (const [recordType, templates] of Object.entries(WHATSAPP_FOR)) {
      for (const t of templates) {
        expect(RECORD_FOR[t], t).toBe(recordType);
      }
    }
  });

  it("tidies up a name it does not know rather than showing nothing", () => {
    expect(whatsappLabel("quotation_sent")).toBe("Quotation sent");
    expect(whatsappLabel("some_new_thing")).toBe("Some new thing");
    expect(whatsappLabel("")).toBe("");
  });
});

describe("the name each message is sent as at Meta", () => {
  /* The eight that were submitted once, refused, and resubmitted under a
     `_v2` name. Every send tries the new name and falls back to the old. */
  const RESUBMITTED = [
    "quotation_sent", "quotation_followup", "order_delivered", "licence_delivered",
    "payment_due_reminder", "payment_overdue_reminder", "payment_received", "renewal_reminder",
  ];

  it("is the CRM's own name with _v2 on the end, for the eight that were resubmitted", () => {
    for (const name of RESUBMITTED) {
      expect(TEMPLATES[name]?.metaName, name).toBe(`${name}_v2`);
      expect(TEMPLATES[name]?.legacyName, name).toBe(name);
    }
  });

  /* A template created once needs neither. Giving it a `_v2` would make
     every send ask Meta for a name nobody ever submitted, fail, and then
     ask for the real one. */
  it("is the plain name, with nothing to fall back to, for one created once", () => {
    for (const name of ["proforma_sent", "proforma_followup", "proforma_advance_reminder"]) {
      expect(TEMPLATES[name]?.metaName, name).toBe(name);
      expect(TEMPLATES[name]?.legacyName, name).toBe("");
    }
  });

  it("never changes the name the CRM itself uses, which the switches key on", () => {
    /* Renaming these would turn every company's switches off and orphan
       every message ever logged. */
    expect(Object.keys(WHATSAPP_LABELS).sort()).toEqual([
      "licence_delivered", "order_delivered", "payment_due_reminder",
      "payment_overdue_reminder", "payment_received", "proforma_advance_reminder",
      "proforma_followup", "proforma_sent", "quotation_followup",
      "quotation_sent", "renewal_reminder",
    ]);
  });

  it("marks the two messages that carry their document, and no others", () => {
    const carriers = Object.keys(TEMPLATES).filter((n) => TEMPLATES[n]?.document);
    expect(carriers).toEqual(["quotation_sent", "proforma_sent"]);
  });

  /* The file the customer keeps must not contradict the message. A
     proforma arriving as "Quotation_TZ-PI-0134.pdf" is the same mistake as
     the wording calling it a quotation, in the part they are likeliest to
     save. */
  it("names the attached file after the document it actually is", () => {
    expect(documentFor("quotation_sent", { quoteNo: "TZ/QT/2627/0117" }))
      .toBe("Quotation_TZ-QT-2627-0117.pdf");
    expect(documentFor("proforma_sent", { proformaNo: "TZ/PI/2627/0134" }))
      .toBe("Proforma_TZ-PI-2627-0134.pdf");
  });
});
