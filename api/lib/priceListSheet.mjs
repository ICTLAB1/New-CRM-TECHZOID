/**
 * Turning a distributor's spreadsheet into price book rows.
 *
 * PURE, AND DELIBERATELY SO. Nothing here opens a file, reads a database or
 * knows what Azure is: it takes a grid of cell values — whatever came out of
 * the workbook — and returns rows and complaints. `priceListWorkbook.mjs` is
 * the part that cannot be tested without a real .xlsx, and it is kept as
 * small as it can be and given no decisions to make. The same split as
 * blob.mjs and azureBlob.mjs, for the same reason.
 *
 * ONLY ON THE SERVER. The browser gets the header names, the suggested
 * mapping, the preview and the errors as JSON, and does no parsing of its
 * own — there is one copy of these rules and it is the one the rows are
 * actually written from.
 *
 * THE HINT LISTS COME FROM src/domain/catalog/columns.ts, which learned them
 * the hard way against real lists — including TechZoid's own Microsoft CSP
 * export, whose price column is named " ERP Price " with a space on each
 * side. Every lookup here trims and lowercases both sides for that reason.
 */

/** The fields a price book row is made of, in the order the mapping screen shows them. */
export const FIELDS = [
  { key: "sku", label: "SKU / Part No", required: true },
  { key: "productName", label: "Product Name", required: true },
  { key: "category", label: "Category", required: false },
  { key: "licenceType", label: "Licence Type / Term", required: false },
  { key: "unit", label: "Unit", required: false },
  { key: "resellerPrice", label: "Reseller Price", required: true },
  { key: "currency", label: "Currency", required: false },
];

export const REQUIRED_FIELDS = FIELDS.filter((f) => f.required).map((f) => f.key);

/**
 * Header names recognised per field, most specific first.
 *
 * NOTE WHAT IS NOT IN THE PRICE LIST: "mrp" and "selling price". Those are
 * customer-facing numbers, and taking one for the reseller price would set
 * every floor far too high — the quotations would price themselves out of
 * every deal and nobody would know why. "price" is there as a last resort,
 * after every specific name has missed.
 */
export const HEADER_HINTS = {
  sku: [
    "sku", "sku id", "skuid", "sku code", "part no", "part number", "partno", "part#",
    "item code", "itemcode", "product id", "productid", "product code", "material code",
    "offer id", "offerid", "article code", "code",
  ],
  productName: [
    "product name", "sku title", "skutitle", "product description", "description",
    "item name", "item", "product", "name", "sku description", "particulars", "offer name",
  ],
  category: [
    "category", "product category", "sub category", "subcategory", "product family",
    "family", "segment", "group", "product group", "licence group", "license group",
  ],
  licenceType: [
    "licence type", "license type", "licence term", "license term", "term duration",
    "term", "duration", "billing plan", "billing term", "subscription term",
    "licence", "license", "plan", "validity",
  ],
  unit: ["unit", "uom", "unit of measure", "units", "per", "pack size"],
  resellerPrice: [
    "reseller price", "resellerprice", "reseller", "partner price", "partner",
    "distributor price", "dealer price", "net price", "erp price", "erp",
    "list price", "unit price", "unit rate", "rate", "price",
  ],
  currency: ["currency", "ccy", "curr", "cur"],
};

/** Trim, lowercase, and squeeze runs of space so " ERP  Price " matches "erp price". */
const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Cell text, with Date and boolean rendered rather than stringified oddly. */
function cellText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v).trim();
}

/** Strip currency marks and thousands separators before Number(). */
export function stripMoney(v) {
  if (typeof v === "number") return String(v);
  return String(v ?? "").replace(/[\s,₹$]/g, "").replace(/^(INR|USD|AED|EUR|GBP)/i, "");
}

/**
 * Which row is the header.
 *
 * Price lists routinely carry a title row or two above it — "Microsoft CSP
 * Price List", "Effective 1 November 2026" — and that alone was enough to
 * import whole sheets as nothing. Scans the first 20 rows for one that names
 * both something product-ish and something price-ish, and settles for one
 * naming a SKU or a product alone.
 *
 * Returns the index, or -1 when no row looks like a header at all.
 */
export function headerRowIndex(grid) {
  let fallback = -1;
  const limit = Math.min(grid.length, 20);
  for (let i = 0; i < limit; i++) {
    const cells = (grid[i] ?? []).map(norm).filter(Boolean);
    if (cells.length < 2) continue;
    const named = (field) => cells.some((c) => HEADER_HINTS[field].includes(c));
    const hasThing = named("sku") || named("productName");
    const hasPrice = named("resellerPrice");
    if (hasThing && hasPrice) return i;
    if (fallback === -1 && hasThing) fallback = i;
  }
  return fallback;
}

/**
 * A mapping of field -> column index, guessed from the header names.
 *
 * MOST SPECIFIC HINT WINS, not leftmost column. A sheet with both "Part No"
 * and "Code" should take the first as the SKU; scanning columns left to
 * right would take whichever came first in the sheet. So the hints are
 * walked in order of how specific they are, and the first column matching
 * the current hint is claimed.
 *
 * A column is claimed once. Otherwise a sheet whose only text column is
 * "Description" would become both the SKU and the product name, and every
 * row would import with a part number that is a sentence.
 */
