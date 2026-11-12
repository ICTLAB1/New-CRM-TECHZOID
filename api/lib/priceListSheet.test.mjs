import { describe, expect, it } from "vitest";
import {
  FIELDS,
  headerNames,
  headerRowIndex,
  missingFields,
  readCurrency,
  readGrid,
  stripMoney,
  suggestMapping,
} from "./priceListSheet.mjs";
import { asSheets, readWorkbook } from "./priceListWorkbook.mjs";
import { makeXlsx } from "./testdata/makeXlsx.mjs";

/* A sheet shaped like the ones TechZoid actually receives: a title, a blank
   line, then the header — and a price column with a space on each side of
   its name, which is how the real Microsoft CSP export spells it. */
const CSP_SHEET = [
  ["Microsoft CSP Reseller Price List"],
  ["Effective 1 November 2026", null, null],
  [],
  ["Part No", "SKU Title", "Product Family", "Term Duration", "Unit", " ERP Price ", "Currency"],
  ["M365-E3", "Microsoft 365 E3", "Cloud", "1 Year", "User", 1000, "INR"],
  ["M365-E5", "Microsoft 365 E5", "Cloud", "1 Year", "User", "2,000.50", "INR"],
  ["VISIO-P2", "Visio Plan 2", "Desktop", "1 Year", "User", "₹500", null],
];

describe("finding the header in a real price list", () => {
  it("looks past the title and the effective date", () => {
    expect(headerRowIndex(CSP_SHEET)).toBe(3);
    expect(headerNames(CSP_SHEET, 3)[5]).toBe("ERP Price");
  });

  it("settles for a row naming the product alone when no price column is named", () => {
    const grid = [["Our list"], ["SKU Title", "Notes"], ["M365-E3", "x"]];
    expect(headerRowIndex(grid)).toBe(1);
  });

  it("says so rather than guessing when nothing looks like a header", () => {
    expect(headerRowIndex([["a", "b"], ["c", "d"]])).toBe(-1);
    expect(headerNames([["a", "b"]], -1)).toEqual([]);
  });

  it("does not take a one-cell row for a header", () => {
    // A merged title cell reads as a single value, and "Price list" on its
    // own is a title, not a header.
    expect(headerRowIndex([["Price"], ["SKU", "ERP Price"], ["A", 1]])).toBe(1);
  });
});

describe("guessing which column is which", () => {
  const mapping = suggestMapping(CSP_SHEET[3]);

  it("maps every field the sheet offers", () => {
    expect(mapping).toEqual({
      sku: 0, productName: 1, category: 2, licenceType: 3, unit: 4, resellerPrice: 5, currency: 6,
    });
  });

  it("claims each column once", () => {
    // A sheet whose only text column is "Description" must not become both
    // the SKU and the product name — every row would then carry a part
    // number that is a sentence.
    const m = suggestMapping(["Description", "Price"]);
    expect(m.productName).toBe(0);
    expect(m.sku).toBeUndefined();
    expect(missingFields(m)).toEqual(["sku"]);
  });

  it("prefers the specific name over the vague one, wherever it sits", () => {
    // "Code" comes first in the sheet; "Part No" is what a part number is
    // called. Scanning columns left to right would take the wrong one.
    const m = suggestMapping(["Code", "Part No", "Product Name", "Price"]);
    expect(m.sku).toBe(1);
  });

  it("does not take MRP or the selling price for the reseller price", () => {
    // Those are customer-facing numbers. Taking one as the cost would set
    // every floor far too high and lose every deal silently.
    const m = suggestMapping(["SKU", "Product Name", "MRP", "Selling Price"]);
    expect(m.resellerPrice).toBeUndefined();
    expect(missingFields(m)).toEqual(["resellerPrice"]);
  });

  it("falls back to a column just called Price", () => {
    const m = suggestMapping(["SKU", "Product Name", "Price"]);
    expect(m.resellerPrice).toBe(2);
  });

  it("offers the fields in the order the mapping screen shows them", () => {
    expect(FIELDS.map((f) => f.key)).toEqual([
      "sku", "productName", "category", "licenceType", "unit", "resellerPrice", "currency",
    ]);
  });
});

