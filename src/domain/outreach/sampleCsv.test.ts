import { describe, expect, it } from "vitest";
import { ALL_COLUMN_LABELS, SAMPLE_FILE_NAME, csvCell, sampleCsv } from "./sampleCsv";
import { parseCsv } from "./csv";
import { auditRows, inferMapping } from "./importMap";

/**
 * The sample file has to survive its own round trip.
 *
 * A starter file that the importer then complains about is worse than no
 * starter file, so these run the real parser and the real audit over it —
 * the same two functions the upload path uses.
 */

describe("the sample file somebody downloads", () => {
  const text = sampleCsv();
  const parsed = parseCsv(text);

  it("parses back with no malformed rows", () => {
    expect(parsed.ragged).toEqual([]);
    expect(parsed.rows).toHaveLength(4);
  });

  /* If the headers drift from the labels the mapping screen shows, somebody
     downloads a file the importer then cannot read. */
  it("maps every one of its own columns without a person touching anything", () => {
    const mapping = inferMapping(parsed.headers);
    for (const header of parsed.headers) {
      expect(Object.values(mapping), `nothing claimed the "${header}" column`).toContain(header);
    }
    expect(mapping.email).toBeTruthy();
  });

  it("passes the audit — every row importable, nothing flagged", () => {
    const audit = auditRows(parsed.rows, inferMapping(parsed.headers));
    expect(audit.total).toBe(4);
    expect(audit.importable, JSON.stringify(audit.counts)).toBe(4);
  });

  /* The row that exists to demonstrate the awkward case has to actually
     demonstrate it — a quoted comma that does not shift the columns. */
  it("keeps a comma that sits inside a company name", () => {
    const row = parsed.rows.find((r) => r["Work email"]?.includes("priya"));
    expect(row?.Company).toBe("Beta Systems, Bengaluru");
    expect(row?.["Job title"]).toBe("Head of IT, Infrastructure");
    expect(row?.City).toBe("Bengaluru");
  });

  it("shows that everything but the address is optional", () => {
    const row = parsed.rows.find((r) => r["Work email"]?.includes("arun"));
    expect(row?.["First name"]).toBe("");
    expect(row?.Company).toBe("");
  });

  /* procurement@ is frequently the right person to write to in this
     business, and people assume a tool will reject it. */
  it("includes a role address, and the audit accepts it", () => {
    const row = parsed.rows.find((r) => r["Work email"]?.startsWith("procurement@"));
    expect(row).toBeTruthy();
    const audit = auditRows([row!], inferMapping(parsed.headers));
    expect(audit.importable).toBe(1);
  });

  /* A sample full of plausible real domains is one somebody forgets to clear
     out before pressing Import. .example can never be registered. */
  it("uses only addresses that can never reach a real person", () => {
    for (const row of parsed.rows) {
      expect(row["Work email"], row["Work email"]).toMatch(/@[a-z.]+\.example$/);
    }
  });

  it("opens correctly in Excel", () => {
    expect(text.charCodeAt(0), "no byte-order mark — accented names arrive mangled").toBe(0xfeff);
    expect(text, "no CRLF — older Excel runs the rows together").toContain("\r\n");
  });

  it("is named something recognisable in a downloads folder", () => {
    expect(SAMPLE_FILE_NAME).toMatch(/\.csv$/);
    expect(SAMPLE_FILE_NAME).toContain("prospect");
  });

  it("lists every column the importer understands, for the note beside it", () => {
    expect(ALL_COLUMN_LABELS).toContain("Work email");
    expect(ALL_COLUMN_LABELS).toContain("LinkedIn");
    expect(ALL_COLUMN_LABELS.length).toBeGreaterThan(parsed.headers.length);
  });
});

describe("quoting a cell", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvCell("Acme Ltd")).toBe("Acme Ltd");
  });

  it("quotes a comma", () => {
    expect(csvCell("Acme, Delhi")).toBe('"Acme, Delhi"');
  });

  it("doubles an embedded quote", () => {
    expect(csvCell('He said "yes"')).toBe('"He said ""yes"""');
  });

  it("quotes a newline", () => {
    expect(csvCell("Line one\nLine two")).toBe('"Line one\nLine two"');
  });
});
