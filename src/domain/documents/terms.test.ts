import { describe, expect, it } from "vitest";
import { DOMESTIC_TERMS, INTERNATIONAL_TERMS, suggestTermsSet, TERMS_SETS } from "./terms";

describe("default terms", () => {
  it("carries the fourteen supplied domestic clauses", () => {
    expect(DOMESTIC_TERMS).toHaveLength(14);
    expect(DOMESTIC_TERMS[0]).toContain("valid for 30 days");
    expect(DOMESTIC_TERMS[13]).toContain("courts at New Delhi");
  });

  it("mentions no licence keys, activation or provisioning", () => {
    // The approved design's spec is explicit about this. It also means the
    // non-returnable-licence cover from v1 is gone — see docs/DEVIATIONS.md.
    for (const t of DOMESTIC_TERMS) {
      expect(t.toLowerCase()).not.toMatch(/licence key|license key|activation|provisioning/);
    }
  });

  it("keeps the export set, which differs in law and not only in wording", () => {
    const joined = INTERNATIONAL_TERMS.join(" ");
    expect(joined).toContain("Incoterms 2020");
    expect(joined).toContain("zero-rated");
    expect(joined).toContain("importer of record");
    expect(joined).toContain("export control");
    expect(joined).toContain("CISG");
    expect(joined).toContain("arbitration");
  });

  it("offers both sets", () => {
    expect(TERMS_SETS.map((s) => s.id)).toEqual(["domestic", "international"]);
  });
});

describe("suggesting a set from the customer's country", () => {
  it("suggests domestic for India and for an unknown country", () => {
    expect(suggestTermsSet("India").id).toBe("domestic");
    expect(suggestTermsSet("").id).toBe("domestic");
    expect(suggestTermsSet(null).id).toBe("domestic");
  });

  it("suggests export for anywhere else", () => {
    for (const c of ["United Arab Emirates", "Singapore", "Germany"]) {
      expect(suggestTermsSet(c).id, c).toBe("international");
    }
  });

  it("ignores surrounding whitespace", () => {
    expect(suggestTermsSet("  India  ").id).toBe("domestic");
  });
});