describe("reading the rows", () => {
  const mapping = suggestMapping(CSP_SHEET[3]);

  it("reads the prices, commas, rupee signs and all", () => {
    const { items, errors } = readGrid(CSP_SHEET, mapping);
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { sku: "M365-E3", productName: "Microsoft 365 E3", category: "Cloud", licenceType: "1 Year", unit: "User", resellerPrice: 1000, currency: "INR", row: 5 },
      { sku: "M365-E5", productName: "Microsoft 365 E5", category: "Cloud", licenceType: "1 Year", unit: "User", resellerPrice: 2000.5, currency: "INR", row: 6 },
      { sku: "VISIO-P2", productName: "Visio Plan 2", category: "Desktop", licenceType: "1 Year", unit: "User", resellerPrice: 500, currency: "INR", row: 7 },
    ]);
  });

  it("numbers the errors by the row in the file", () => {
    // So somebody can open the spreadsheet and go to the row named.
    const grid = [...CSP_SHEET, ["BAD-1", "Something", "Cloud", "1 Year", "User", "ask us", "INR"]];
    const { errors } = readGrid(grid, mapping);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 8, sku: "BAD-1" });
    expect(errors[0].problem).toContain('price "ask us" is not a number');
  });

  it("REFUSES A PRICE OF ZERO, because a floor of nothing is no floor", () => {
    // The product catalog keeps a zero-priced product and calls it "price on
    // request". Here a zero reseller price would mean a minimum selling
    // price of zero, under which a salesperson could quote anything at all
    // and never need anybody's approval.
    const { items, errors } = readGrid([...CSP_SHEET, ["FREE-1", "Trial", "Cloud", "1 Year", "User", 0, "INR"]], mapping);
    expect(items.map((i) => i.sku)).not.toContain("FREE-1");
    expect(errors[0].problem).toContain("reseller price is zero");
  });

  it("refuses a negative price", () => {
    const { errors } = readGrid([...CSP_SHEET, ["CR-1", "Credit note", "Cloud", "1 Year", "User", -50, "INR"]], mapping);
    expect(errors[0].problem).toContain("negative");
  });

  it("names a row with no SKU and a row with no product", () => {
    const { errors } = readGrid([
      ...CSP_SHEET,
      [null, "Mystery item", "Cloud", "1 Year", "User", 100, "INR"],
      ["NO-NAME", null, "Cloud", "1 Year", "User", 100, "INR"],
    ], mapping);
    expect(errors[0].problem).toContain("no SKU");
    expect(errors[1].problem).toContain("no product name");
  });

  it("reports a repeated SKU and points at the row it repeats", () => {
    // The database has a unique index on (list, lower(sku)), so one
    // repeated row would otherwise refuse the whole upload with a message
    // about an index.
    const { items, errors } = readGrid([
      ...CSP_SHEET,
      ["m365-e3", "Microsoft 365 E3 again", "Cloud", "1 Year", "User", 1100, "INR"],
    ], mapping);
    expect(errors).toHaveLength(1);
    expect(errors[0].problem).toContain("repeats row 5");
    expect(items).toHaveLength(3);
  });

  it("passes over blank rows in silence", () => {
    // A report listing four hundred blank rows is a report nobody reads.
    const { items, errors } = readGrid([
      ...CSP_SHEET, [], [null, null, null, null, null, null, null], ["", "", "", "", "", "", ""],
    ], mapping);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(3);
  });

  it("takes INR when the sheet does not say, and reads the ways it might", () => {
    expect(readCurrency(null).currency).toBe("INR");
    expect(readCurrency("Rs.").currency).toBe("INR");
    expect(readCurrency("$").currency).toBe("USD");
    expect(readCurrency(" usd ").currency).toBe("USD");
    expect(readCurrency("AED").currency).toBe("AED");
  });

  it("complains about a currency it cannot read rather than inventing one", () => {
    const { currency, problem } = readCurrency("per month");
    expect(currency).toBe("INR");
    expect(problem).toContain("not understood");
  });

  it("works from a mapping that leaves the optional columns out", () => {
    const grid = [["SKU", "Product Name", "Price"], ["A-1", "Thing", 250]];
    const { items, errors } = readGrid(grid, suggestMapping(grid[0]));
    expect(errors).toEqual([]);
    expect(items[0]).toEqual({
      sku: "A-1", productName: "Thing", category: null, licenceType: null, unit: null,
      resellerPrice: 250, currency: "INR", row: 2,
    });
  });

  it("rounds to the paisa, because the column is numeric(14,2)", () => {
    const grid = [["SKU", "Product Name", "Price"], ["A-1", "Thing", 100.005], ["A-2", "Thing 2", 99.994]];
    const { items } = readGrid(grid, suggestMapping(grid[0]));
    expect(items.map((i) => i.resellerPrice)).toEqual([100.01, 99.99]);
  });

  it("strips what a spreadsheet puts round a number", () => {
    expect(stripMoney("₹ 1,234.56")).toBe("1234.56");
    expect(stripMoney("INR 500")).toBe("500");
    expect(stripMoney(1000)).toBe("1000");
  });

  it("honours an explicit header row over the one it would have found", () => {
    // The mapping screen lets an Admin correct it.
    const { items } = readGrid(CSP_SHEET, { sku: 0, productName: 1, resellerPrice: 5 }, { headerRow: 4 });
    expect(items.map((i) => i.sku)).toEqual(["M365-E5", "VISIO-P2"]);
  });
});

