import { FIELD_LABELS, PROSPECT_FIELDS, type ProspectField } from "./importMap";

/**
 * A file somebody can download, fill in, and upload back.
 *
 * WHY THIS IS WORTH A FILE RATHER THAN A PARAGRAPH OF INSTRUCTIONS. The
 * importer already guesses column names from a wide list of spellings, so a
 * sample is not strictly necessary — but "what columns does it want?" is the
 * first question anybody asks at an empty import screen, and an answer they
 * can open in Excel and type into beats an answer they have to transcribe.
 *
 * The headers are exactly the labels the mapping screen shows, so the guess
 * is exact and somebody comparing the two sees the same words in both places.
 *
 * THE EXAMPLE ROWS TEACH THE AWKWARD CASES, deliberately, because those are
 * where an import goes wrong quietly:
 *
 *   * a company name containing a comma, quoted — the thing that shifts every
 *     column right if a parser splits naively;
 *   * a job title containing a comma, for the same reason;
 *   * a row with only an email, to show that the rest is optional;
 *   * a role address, because procurement@ is frequently the right person to
 *     write to in this business and people assume it will be rejected.
 *
 * The addresses use .example, which is reserved by RFC 2606 and can never be
 * registered. A sample file full of plausible-looking real domains is one
 * somebody eventually forgets to clear out before pressing Import.
 */

/** Only the columns worth putting in a starter file. The importer accepts
 *  every field in PROSPECT_FIELDS; a sample carrying all thirteen reads as a
 *  form to complete rather than an example to follow. */
const SAMPLE_FIELDS: ProspectField[] = [
  "email", "firstName", "lastName", "jobTitle", "company", "phone", "industry", "city",
];

const ROWS: Record<ProspectField, string>[] = [
  {
    email: "ravi.sharma@acme.example",
    firstName: "Ravi",
    lastName: "Sharma",
    jobTitle: "IT Head",
    company: "Acme Technologies Pvt Ltd",
    phone: "+91 98100 12345",
    industry: "Manufacturing",
    city: "New Delhi",
  } as Record<ProspectField, string>,
  {
    /* A comma inside a quoted field, in two columns at once. */
    email: "priya.menon@betasystems.example",
    firstName: "Priya",
    lastName: "Menon",
    jobTitle: "Head of IT, Infrastructure",
    company: "Beta Systems, Bengaluru",
    phone: "+91 98450 67890",
    industry: "IT Services",
    city: "Bengaluru",
  } as Record<ProspectField, string>,
  {
    /* Everything but the address is optional. */
    email: "arun@gammaindustries.example",
    firstName: "",
    lastName: "",
    jobTitle: "",
    company: "",
    phone: "",
    industry: "",
    city: "",
  } as Record<ProspectField, string>,
  {
    /* A shared inbox. Accepted on purpose — see verify.ts. */
    email: "procurement@deltaengineering.example",
    firstName: "",
    lastName: "",
    jobTitle: "Purchase Department",
    company: "Delta Engineering",
    phone: "",
    industry: "Engineering",
    city: "Pune",
  } as Record<ProspectField, string>,
];

/** Quote a cell the way a spreadsheet does: only when it has to be. */
export function csvCell(value: string): string {
  const v = String(value ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The sample file's contents.
 *
 * CRLF line endings and a UTF-8 byte-order mark, because the audience for
 * this file opens it in Excel: without the BOM, Excel reads UTF-8 as the
 * local codepage and a name with an accent arrives mangled; without CRLF,
 * older versions run the rows together.
 */
export function sampleCsv(): string {
  const header = SAMPLE_FIELDS.map((f) => csvCell(FIELD_LABELS[f])).join(",");
  const body = ROWS.map((row) => SAMPLE_FIELDS.map((f) => csvCell(row[f] ?? "")).join(","));
  return `﻿${[header, ...body].join("\r\n")}\r\n`;
}

export const SAMPLE_FILE_NAME = "techzoid-prospects-sample.csv";

/** Every column the importer understands, for the note under the button. */
export const ALL_COLUMN_LABELS: string[] = PROSPECT_FIELDS.map((f) => FIELD_LABELS[f]);
