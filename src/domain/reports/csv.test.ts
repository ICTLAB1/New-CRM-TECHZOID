import { describe, expect, it } from "vitest";
import { csvCell, csvFilename, objectsToCsv, toCsv } from "./csv";

describe("escaping a cell", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("Acme Industries")).toBe("Acme Industries");
    expect(csvCell(1234.5)).toBe("1234.5");
  });

  it("quotes and doubles quotes", () => {
    expect(csvCell('He said "hello"')).toBe('"He said ""hello"""');
  });

  it("quotes a cell containing a comma", () => {
    // "Sharma, R & Co" is not an unusual customer name, and an unescaped
    // comma shifts every column after it.
    expect(csvCell("Sharma, R & Co")).toBe('"Sharma, R & Co"');
  });

  it("quotes a cell containing a newline", () => {
    expect(csvCell("Line one\nLine two")).toBe('"Line one\nLine two"');
  });

  it("quotes a cell with leading or trailing space, which would be trimmed", () => {
    expect(csvCell("  padded  ")).toBe('"  padded  "');
  });

  it("neutralises a formula, which a spreadsheet would otherwise execute", () => {
    // A cell reading =cmd|... in an exported customer list is an attack.
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+44 20 1234")).toBe("'+44 20 1234");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@handle")).toBe("'@handle");
  });

  it("renders empty for null and undefined rather than the words", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("renders booleans plainly", () => {
    expect(csvCell(true)).toBe("true");
  });
});

describe("building a file", () => {
  it("writes a header row and CRLF line endings", () => {
    const csv = toCsv(["A", "B"], [[1, 2], [3, 4]]);
    expect(csv).toBe("A,B\r\n1,2\r\n3,4");
  });

  it("writes a header even with no rows", () => {
    expect(toCsv(["A", "B"], [])).toBe("A,B");
  });

  it("keeps the stated column order whatever the objects hold", () => {
    // A report's columns must not change because a field was missing from
    // the first row.
    const csv = objectsToCsv(
      [{ key: "name", label: "Customer" }, { key: "value", label: "Value" }],
      [{ name: "Acme", value: 100 }, { name: "Northline", value: undefined }],
    );
    expect(csv).toBe("Customer,Value\r\nAcme,100\r\nNorthline,");
  });
});

describe("filenames", () => {
  it("is safe on every platform", () => {
    expect(csvFilename("Sales by salesperson", "2026-08-24")).toBe("techzoid-sales-by-salesperson-2026-08-24.csv");
  });

  it("collapses punctuation rather than emitting it", () => {
    expect(csvFilename("Revenue / margin (FY)", "2026-08-24")).toBe("techzoid-revenue-margin-fy-2026-08-24.csv");
  });
});
