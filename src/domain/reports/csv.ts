/**
 * CSV export.
 *
 * Written by hand rather than pulled from a library because the rules that
 * matter are few and the failure modes are specific: an unescaped quote or
 * comma silently shifts every column after it, and a customer named
 * "Sharma, R & Co" is not unusual.
 */

/** Values a cell can hold before formatting. */
export type CsvValue = string | number | boolean | null | undefined;

/**
 * Escape one cell.
 *
 * Quotes are doubled and the cell wrapped when it contains a comma, quote,
 * newline or leading/trailing space. A leading =, +, - or @ is prefixed with
 * a quote: spreadsheets treat those as formulas, and a cell reading
 * `=cmd|...` in an exported customer list is a real attack, not a curiosity.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s) || s !== s.trim()) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(headers: readonly string[], rows: readonly CsvValue[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  /* CRLF: Excel on Windows is the overwhelmingly common destination. */
  return lines.join("\r\n");
}

/** Rows of objects, in a stated column order — so a report's columns do not
 *  change because a field happened to be missing from the first row. */
export function objectsToCsv<T extends Record<string, CsvValue>>(
  columns: readonly { key: keyof T & string; label: string }[],
  rows: readonly T[],
): string {
  return toCsv(columns.map((c) => c.label), rows.map((r) => columns.map((c) => r[c.key])));
}

/** A filename that survives Windows, macOS and Linux. */
export function csvFilename(report: string, today: string): string {
  return `techzoid-${report.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${today}.csv`;
}

/** Hand the file to the browser. Import-free so it can be called anywhere. */
export function downloadCsv(filename: string, csv: string): void {
  /* The BOM is what makes Excel read UTF-8 rather than mangling ₹ and
     accented customer names. */
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
