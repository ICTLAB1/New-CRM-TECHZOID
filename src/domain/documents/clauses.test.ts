import { describe, expect, it } from "vitest";
import { NOTE_LABEL, partitionClauses, splitClause } from "./clauses";
import { DOMESTIC_TERMS, INTERNATIONAL_TERMS, INVOICE_TERMS, PURCHASE_ORDER_TERMS } from "./terms";

describe("reading a run-in heading", () => {
  it("splits a supplied clause into its heading and its sentence", () => {
    expect(splitClause("Payment Terms: Payment shall be made as per the quotation.")).toEqual({
      label: "Payment Terms",
      body: "Payment shall be made as per the quotation.",
    });
  });

  it("leaves a plain sentence alone", () => {
    const t = "All disputes shall be subject to the jurisdiction of the courts at New Delhi, India.";
    expect(splitClause(t)).toEqual({ label: null, body: t });
  });

  /* THE RULES THAT STOP A SENTENCE BEING READ AS A HEADING. Each of these
     contains a colon and must still print as one sentence. */
  it("refuses a heading that is too long, punctuated, empty or has nothing after it", () => {
    const notHeadings = [
      "Where the supplier fails to deliver by the agreed date, time being of the essence: the buyer may cancel.",
      "Note. Something: follows a full stop.",
      ": leading colon",
      "Trailing colon: ",
    ];
    for (const t of notHeadings) expect(splitClause(t).label, t).toBeNull();
  });

  it("keeps the whole text when there is no heading", () => {
    /* Nothing may be lost in the split: a renderer prints only what comes
       back, so a dropped word is a word the customer never sees. */
    for (const set of [DOMESTIC_TERMS, INTERNATIONAL_TERMS, INVOICE_TERMS, PURCHASE_ORDER_TERMS]) {
      for (const t of set) {
        const { label, body } = splitClause(t);
        expect(label ? `${label}: ${body}` : body, t).toBe(t);
      }
    }
  });

  it("finds no headings in the sets that are written as plain sentences", () => {
    for (const set of [INTERNATIONAL_TERMS, INVOICE_TERMS, PURCHASE_ORDER_TERMS]) {
      for (const t of set) expect(splitClause(t).label, t).toBeNull();
    }
  });

  it("finds a heading on every supplied domestic clause", () => {
    for (const t of DOMESTIC_TERMS) expect(splitClause(t).label, t).not.toBeNull();
  });
});

describe("keeping notes out of the numbering", () => {
  it("puts the GeM note aside and numbers the rest", () => {
    const { numbered, notes } = partitionClauses(DOMESTIC_TERMS);
    expect(numbered).toHaveLength(20);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("GeM bid conditions");
    expect(numbered.join(" ")).not.toContain("GeM bid conditions");
  });

  it("prints a note last however it is ordered, so moving one renumbers nothing", () => {
    const { numbered, notes } = partitionClauses([
      "First: one.",
      `${NOTE_LABEL}: read this.`,
      "Second: two.",
    ]);
    expect(numbered).toEqual(["First: one.", "Second: two."]);
    expect(notes).toEqual([`${NOTE_LABEL}: read this.`]);
  });

  it("drops blank lines rather than numbering them", () => {
    expect(partitionClauses(["A: one.", "", "   "]).numbered).toEqual(["A: one."]);
  });

  it("treats a set with no notes as all clauses", () => {
    expect(partitionClauses(INVOICE_TERMS).notes).toEqual([]);
    expect(partitionClauses(INVOICE_TERMS).numbered).toHaveLength(INVOICE_TERMS.length);
  });
});
