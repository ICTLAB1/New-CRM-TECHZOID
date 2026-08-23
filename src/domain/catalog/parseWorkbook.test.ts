import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { mergeCatalog, parseProductCatalogWorkbook } from "./parseWorkbook";
import type { CatalogProduct } from "./types";

/** Build a workbook from sheets of raw cell rows. */
function wbOf(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return wb;
}

describe("known column layouts", () => {
  it("reads a Microsoft CSP pricelist", () => {
    const wb = wbOf({
      NCE: [
        ["ProductId", "SkuId", "SkuTitle", "Publisher", "TermDuration", "BillingPlan", "Segment", "ERP Price"],
        ["CFQ7TTC0LH18", "0001", "Microsoft 365 Business Premium", "Microsoft", "P1Y", "Annual", "Commercial", "20880"],
      ],
    });
    const { products, sheetStats } = parseProductCatalogWorkbook(wb);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      name: "Microsoft 365 Business Premium",
      publisher: "Microsoft",
      skuId: "0001",
      termDuration: "1 Year",
      billingPlan: "Annual",
      sellPrice: 20880,
      licenseType: "NCE",
      active: true,
    });
    expect(sheetStats[0]).toMatchObject({ name: "NCE", count: 1, inferred: null });
  });

  it("tolerates headers padded with whitespace", () => {
    // TechZoid's real CSP export has a column literally named " ERP Price ".
    const wb = wbOf({ Sheet1: [["  SkuTitle  ", " ERP Price "], ["Visio Plan 2", "1200"]] });
    const { products } = parseProductCatalogWorkbook(wb);
    expect(products[0]?.sellPrice).toBe(1200);
  });

  it("matches header names case-insensitively", () => {
    const wb = wbOf({ Sheet1: [["PARTICULARS", "SELLING PRICE"], ["Kaspersky Endpoint Security", "3500"]] });
    const { products } = parseProductCatalogWorkbook(wb);
    expect(products[0]).toMatchObject({ name: "Kaspersky Endpoint Security", sellPrice: 3500 });
  });

  it.each([
    ["Product Name", "MRP"],
    ["Description", "Rate"],
    ["Item Name", "Unit Price"],
    ["Item", "List Price"],
    ["Name", "Amount"],
    ["SKU Description", "Price"],
    ["Product Description", "ERP"],
  ])("reads a sheet headed %s / %s", (nameCol, priceCol) => {
    const wb = wbOf({ S: [[nameCol, priceCol], ["Adobe Acrobat Pro", "17000"]] });
    const { products } = parseProductCatalogWorkbook(wb);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ name: "Adobe Acrobat Pro", sellPrice: 17000 });
  });
});

describe("header row detection", () => {
  it("finds a header buried under title rows", () => {
    const wb = wbOf({
      Pricelist: [
        ["ACME DISTRIBUTORS PVT LTD"],
        ["Price list valid January 2026"],
        [],
        ["Product Name", "MRP"],
        ["Autodesk AutoCAD LT", "42000"],
        ["Autodesk Revit", "265000"],
      ],
    });
    const { products, sheetStats } = parseProductCatalogWorkbook(wb);
    expect(products.map((p) => p.name)).toEqual(["Autodesk AutoCAD LT", "Autodesk Revit"]);
    expect(sheetStats[0]?.count).toBe(2);
  });

  it("falls back to inference when the header sits past the 15-row scan window", () => {
    // v1 behaviour, preserved: the scan gives up after 15 rows, then column
    // inference treats row 1 as the header and harvests what it can. The
    // result is noisy rather than empty — which is the right trade (a sheet
    // that imports nothing is the failure this parser exists to prevent), and
    // the per-sheet report is what lets the user notice the noise.
    const rows: unknown[][] = Array.from({ length: 20 }, () => ["preamble"]);
    rows.push(["Product Name", "MRP"], ["Late Product", "100"]);
    const { products, sheetStats } = parseProductCatalogWorkbook(wbOf({ Deep: rows }));
    expect(products.some((p) => p.name === "Late Product")).toBe(true);
    // The import preview shows this count, so an operator can see it is wrong.
    expect(sheetStats[0]?.count).toBe(21);
    expect(sheetStats[0]?.inferred).not.toBeNull();
  });
});

describe("column inference when nothing matches", () => {
  it("infers the name and price columns from the data", () => {
    const wb = wbOf({
      Weird: [
        ["Artikel", "Menge", "Steuer", "Preis"],
        ["Dell Latitude 5450", "5", "18", "68000"],
        ["HP ProBook 450", "3", "18", "54000"],
      ],
    });
    const { products, sheetStats } = parseProductCatalogWorkbook(wb);
    expect(products.map((p) => p.name)).toEqual(["Dell Latitude 5450", "HP ProBook 450"]);
    // Price, not quantity and not the tax rate.
    expect(products.map((p) => p.sellPrice)).toEqual([68000, 54000]);
    expect(sheetStats[0]?.inferred).toEqual({ nameKey: "Artikel", priceKey: "Preis" });
  });

  it("picks the largest-average numeric column as the price", () => {
    const wb = wbOf({
      S: [["Thing", "LineNo", "Qty", "TaxPct", "UnitCost"], ["Cisco Switch", "1", "2", "18", "125000"]],
    });
    const { products } = parseProductCatalogWorkbook(wb);
    expect(products[0]?.sellPrice).toBe(125000);
  });

  it("strips currency marks and thousands separators", () => {
    const wb = wbOf({ S: [["Particulars", "Price"], ["VMware vSphere", "₹1,25,000"]] });
    const { products } = parseProductCatalogWorkbook(wb);
    expect(products[0]?.sellPrice).toBe(125000);
  });

  it("still imports a sheet with no usable price column", () => {
    const wb = wbOf({ S: [["Artikel", "Bemerkung"], ["Support Retainer", "price on request"]] });
    const { products } = parseProductCatalogWorkbook(wb);
    expect(products).toHaveLength(1);
    expect(products[0]?.sellPrice).toBe(0);
  });
});

