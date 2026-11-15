import { describe, expect, it } from "vitest";
import { WHATSAPP_FOR, WHATSAPP_LABELS, whatsappLabel } from "./whatsapp";
/* The server's own definitions. Imported so that the screens and the sender
   cannot drift apart: a template renamed on the server fails this. They are
   plain JavaScript on purpose — they run in the Function App, which has no
   build step — so the shapes are named here rather than inferred. */
// @ts-expect-error -- untyped .mjs, shape asserted below
import { TEMPLATES as RAW_TEMPLATES } from "../../netlify/lib/whatsappTemplates.mjs";
// @ts-expect-error -- untyped .mjs, shape asserted below
import { RECORD_FOR as RAW_RECORD_FOR } from "../../netlify/lib/whatsappFacts.mjs";

const TEMPLATES = RAW_TEMPLATES as Record<string, { label: string }>;
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
