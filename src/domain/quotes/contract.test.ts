import { describe, expect, it } from "vitest";
import { QUOTE_TOOL } from "../../../netlify/lib/quoteExtract.mjs";
import { draftFromText } from "./fromText";
import type { Customer } from "../customers/customer";
import type { CatalogProduct } from "../catalog/types";

/**
 * The tool schema and the draft builder are two files that have to agree.
 *
 * The schema says what the model may return; fromText.ts decides what that
 * means. Nothing but this test connects them, and the failure mode is
 * silent: a field the model dutifully fills is read, dropped on the floor,
 * and the quotation quietly keeps a default. That is exactly what happened
 * to `validityDays` — "valid for 30 days" was extracted and ignored.
 *
 * So: every field the schema declares must visibly change the draft.
 */

const ctx = {
  settings: { defaultGst: 18, defaultValidityDays: 15, company: { name: "TechZoid" } },
  user: { id: "u1", name: "Abhinav" },
  customers: [{ id: "c1", ownerId: "u1", company: "ACME Infotech" } as Customer],
  catalog: [] as CatalogProduct[],
  today: "2026-01-01",
};

/** One value per top-level schema field, chosen to be visibly different
 *  from what the workspace would default to. */
const PROBES: Record<string, { extracted: unknown; shows: (doc: Record<string, unknown>) => boolean }> = {
  customer: {
    extracted: { company: "ACME Infotech" },
    shows: (d) => String(d.billName ?? "").includes("ACME"),
  },
  items: {
    extracted: [{ desc: "A thing", qty: 7, rate: 99 }],
    shows: (d) => (d.items as { qty?: unknown }[] | undefined)?.[0]?.qty === 7,
  },
  currency: { extracted: "AED", shows: (d) => d.currency === "AED" },
  validityDays: { extracted: 30, shows: (d) => d.validUntil === "2026-01-31" },
  notes: { extracted: "Prices hold to month end.", shows: (d) => String(d.notes ?? "").includes("month end") },
  /* Not a quotation field — it gates the request at the endpoint, which
     refuses before any draft is built. */
  is_quote_request: { extracted: true, shows: () => true },
};

describe("every field the model can return reaches the quotation", () => {
  const declared = Object.keys(QUOTE_TOOL.input_schema.properties);

  it("has a probe for each declared field, so a new field cannot slip in untested", () => {
    expect(declared.sort()).toEqual(Object.keys(PROBES).sort());
  });

  for (const field of declared) {
    it(`uses ${field}`, () => {
      const probe = PROBES[field];
      expect(probe, `no probe for ${field}`).toBeTruthy();
      const { doc } = draftFromText({ [field]: probe!.extracted } as never, ctx);
      expect(probe!.shows(doc as unknown as Record<string, unknown>)).toBe(true);
    });
  }
});