describe("no silent data loss", () => {
  it("keeps products that have no price ACTIVE", () => {
    // Marking them inactive hid them from the quote picker entirely.
    const wb = wbOf({ S: [["Product Name", "MRP"], ["Consulting — price on request", ""]] });
    const { products } = parseProductCatalogWorkbook(wb);
    expect(products[0]?.active).toBe(true);
    expect(products[0]?.sellPrice).toBe(0);
  });

  it("reports every sheet, including the ones contributing nothing", () => {
    const wb = wbOf({
      Good: [["Product Name", "MRP"], ["Windows Server 2025", "95000"]],
      Empty: [],
      Unusable: [["", ""], ["", ""]],
    });
    const { products, sheetStats } = parseProductCatalogWorkbook(wb);
    expect(products).toHaveLength(1);
    expect(sheetStats.map((s) => s.name)).toEqual(["Good", "Empty", "Unusable"]);
    expect(sheetStats.find((s) => s.name === "Empty")?.count).toBe(0);
  });

  it("names the columns it saw on a sheet that yielded nothing", () => {
    const wb = wbOf({ Mystery: [["Col A", "Col B"], ["", ""]] });
    const { sheetStats } = parseProductCatalogWorkbook(wb);
    const stat = sheetStats[0];
    expect(stat?.count).toBe(0);
    expect(stat?.columns).toContain("Col A");
  });

  it("imports every sheet of a multi-sheet workbook", () => {
    const wb = wbOf({
      NCE: [["SkuTitle", "ERP Price"], ["M365 E3", "27000"]],
      Perpetual: [["Product Name", "MRP"], ["Office LTSC 2024", "48000"]],
      Hardware: [["Particulars", "Rate"], ["Dell OptiPlex", "52000"]],
    });
    const { products, sheetStats } = parseProductCatalogWorkbook(wb);
    expect(products).toHaveLength(3);
    expect(sheetStats.every((s) => s.count === 1)).toBe(true);
    // licenseType carries the sheet name, as v1 did.
    expect(products.map((p) => p.licenseType)).toEqual(["NCE", "Perpetual", "Hardware"]);
  });

  it("skips blank rows without counting them as products", () => {
    const wb = wbOf({ S: [["Product Name", "MRP"], ["Real Product", "100"], ["", ""], ["  ", "200"]] });
    const { products } = parseProductCatalogWorkbook(wb);
    expect(products).toHaveLength(1);
  });
});

describe("vendor tagging", () => {
  it("lets an explicit vendor override the Publisher column", () => {
    const wb = wbOf({ S: [["SkuTitle", "Publisher", "ERP Price"], ["Photoshop", "Microsoft", "2400"]] });
    const { products } = parseProductCatalogWorkbook(wb, "Adobe");
    expect(products[0]?.publisher).toBe("Adobe");
  });

  it("defaults an untagged sheet with no Publisher column to Microsoft, as v1 did", () => {
    const wb = wbOf({ S: [["SkuTitle", "ERP Price"], ["Some SKU", "100"]] });
    const { products } = parseProductCatalogWorkbook(wb);
    expect(products[0]?.publisher).toBe("Microsoft");
  });
});

describe("merge vs replace", () => {
  const existing: CatalogProduct[] = [
    { publisher: "Microsoft", name: "M365 E3" },
    { publisher: "Adobe", name: "Acrobat" },
    { publisher: "Kaspersky", name: "Endpoint" },
  ].map((p, i) => ({ ...p, id: String(i) }) as CatalogProduct);

  it("merge replaces only the imported vendor and keeps every other list", () => {
    const imported = [{ id: "n1", publisher: "Adobe", name: "Creative Cloud" } as CatalogProduct];
    const out = mergeCatalog(existing, imported, "merge", "Adobe");
    expect(out.map((p) => p.name).sort()).toEqual(["Creative Cloud", "Endpoint", "M365 E3"]);
  });

  it("merge is case- and whitespace-insensitive on the vendor name", () => {
    const imported = [{ id: "n1", publisher: " adobe ", name: "Creative Cloud" } as CatalogProduct];
    const out = mergeCatalog(existing, imported, "merge", " ADOBE ");
    expect(out.filter((p) => p.publisher.trim().toLowerCase() === "adobe")).toHaveLength(1);
    expect(out).toHaveLength(3);
  });

  it("replace wipes the catalog — so it must stay an explicit choice", () => {
    const imported = [{ id: "n1", publisher: "Adobe", name: "Creative Cloud" } as CatalogProduct];
    expect(mergeCatalog(existing, imported, "replace", "Adobe")).toEqual(imported);
  });
});