export function suggestMapping(headerCells) {
  const headers = (headerCells ?? []).map(norm);
  const mapping = {};
  const taken = new Set();

  for (const { key } of FIELDS) {
    for (const hint of HEADER_HINTS[key]) {
      const at = headers.findIndex((h, i) => h === hint && !taken.has(i));
      if (at !== -1) {
        mapping[key] = at;
        taken.add(at);
        break;
      }
    }
  }
  return mapping;
}

/** INR unless the sheet says otherwise, and said in three letters. */
const CURRENCY_WORDS = {
  "₹": "INR", rs: "INR", "rs.": "INR", inr: "INR", rupees: "INR", rupee: "INR",
  $: "USD", usd: "USD", "us$": "USD", dollar: "USD", dollars: "USD",
  aed: "AED", dirham: "AED", "€": "EUR", eur: "EUR", "£": "GBP", gbp: "GBP",
};

export function readCurrency(raw, fallback = "INR") {
  const text = cellText(raw);
  if (!text) return { currency: fallback, problem: null };
  const word = CURRENCY_WORDS[norm(text)];
  if (word) return { currency: word, problem: null };
  const letters = text.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(letters)) return { currency: letters, problem: null };
  return { currency: fallback, problem: `currency "${text}" not understood` };
}

/** How much of a sheet will be looked at, so a hostile or broken file cannot
 *  spend the function host's whole memory on one upload. */
export const MAX_ROWS = 50_000;

/**
 * Apply a mapping to the grid and produce rows, plus a complaint for every
 * row that cannot become one.
 *
 * WHAT IS REFUSED, and the first one is a judgement worth stating:
 *
 *   A PRICE OF ZERO, OR NO PRICE AT ALL, IS A ROW ERROR. In the product
 *   catalog a missing price means "price on request" and the product stays
 *   listed, which is right there. Here it would mean a minimum selling price
 *   of zero — a floor of nothing, under which a salesperson may quote
 *   anything at all without anybody's approval. A line nobody has costed
 *   must not become a line nobody has to ask about, so the row is left out
 *   and reported.
 *
 *   A DUPLICATE SKU is reported rather than imported twice. The database has
 *   a unique index on (list, lower(sku)) and would refuse the whole insert,
 *   so a single repeated row would otherwise lose the entire upload with a
 *   message about an index.
 *
 *   A NEGATIVE PRICE, and anything that will not parse as a number.
 *
 * A BLANK ROW IS NOT AN ERROR. Spreadsheets are full of them, and a report
 * listing four hundred blank rows is a report nobody reads.
 */
export function readGrid(grid, mapping, options = {}) {
  const headerAt = Number.isInteger(options.headerRow) ? options.headerRow : headerRowIndex(grid);
  const body = grid.slice(headerAt + 1, headerAt + 1 + MAX_ROWS);
  const defaultCurrency = options.currency || "INR";

  const items = [];
  const errors = [];
  const seen = new Map();

  const at = (row, field) => {
    const col = mapping?.[field];
    return Number.isInteger(col) ? row[col] : undefined;
  };

  body.forEach((raw, i) => {
    const row = raw ?? [];
    /* 1-based, and counted in the sheet's own numbering so that a person
       can open the file and go to the row the message names. */
    const sheetRow = headerAt + 1 + i + 1;

    const used = Object.values(mapping ?? {}).filter(Number.isInteger);
    const anything = used.some((col) => cellText(row[col]) !== "");
    if (!anything) return;

    const sku = cellText(at(row, "sku"));
    const productName = cellText(at(row, "productName"));
    const rawPrice = at(row, "resellerPrice");

    const problems = [];
    if (!sku) problems.push("no SKU / part number");
    if (!productName) problems.push("no product name");

    const priceText = stripMoney(rawPrice);
    const price = Number(priceText);
    if (priceText === "" || !Number.isFinite(price)) {
      problems.push(cellText(rawPrice) ? `price "${cellText(rawPrice)}" is not a number` : "no reseller price");
    } else if (price < 0) {
      problems.push(`price ${price} is negative`);
    } else if (price === 0) {
      problems.push("reseller price is zero, so there would be no minimum selling price");
    }

    const { currency, problem: currencyProblem } = readCurrency(at(row, "currency"), defaultCurrency);
    if (currencyProblem) problems.push(currencyProblem);

    if (sku) {
      const key = norm(sku);
      if (seen.has(key)) problems.push(`SKU repeats row ${seen.get(key)}`);
      else seen.set(key, sheetRow);
    }

    if (problems.length) {
      errors.push({ row: sheetRow, sku, productName, problem: problems.join("; ") });
      return;
    }

    items.push({
      sku,
      productName,
      category: cellText(at(row, "category")) || null,
      licenceType: cellText(at(row, "licenceType")) || null,
      unit: cellText(at(row, "unit")) || null,
      resellerPrice: Math.round(price * 100) / 100,
      currency,
      row: sheetRow,
    });
  });

  const truncated = grid.length - (headerAt + 1) > MAX_ROWS;
  return { headerRow: headerAt, items, errors, truncated };
}

/** The header names as they are spelled in the sheet, for the mapping screen. */
export function headerNames(grid, headerAt) {
  const at = Number.isInteger(headerAt) ? headerAt : headerRowIndex(grid);
  if (at < 0) return [];
  return (grid[at] ?? []).map((c) => cellText(c));
}

/** Which required fields a mapping still has nothing for. */
export function missingFields(mapping) {
  return REQUIRED_FIELDS.filter((key) => !Number.isInteger(mapping?.[key]));
}
