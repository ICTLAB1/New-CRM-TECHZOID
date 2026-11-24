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
  { key: "productId", label: "Product ID", required: false },
  { key: "productName", label: "Product Name", required: true },
  { key: "category", label: "Category", required: false },
  { key: "licenceType", label: "Licence Type / Term", required: false },
  { key: "billingPlan", label: "Billing Plan", required: false },
  { key: "unit", label: "Unit", required: false },
  { key: "resellerPrice", label: "Reseller Price", required: true },
  { key: "dtp", label: "DTP / what we buy at", required: false },
  { key: "currency", label: "Currency", required: false },
];

/**
 * The columns that together identify one price line, in the order they are
 * joined when the SKU column alone does not tell two rows apart.
 *
 * THE SKU COLUMN IS OFTEN NOT A KEY. Microsoft's NCE list is the case that
 * forced this: its SkuId is 1, 4, 5, 000B — unique only WITHIN a ProductId,
 * and repeated again for every term and billing plan the product is sold
 * on. Microsoft's own name for a catalog item is ProductId:SkuId, and the
 * price genuinely differs per term and per billing plan, so a row is
 * "CFQ7TTC0HL8Z:1, one year, billed monthly" and the three-year one is a
 * different line at a different price.
 *
 * Keyed on the SkuId alone, a 3,833-row list imported as 211 rows and threw
 * the other 3,622 away as duplicates — including every monthly and every
 * three-year price in the file.
 *
 * THE ORDER IS THE ORDER THEY ARE ADDED IN, narrowest first, and only as
 * far as it takes to tell the rows apart — so the NCE sheet keys on
 * ProductId:SkuId:Term:BillingPlan and stops, while the PERPETUAL sheet in
 * the same workbook needs Segment as well, because there the one SkuId
 * covers Commercial, Education and Charity at three different prices.
 */
export const IDENTITY_FIELDS = ["productId", "sku", "licenceType", "billingPlan", "category"];

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
  /* Only reached when a more specific SKU column was claimed first — the
     sku hints above already take "product id" when there is nothing
     better, so a sheet whose only identifier is a product code is
     unaffected by this field existing. */
  productId: [
    "product id", "productid", "product code", "productcode", "material code",
    "offer id", "offerid", "parent sku", "base sku",
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
  billingPlan: ["billing plan", "billing cycle", "billing frequency", "billing", "payment plan"],
  unit: ["unit", "uom", "unit of measure", "units", "per", "pack size"],
  resellerPrice: [
    "reseller price", "resellerprice", "reseller", "partner price", "partner",
    "distributor price", "dealer price", "net price", "erp price", "erp",
    "list price", "unit price", "unit rate", "rate", "price",
  ],
  /* THE DISTRIBUTOR TRANSFER PRICE: what we buy at, which the file states
     and the CRM used to reconstruct from a typed percentage. Claimed
     AFTER resellerPrice, so on a Microsoft sheet "ERP Price" goes to the
     price a quotation is floored against and "Unit SELL Price" comes here.

     None of these names appears in the resellerPrice list, deliberately:
     a column called "cost" must never be read as the price a salesperson
     is held to. */
  dtp: [
    "dtp", "d.t.p", "distributor transfer price", "transfer price",
    "unit sell price", "unit selling price", "sell price", "sell to partner",
    "buy price", "buying price", "purchase price", "cost price", "cost",
    "landed cost", "our price",
  ],
  currency: ["currency", "ccy", "curr", "cur"],
};

/** Trim, lowercase, and squeeze runs of space so " ERP  Price " matches "erp price". */
const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The same name with camelCase split apart and punctuation turned into
 * spaces, so "TermDuration" matches the hint "term duration".
 *
 * WHY THIS EXISTS. Microsoft's NCE price list spells every heading in
 * camelCase — Publisher, ProductId, SkuId, SkuTitle, TermDuration,
 * BillingPlan — and the hint lists below are written as words. Two of those
 * matched anyway because somebody had added the squashed spelling to the
 * list by hand ("skuid", "skutitle", "productid"); "TermDuration" and
 * "BillingPlan" had not been, so the Term column came through EMPTY on
 * every Microsoft list ever uploaded, and nobody could see which term a
 * floor price belonged to.
 *
 * Adding two more squashed spellings would have fixed those two headings
 * and left the next one to be found the same way. This fixes the class.
 */
