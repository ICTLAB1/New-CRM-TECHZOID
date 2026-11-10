import { describe, expect, it } from "vitest";
import {
  DOMESTIC_TERMS, INTERNATIONAL_TERMS, INVOICE_EXPORT_TERMS, INVOICE_TERMS,
  INVOICE_TERMS_SETS, SELLER_TOKEN, forCompany, suggestTermsSet, termsSetsFor, TERMS_SETS,
} from "./terms";
import { partitionClauses } from "./clauses";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("default terms", () => {
  it("carries the twenty supplied domestic clauses and the GeM note", () => {
    expect(DOMESTIC_TERMS).toHaveLength(21);
    expect(DOMESTIC_TERMS[0]).toContain("valid for 7 days");
    expect(DOMESTIC_TERMS[19]).toContain("Acceptance of Terms:");
    /* The note is last and is not one of the twenty — partitionClauses
       keeps it out of the numbering. */
    expect(DOMESTIC_TERMS[20]).toMatch(/^Important Note: /);
    expect(partitionClauses(DOMESTIC_TERMS).numbered).toHaveLength(20);
  });

  it("covers what this business actually sells", () => {
    /* The point of replacing the generic fourteen. Each of these is a real
       exposure for a licence reseller that the old set said nothing about. */
    const joined = DOMESTIC_TERMS.join(" ");
    expect(joined).toContain("No TDS shall be deducted on the purchase of software licenses");
    expect(joined).toContain("non-cancellable and non-refundable");
    expect(joined).toContain("Auto-renewal shall not be assumed");
    expect(joined).toContain("exchange-rate fluctuations");
    expect(joined).toContain("End User License Agreement (EULA)");
  });

  it("quotes the TDS notification exactly", () => {
    /* A citation that is almost right is worse than none: somebody will
       rely on it. Reproduced character for character as supplied. */
    expect(DOMESTIC_TERMS[2]).toContain(
      "CBDT Notification No. 21/2012 [F. No. 142/10/2012-SO (TPL)], S.O. 1323(E), dated 13 June 2012, effective from 1 July 2012",
    );
  });

  it("names no company of its own, so the second company's terms are its own", () => {
    /* The supplied text names TechZoid in the force majeure clause. A
       force majeure clause naming the wrong business excuses the wrong
       one — see SELLER_TOKEN. */
    for (const t of DOMESTIC_TERMS) expect(t).not.toMatch(/TechZoid/i);
    expect(DOMESTIC_TERMS[16]).toContain(SELLER_TOKEN);
    expect(forCompany(DOMESTIC_TERMS, "Vertex Trading FZE")[16]).toContain(
      "Vertex Trading FZE shall not be held liable",
    );
  });

  it("deliberately covers licence activation, which the old set could not", () => {
    /* The reverse of what this file used to assert. The approved design's
       spec said not to mention licence keys, activation or provisioning,
       which left a licence reseller with no cancellation cover on its main
       product line — recorded as deviation 4b. The company has now
       supplied terms that cover it directly, so the restriction is spent.
       Pinned so it is not quietly reintroduced. */
    const joined = DOMESTIC_TERMS.join(" ").toLowerCase();
    expect(joined).toContain("activation keys");
    expect(joined).toContain("license activation & delivery");
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

  it("keeps its cover written around the publisher's own licence terms", () => {
    /* The quotation set no longer avoids these words — the company has
       supplied terms that name activation directly. The invoice sets
       still phrase the same cover around what the publisher and
       distributor allow, which is deliberate and is what this pins: an
       invoice is not the document on which to argue about entitlement.
       See docs/DEVIATIONS.md 4b and 4b-ii. */
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

  it("renders TechZoid's force majeure clause exactly as supplied", () => {
    /* The one clause where the supplied text named the company. Filled in
       for TechZoid it must read character for character as written. */
    const out = forCompany(DOMESTIC_TERMS, "TechZoid Technologies Private Limited");
    expect(out[16]).toBe(
      "Force Majeure: TechZoid Technologies Private Limited shall not be held liable for delays "
      + "or failure to perform obligations due to circumstances beyond its reasonable control, "
      + "including natural disasters, government restrictions, strikes, war, internet outages or "
      + "manufacturer disruptions.",
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

describe("the migration that puts these terms where documents read them", () => {
  /**
   * DOMESTIC_TERMS is the LAST of three places a new quotation looks for
   * its terms: a quotation template's own terms, then
   * settings.defaultTerms, then this. The first two are stored per
   * workspace, so changing the code alone changes what a brand-new
   * workspace would get and nothing about what a running one prints —
   * which is exactly what happened, and what the latest terms migration
   * is for.
   *
   * IF THIS FAILS, the clauses above were edited and the stored copies
   * were not. The fix is a NEW migration, written by
   * `npx tsx scripts/terms-migration.ts <next number>` — never an edit to
   * one that has already been applied, because the ledger will not run it
   * again and the edit would reach no database at all.
   */
  const latestTermsMigration = (): { name: string; arrays: string[][] } => {
    const dir = "supabase";
    const files = readdirSync(dir)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort()
      .reverse();
    for (const name of files) {
      const text = readFileSync(join(dir, name), "utf8");
      const arrays: string[][] = [];
      const re = /\$json\$([\s\S]*?)\$json\$/g;
      for (let m = re.exec(text); m; m = re.exec(text)) arrays.push(JSON.parse(m[1]!) as string[]);
      if (arrays.length) return { name, arrays };
    }
    throw new Error("no migration carries a terms array");
  };

  const latest = latestTermsMigration();

  it("writes exactly these clauses, wherever it writes them", () => {
    /* Every clause list the latest terms migration carries must be this
       file's set, character for character. Earlier migrations are left
       alone on purpose: each is a record of what was applied at the
       time, and rewriting one would be rewriting history that has
       already run. */
    expect(latest.arrays.length, latest.name).toBeGreaterThan(0);
    for (const arr of latest.arrays) expect(arr, latest.name).toEqual([...DOMESTIC_TERMS]);
  });

  it("keeps the token rather than a company name", () => {
    /* The stored set is filled in per document by create.ts. A name baked
       in here would be the wrong company's on the other company's
       quotations. */
    const text = readFileSync(join("supabase", latest.name), "utf8");
    expect(text).toContain(SELLER_TOKEN);
    expect(text).not.toMatch(/TechZoid/i);
  });

  it("keeps what it replaces", () => {
    /* Whatever it overwrites — a workspace default, a template's terms,
       a draft's — the previous value is saved beside it under a
       Before<nnn> key, so every one of these is reversible. */
    const text = readFileSync(join("supabase", latest.name), "utf8");
    expect(text).toMatch(/Before\d{3}/);
  });
});
