import { describe, expect, it } from "vitest";
import { parseCsv, parseDelimited, sniffDelimiter } from "./csv";

describe("reading a prospect list somebody exported", () => {
  it("reads the ordinary case", () => {
    const out = parseCsv("Email,Company\nravi@acme.example,Acme\n");
    expect(out.headers).toEqual(["Email", "Company"]);
    expect(out.rows).toEqual([{ Email: "ravi@acme.example", Company: "Acme" }]);
  });

  /* THE BUG THIS FILE EXISTS TO PREVENT. Splitting on commas turns this one
     row into two and shifts every column after it — silently. */
  it("keeps a comma that is inside quotes", () => {
    const out = parseCsv('Company,City\n"Acme Pvt Ltd, Delhi",Delhi\n');
    expect(out.rows[0]).toEqual({ Company: "Acme Pvt Ltd, Delhi", City: "Delhi" });
  });

  it("understands a doubled quote as one quote", () => {
    const out = parseCsv('Name\n"He said ""yes"""\n');
    expect(out.rows[0]!.Name).toBe('He said "yes"');
  });

  it("keeps a newline that is inside quotes", () => {
    const out = parseCsv('Address,City\n"12 Nehru Road\nBlock B",Delhi\n');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.Address).toBe("12 Nehru Road\nBlock B");
  });

  it("reads a file Excel wrote, CRLF and all", () => {
    const out = parseCsv("Email,Company\r\nravi@acme.example,Acme\r\n");
    expect(out.rows).toEqual([{ Email: "ravi@acme.example", Company: "Acme" }]);
  });

  /* Left in, it becomes part of the first header and every mapping guess
     misses — the import then looks like it has no email column. */
  it("strips the byte-order mark Excel puts at the front", () => {
    const out = parseCsv("﻿Email,Company\nravi@acme.example,Acme\n");
    expect(out.headers[0]).toBe("Email");
  });

  it("reads the last row of a file that does not end in a newline", () => {
    expect(parseCsv("Email\na@x.example").rows).toHaveLength(1);
  });

  it("skips blank lines rather than importing empty people", () => {
    const out = parseCsv("Email\n\na@x.example\n\n\nb@x.example\n");
    expect(out.rows.map((r) => r.Email)).toEqual(["a@x.example", "b@x.example"]);
  });

  /* Two columns both called Email is a real export. Losing the second
     without saying so is how somebody's mobile numbers disappear. */
  it("keeps a duplicated header instead of overwriting it", () => {
    const out = parseCsv("Email,Email\na@x.example,b@x.example\n");
    expect(out.headers).toEqual(["Email", "Email (2)"]);
    expect(out.rows[0]).toEqual({ Email: "a@x.example", "Email (2)": "b@x.example" });
  });

  it("names a blank header rather than keying a column on nothing", () => {
    const out = parseCsv("Email,,Company\na@x.example,x,Acme\n");
    expect(out.headers).toEqual(["Email", "Column 2", "Company"]);
  });

  it("reports a row with the wrong number of columns without dropping it", () => {
    const out = parseCsv("Email,Company\na@x.example\nb@x.example,Beta\n");
    expect(out.ragged).toEqual([2]);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]!.Company).toBe("");
  });

  /* A phone number starting 0, and a GSTIN that looks like a number in
     scientific notation, are the two things a "helpful" parser destroys. */
  it("leaves everything a string, keeping a leading zero", () => {
    const out = parseCsv("Phone,Code\n01126543210,1.2E+11\n");
    expect(out.rows[0]).toEqual({ Phone: "01126543210", Code: "1.2E+11" });
  });

  it("handles an empty file without throwing", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], ragged: [] });
  });

  it("handles a header with no data rows", () => {
    const out = parseCsv("Email,Company\n");
    expect(out.headers).toEqual(["Email", "Company"]);
    expect(out.rows).toEqual([]);
  });
});

describe("working out how a file is separated", () => {
  it("spots a semicolon export", () => {
    expect(sniffDelimiter("Email;Company;City\n")).toBe(";");
    expect(parseCsv("Email;Company\na@x.example;Acme\n").rows[0]!.Company).toBe("Acme");
  });

  it("spots a tab-separated file saved as .csv", () => {
    expect(sniffDelimiter("Email\tCompany\tCity\n")).toBe("\t");
  });

  it("defaults to a comma", () => {
    expect(sniffDelimiter("Email,Company\n")).toBe(",");
    expect(sniffDelimiter("Email\n")).toBe(",");
  });

  it("does not mistake a comma inside a quoted field for the delimiter", () => {
    /* Only one real column here; the comma is inside quotes. */
    expect(parseDelimited('"Acme, Delhi"', ",")[0]).toEqual(["Acme, Delhi"]);
  });
});