describe("a real .xlsx, end to end", () => {
  it("reads a workbook built as a file and gets the same rows", async () => {
    // Not an array of arrays the test made up: a real ZIP of real
    // SpreadsheetML, opened by the library that will open the uploads.
    const sheets = await readWorkbook(makeXlsx([{ name: "Nov 2026", rows: CSP_SHEET }]));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Nov 2026");

    const headerAt = headerRowIndex(sheets[0].rows);
    const mapping = suggestMapping(sheets[0].rows[headerAt]);
    const { items, errors } = readGrid(sheets[0].rows, mapping, { headerRow: headerAt });

    expect(errors).toEqual([]);
    expect(items.map((i) => [i.sku, i.resellerPrice])).toEqual([
      ["M365-E3", 1000], ["M365-E5", 2000.5], ["VISIO-P2", 500],
    ]);
  });

  it("keeps a workbook's sheets apart and named", async () => {
    const sheets = await readWorkbook(makeXlsx([
      { name: "Read me first", rows: [["Terms of use"]] },
      { name: "Microsoft", rows: [["SKU", "Product Name", "Price"], ["A", "Thing", 1]] },
    ]));
    expect(sheets.map((s) => s.name)).toEqual(["Read me first", "Microsoft"]);
    expect(headerRowIndex(sheets[0].rows)).toBe(-1);
    expect(headerRowIndex(sheets[1].rows)).toBe(0);
  });

  it("tells somebody who uploaded the wrong thing what to do about it", async () => {
    await expect(readWorkbook(Buffer.from("SKU,Price\nA,1\n"))).rejects.toThrow(/not an .xlsx file/);
    await expect(readWorkbook(Buffer.alloc(0))).rejects.toThrow(/empty/);
    await expect(readWorkbook(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).rejects.toThrow(/could not be opened/);
  });

  it("refuses a file too big to be a price list", async () => {
    const huge = Buffer.alloc(13 * 1024 * 1024);
    huge[0] = 0x50; huge[1] = 0x4b;
    await expect(readWorkbook(huge)).rejects.toThrow(/13 MB/);
  });

  it("copes with either shape the library might return", () => {
    // Pinned exactly for this reason: this version returns { sheet, data }
    // and its README describes a bare grid.
    expect(asSheets([{ sheet: "A", data: [[1]] }])).toEqual([{ name: "A", rows: [[1]] }]);
    expect(asSheets([[1, 2], [3, 4]])).toEqual([{ name: "Sheet1", rows: [[1, 2], [3, 4]] }]);
    expect(asSheets([])).toEqual([]);
    expect(asSheets(null)).toEqual([]);
  });
});