const normWords = (v) =>
  norm(
    String(v ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")      // skuTitle  -> sku Title
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")   // ERPPrice  -> ERP Price
      .replace(/[_\-./]+/g, " "),                  // unit_sell -> unit sell
  );

/** Whether a heading matches a hint, under either spelling. */
const headerIs = (header, hint) => norm(header) === hint || normWords(header) === hint;

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
    const cells = (grid[i] ?? []).filter((c) => norm(c));
    if (cells.length < 2) continue;
    const named = (field) => cells.some((c) => HEADER_HINTS[field].some((h) => headerIs(c, h)));
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
  const headers = headerCells ?? [];
  const mapping = {};
  const taken = new Set();

  for (const { key } of FIELDS) {
    for (const hint of HEADER_HINTS[key]) {
      const at = headers.findIndex((h, i) => headerIs(h, hint) && !taken.has(i));
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
 *   — BUT THE SKU COLUMN IS WIDENED FIRST. Rows that repeat a SKU are very
 *   often not duplicates at all: they are the same product on a different
 *   term or billing plan, at a different price, and throwing them away
 *   leaves a salesperson quoting a monthly licence with no floor under it.
 *   So before any row is called a duplicate, the SKU is rebuilt from every
 *   identity column the mapping has — see IDENTITY_FIELDS — and that is
 *   only done if it actually tells the rows apart. Whatever the rows are
 *   keyed on, the result says so in `skuFrom`, and the Admin sees it before
 *   anything is loaded.
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

  /* Which columns the SKU is built from. "sku" alone unless that repeats
     and the wider key does not — see the note above. The decision is made
     once, from the whole sheet, so every row in one list is keyed the same
     way; deciding per row would produce a list where some SKUs carry the
     term and others do not. */
  const skuFields = chooseSkuFields(body, mapping, at);
  const skuOf = (row) =>
    skuFields.map((f) => cellText(at(row, f))).filter(Boolean).join(":");

  body.forEach((raw, i) => {
    const row = raw ?? [];
    /* 1-based, and counted in the sheet's own numbering so that a person
       can open the file and go to the row the message names. */
    const sheetRow = headerAt + 1 + i + 1;

    const used = Object.values(mapping ?? {}).filter(Number.isInteger);
    const anything = used.some((col) => cellText(row[col]) !== "");
    if (!anything) return;

    const sku = skuOf(row);
    const productName = cellText(at(row, "productName"));
    const rawPrice = at(row, "resellerPrice");

    const problems = [];
    if (!sku) problems.push("no SKU / part number");
    if (!productName) problems.push("no product name");

    /* Read, but never a reason to refuse a row: a line whose DTP is
       missing or unreadable still has a floor, and refusing it would take
       a sellable product out of the book over a column the salesperson
       cannot see. */
    const dtpRaw = stripMoney(at(row, "dtp"));
    const dtpNum = Number(dtpRaw);
    const dtpValue = dtpRaw !== "" && Number.isFinite(dtpNum) && dtpNum >= 0
      ? Math.round(dtpNum * 100) / 100
      : null;

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
      /* KEPT AS A FIELD, not only as part of the SKU. It went into the SKU
         and nowhere else, which meant "annual or monthly billing" could
         not be asked as a question of the price book — and with a row per
         variant, that question is the only way to find the one line a
         salesperson is actually quoting. */
      billingPlan: cellText(at(row, "billingPlan")) || null,
      unit: cellText(at(row, "unit")) || null,
      resellerPrice: Math.round(price * 100) / 100,
      /* NULL WHEN THE FILE DID NOT SAY, which is not the same as zero: the
         typed distributor discount answers for those lines instead, and a
         zero would claim the line is free. A DTP that will not parse is
         treated the same way — a guess is better than a wrong number. */
      dtp: dtpValue,
      currency,
      row: sheetRow,
    });
  });

  const truncated = grid.length - (headerAt + 1) > MAX_ROWS;
  return { headerRow: headerAt, items, errors, truncated, skuFrom: skuFields };
}

/**
 * Which columns to build the SKU from.
 *
 * The SKU column on its own whenever that is a key, which it is on most
 * distributors' lists and which keeps their SKUs spelled exactly as the
 * file spells them. Only when it repeats is the wider key considered, and
 * only if the wider key is genuinely better: a list that repeats a part
 * number because the same part really is in it twice gains nothing from a
 * longer SKU, and those rows should still be reported as the duplicates
 * they are.
 *
 * ALL OR NOTHING ACROSS THE SHEET. Qualifying only the rows that clash
 * would give one list two kinds of SKU, and a salesperson searching for
 * the part number they can see in the file would find some of them.
 */
export function chooseSkuFields(body, mapping, at) {
  if (!Number.isInteger(mapping?.sku)) return ["sku"];

  const dupes = (fields) => {
    const seen = new Set();
    let n = 0;
    for (const raw of body) {
      const key = norm(fields.map((f) => cellText(at(raw ?? [], f))).filter(Boolean).join(":"));
      if (!key) continue;
      if (seen.has(key)) n++;
      else seen.add(key);
    }
    return n;
  };

  let best = ["sku"];
  let bestDupes = dupes(best);

  /* ONE COLUMN AT A TIME, and only one that earns its place. A column that
     does not reduce the clashes is not added, so a list whose Category says
     "Software" on every row does not get "Software" in all of its SKUs. */
  for (const field of IDENTITY_FIELDS) {
    if (!bestDupes) break;
    if (field === "sku" || !Number.isInteger(mapping[field])) continue;
    const next = IDENTITY_FIELDS.filter((f) => f === field || best.includes(f));
    const n = dupes(next);
    if (n < bestDupes) {
      best = next;
      bestDupes = n;
    }
  }
  return best;
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
