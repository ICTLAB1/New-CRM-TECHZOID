import { describe, expect, it } from "vitest";
import {
  DOMESTIC_TERMS, INTERNATIONAL_TERMS, INVOICE_EXPORT_TERMS, INVOICE_TERMS,
  INVOICE_TERMS_SETS, SELLER_TOKEN, forCompany, suggestTermsSet, termsSetsFor, TERMS_SETS,
} from "./terms";

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

describe("tax invoice terms", () => {
  /* The reported symptom: a tax invoice printed "Quotation is valid for 30
     days from the date of issue" as its first clause, because it carried
     the quotation's set. An invoice is not an offer and has no validity
     window. */
  it("says nothing about a quotation or a validity window", () => {
    for (const set of [INVOICE_TERMS, INVOICE_EXPORT_TERMS]) {
      const joined = set.join(" ").toLowerCase();
      expect(joined).not.toContain("quotation");
      expect(joined).not.toContain("valid for");
    }
  });

  it("covers what an invoice is actually for", () => {
    const joined = INVOICE_TERMS.join(" ");
    expect(joined).toContain("Payment is due");
    expect(joined).toContain("bank account printed on this invoice");
    expect(joined).toContain("Title to the goods passes");
    expect(joined).toContain("Micro, Small and Medium Enterprises Development Act, 2006");
    expect(joined).toContain("HSN/SAC");
    expect(joined).toContain("courts at New Delhi");
  });

  it("keeps the export invoice differing in law, not only in wording", () => {
    const joined = INVOICE_EXPORT_TERMS.join(" ");
    expect(joined).toContain("zero-rated");
    expect(joined).toContain("Incoterms 2020");
    expect(joined).toContain("importer of record");
    expect(joined).toContain("export control");
    expect(joined).toContain("CISG");
    expect(joined).toContain("arbitration");
    /* GST is charged on a domestic invoice and not on an export one.
       Getting that the wrong way round is a tax figure, not a wording. */
    expect(INVOICE_TERMS.join(" ")).not.toContain("zero-rated");
  });

  it("warns against a change of bank details by email", () => {
    /* The single most common way an invoice is defrauded. It belongs on
       the document, not in an internal note. */
    for (const set of [INVOICE_TERMS, INVOICE_EXPORT_TERMS]) {
      expect(set.join(" ")).toContain("will not change its bank details by email");
    }
  });

  it("follows the design's wording preference on licence keys", () => {
    /* Same rule as the quotation set: the approved spec says not to
       mention licence keys, activation or provisioning. The cover is
       written around the publisher's own licence terms instead — see
       docs/DEVIATIONS.md. */
    for (const t of [...INVOICE_TERMS, ...INVOICE_EXPORT_TERMS]) {
      expect(t.toLowerCase()).not.toMatch(/licence key|license key|activation|provisioning/);
    }
  });

  it("is what an invoice chooses between", () => {
    expect(termsSetsFor("invoice")).toBe(INVOICE_TERMS_SETS);
    expect(termsSetsFor("quotation")).toBe(TERMS_SETS);
    expect(termsSetsFor("proforma")).toBe(TERMS_SETS);
  });

  it("suggests by country within the invoice pair", () => {
    expect(suggestTermsSet("India", "invoice").terms).toBe(INVOICE_TERMS);
    expect(suggestTermsSet("United Arab Emirates", "invoice").terms).toBe(INVOICE_EXPORT_TERMS);
    /* And a quotation is unaffected by the new pair existing. */
    expect(suggestTermsSet("India").terms).toBe(DOMESTIC_TERMS);
    expect(suggestTermsSet("Germany").terms).toBe(INTERNATIONAL_TERMS);
  });
});

describe("the seller's own name", () => {
  const ALL = [DOMESTIC_TERMS, INTERNATIONAL_TERMS, INVOICE_TERMS, INVOICE_EXPORT_TERMS];

  it("is a token in the stored text, never one company's name", () => {
    /* Written into the text, TechZoid's name would appear in Vertex's own
       terms, promising and disclaiming on behalf of another business —
       the same mistake as the TZ/ prefix on Vertex's first quotation. */
    for (const set of ALL) {
      expect(set.join(" ")).not.toContain("TechZoid");
    }
  });

  it("is filled in when a set is applied", () => {
    const out = forCompany(INVOICE_TERMS, "Vertex Infosolutions");
    expect(out.join(" ")).toContain("Vertex Infosolutions");
    expect(out.join(" ")).not.toContain(SELLER_TOKEN);
  });

  it("renders TechZoid's terms exactly as they read before", () => {
    const out = forCompany(DOMESTIC_TERMS, "TechZoid Technologies Private Limited");
    expect(out[11]).toBe(
      "TechZoid Technologies Private Limited shall not be responsible for delays caused by "
      + "circumstances beyond its reasonable control, including manufacturer, distributor, "
      + "logistics or regulatory delays.",
    );
  });

  it("falls back to a neutral phrase rather than someone else's name", () => {
    for (const name of ["", "   ", null, undefined]) {
      const out = forCompany(INVOICE_TERMS, name);
      expect(out.join(" ")).toContain("the Company");
      expect(out.join(" ")).not.toContain(SELLER_TOKEN);
    }
  });
});
