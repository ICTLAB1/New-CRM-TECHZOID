import { createHash } from "node:crypto";
import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { forUser } from "../../api/lib/serviceClient.mjs";
import { MAX_FILE_BYTES, readWorkbook } from "../../api/lib/priceListWorkbook.mjs";
import {
  headerNames,
  headerRowIndex,
  missingFields,
  readGrid,
  suggestMapping,
} from "../../api/lib/priceListSheet.mjs";

/**
 * A month's OEM price list, from the .xlsx to the price book.
 *
 * TWO MODES, ONE ENDPOINT. Without `commit` it reads the workbook and
 * answers with what it found — the sheets, the header row, the column
 * mapping it guessed or remembered, a preview, every row it could not use,
 * and what the new prices do to the active list. With `commit` it loads
 * them. The parse is identical either way, which is the point: the preview
 * is not a different code path that might read the file differently from
 * the load.
 *
 * THE PARSE HAPPENS HERE AND NOWHERE ELSE. The browser sends the file and
 * renders the answer; it has no copy of these rules. One set of rules
 * decides what a price list row is, and it is the set the rows are written
 * from.
 *
 * WHO MAY: Admin, in the company named. Checked twice on purpose — here, so
 * that a BDE who reaches this endpoint is told plainly rather than shown an
 * exception, and again inside `price_list_commit`, which is the check that
 * actually decides. Everything this handler writes goes through
 * `forUser(user.id)`, so the policies are in force even if this file is
 * wrong.
 *
 * NOT `xlsx@0.18.5` — see api/lib/priceListWorkbook.mjs.
 */

/**
 * "Every sheet in the workbook", as the browser asks for it.
 *
 * A sheet can be called anything, so the value that means "all of them"
 * has to be one a sheet cannot be called. Excel forbids these characters
 * in a sheet name: : \ / ? * [ ]
 */
export const ALL_SHEETS = "*";

/** Preview sizes. Enough to see the shape; not enough to be a download. */
const PREVIEW_ROWS = 25;
const PREVIEW_ERRORS = 200;
const PREVIEW_CHANGES = 400;

const isUuid = (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ""));

/** Strip a data: prefix, then decode. Browsers send either. */
export function decodeUpload(base64) {
  const text = String(base64 ?? "").replace(/^data:[^,]*,/, "").trim();
  if (!text) return null;
  const buf = Buffer.from(text, "base64");
  return buf.length ? buf : null;
}

/** Which sheet to read: the one asked for, else the first that looks like a
 *  price list, else the first. A workbook whose first tab is "Read me" is
 *  the normal case, not the exception. */
export function chooseSheet(sheets, wanted) {
  if (wanted) {
    const named = sheets.find((s) => s.name === wanted)
      || sheets.find((s) => s.name.trim().toLowerCase() === String(wanted).trim().toLowerCase());
    if (named) return named;
  }
  return sheets.find((s) => headerRowIndex(s.rows) >= 0) ?? sheets[0];
}

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid.");

  const company = String(body.company ?? "").trim();
  if (!isUuid(company)) return fail(event, 400, "Which workspace is this price list for?");

  const oem = String(body.oem ?? "").trim().slice(0, 60);
  if (!oem) return fail(event, 400, "Which OEM is this price list for? (Microsoft, Adobe, Autodesk, Kaspersky, or another.)");

  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail(event, 400, "Pick the year this list is for.");
  if (!Number.isInteger(month) || month < 1 || month > 12) return fail(event, 400, "Pick the month this list is for.");

  const db = forUser(user.id);

  /* The role, by name, so the refusal is a sentence. The real check is in
     the database and runs again below. */
  const { data: roleRows, error: roleError } = await db.rpc("role_in", { p_company: company });
  if (roleError) return fail(event, 400, "That workspace could not be read.", roleError.message);
  const role = Array.isArray(roleRows) ? roleRows[0]?.role_in ?? roleRows[0] : roleRows;
  if (role !== "Admin") {
    return fail(event, 403, "Only an Admin can load price lists. Ask an Admin to upload this month's file.");
  }

  /* Parsing a workbook costs real memory and CPU, and this endpoint takes a
     file. Limited per Admin. */
  try {
    const rl = await consume(adminClient(), "price-list-upload", user.id);
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));
  } catch (err) {
    console.error("rate limit unavailable:", err?.message ?? err);
  }

  const buffer = decodeUpload(body.fileBase64);
  if (!buffer) return fail(event, 400, "No file came through. Choose the .xlsx file and try again.");
  if (buffer.length > MAX_FILE_BYTES) {
    return fail(event, 413, `That file is ${Math.round(buffer.length / 1024 / 1024)} MB, which is larger than a price list should be.`);
  }

  let sheets;
  try {
    sheets = await readWorkbook(buffer);
  } catch (err) {
    /* The message from readWorkbook is written for the person who uploaded
       the file, so it is passed straight through. */
    return fail(event, 400, err?.message ?? "That file could not be read.");
  }

  /* WHICH SHEETS. A price list workbook is usually several sheets of price
     list — Microsoft's is four, one per licensing programme — and reading
     one of them silently leaves the rest of the month's prices out of the
     book. So the default is all of them, and the picker narrows to one.

     A sheet is only in if its required columns can be found. That is what
     keeps a "Read me" or a "Change log" tab out without anybody having to
     name it, and it means an unreadable sheet is reported as skipped
     rather than failing the upload. */
  const wantOne = wantsOneSheet(body.sheet);
  const chosen = wantOne ? [chooseSheet(sheets, body.sheet)].filter(Boolean) : sheets;
  if (!chosen.length) return fail(event, 400, "That workbook has no sheets in it.");

  const { data: last } = await db.rpc("price_list_last_mapping", { p_company: company, p_oem: oem });
  const remembered = Array.isArray(last) ? last[0] : null;

  const { plans, skipped, short } = planSheets(chosen, {
    wantOne,
    headerRow: body.headerRow,
    mapping: body.mapping,
    remembered,
  });

  /* NOTHING MAPPED. If a sheet at least has headings, this is a question —
     "which column holds the price?" — and not a refusal. */
  if (!plans.length) {
    if (short.length) {
      const ask = short[0];
      return json(event, 200, {
        stage: "mapping",
        sheets: sheets.map((s) => s.name),
        sheet: ask.sheet.name,
        headerRow: ask.headerRow,
        headers: ask.headers,
        mapping: ask.mapping,
        mappingFrom: ask.mappingFrom,
        missing: ask.missing,
        message: `Say which column holds ${ask.missing.join(" and ")}.`,
      });
    }
    return fail(event, 400, skipped.length
      ? `No sheet in that workbook could be read as a price list. ${skipped.map((s) => `"${s.name}" — ${s.why}`).join("; ")}.`
      : "No sheet in that workbook could be read as a price list.");
  }

  const first = plans[0];
  const sheet = first.sheet;
  const headerRow = first.headerRow;
  const headers = first.headers;
  const mapping = first.mapping;
  const mappingFrom = first.mappingFrom;

  const read = plans.map((p) => ({
    name: p.sheet.name,
    mapping: p.mapping,
    mappingFrom: p.mappingFrom,
    headerRow: p.headerRow,
    headers: p.headers,
    ...readGrid(p.sheet.rows, p.mapping, { headerRow: p.headerRow }),
  }));
  const { items, errors, qualifiedBySheet } = mergeSheets(read);
  const truncated = read.some((r) => r.truncated);
  const skuFrom = read[0].skuFrom;
  const perSheet = read.map((r) => ({
    name: r.name,
    itemCount: r.items.length,
    errorCount: r.errors.length,
    mappingFrom: r.mappingFrom,
    skuFromLabels: r.skuFrom.map((f) => r.headers[r.mapping[f]]).filter(Boolean),
  }));

  if (!body.commit) {
    /* What the new prices do to the list in force. Asked BEFORE loading,
       because a list where every price has jumped is a list with the wrong
       column mapped — and finding that out afterwards means every
       quotation raised in between was priced off nonsense. */
    const { data: changeRows, error: changeError } = await db.rpc("price_list_changes", {
      p_company: company,
      p_oem: oem,
      p_items: JSON.stringify(items.map(forComparison)),
    });

    return json(event, 200, {
      stage: "preview",
      sheets: sheets.map((s) => s.name),
      /* ECHOED BACK AS THE BROWSER MUST SEND IT NEXT TIME. Returning the
         first sheet's name here would put the picker on "NCE", and the
         next request — changing the header row, say — would quietly read
         that one sheet instead of all four. */
      sheet: read.length === 1 ? read[0].name : ALL_SHEETS,
      headerRow,
      headers,
      mapping,
      mappingFrom,
      /* Which columns the SKU was built from, so an Admin looking at
         "CFQ7TTC0HL8Z:1:P1Y:Monthly" can see where it came from before
         anything is loaded, rather than wondering why it is not the part
         number in the file. */
      skuFrom,
      skuFromLabels: skuFrom.map((f) => headers[mapping[f]]).filter(Boolean),
      /* What each sheet contributed, and what was left out and why. A
         merged load that quietly dropped a sheet would be the fault this
         whole change exists to fix, wearing a different hat. */
      perSheet,
      skipped,
      qualifiedBySheet,
      allSheets: !wantOne,
      itemCount: items.length,
      errorCount: errors.length,
      truncated,
      items: items.slice(0, PREVIEW_ROWS),
      errors: errors.slice(0, PREVIEW_ERRORS),
      changes: Array.isArray(changeRows) ? changeRows.slice(0, PREVIEW_CHANGES) : [],
      changeCount: Array.isArray(changeRows) ? changeRows.length : 0,
      changesUnavailable: changeError ? changeError.message : null,
    });
  }

  if (!items.length) {
    return fail(event, 400, errors.length
      ? `None of the ${errors.length} rows in that sheet could be read. Check the column mapping.`
      : "That sheet has no rows in it.");
  }

  /* ERRORS HAVE TO BE ACKNOWLEDGED, not waved through. Loading 3,000 of
     3,500 rows is a legitimate thing to do — the other 500 are "price on
     request" lines the distributor never costed — but it has to be a
     decision somebody made, because those SKUs will simply not be in the
     price book and a BDE will not find them. */
  if (errors.length && !body.acceptErrors) {
    return json(event, 409, {
      stage: "confirm",
      itemCount: items.length,
      errorCount: errors.length,
      errors: errors.slice(0, PREVIEW_ERRORS),
      message: `${items.length} rows are ready and ${errors.length} cannot be read. Load the ${items.length}, or fix the file and upload it again.`,
    });
  }

  const { data, error } = await db.rpc("price_list_commit", {
    p_company: company,
    p_oem: oem,
    p_year: year,
    p_month: month,
    p_items: JSON.stringify(items.map(forStorage)),
    /* What was read, so a disputed price can be traced to the sheet and
       the columns it came out of — and so next month's upload offers the
       same mapping back, per sheet. */
    p_sheet: wantOne ? sheet.name : read.map((r) => r.name).join(", "),
    p_header_row: headerRow,
    p_map: JSON.stringify(
      wantOne ? mapping : Object.fromEntries(read.map((r) => [r.name, r.mapping])),
    ),
    p_source_name: String(body.fileName ?? "").slice(0, 200) || null,
    p_sha: sha256(buffer),
    p_activate: body.activate !== false,
  });

  if (error) return fail(event, 400, error.message ?? "That list could not be loaded.", error.message);

  const result = Array.isArray(data) ? data[0] ?? {} : data ?? {};
  return json(event, 200, {
    stage: "loaded",
    listId: result.list_id ?? null,
    itemsLoaded: Number(result.items_loaded ?? items.length),
    replaced: !!result.replaced,
    activated: !!result.activated,
    errorCount: errors.length,
    errors: errors.slice(0, PREVIEW_ERRORS),
  });
}

/** A field -> column-index object, and nothing else. */
/**
 * Fill in fields a mapping says nothing about, from the headings.
 *
 * A MAPPING SAVED BEFORE A FIELD EXISTED HAS NOTHING FOR IT, and would go
 * on reading the file the old way for ever. Product ID and Billing Plan
 * were added after the first Microsoft lists had been loaded, and without
 * them the SKU cannot be made unique — the November 2026 channel list
 * imported 211 of its 3,833 rows for exactly that reason, and remembering
 * last month's mapping would have reproduced it every month after.
 *
 * ONLY KEYS THAT ARE ABSENT. A field the Admin deliberately set is left
 * alone, and so is one they deliberately set to nothing: `{ unit: null }`
 * means "this file has no unit column", which is an answer, not a gap.
 */
export function withGuessedGaps(mapping, headers) {
  const guessed = suggestMapping(headers);
  const out = { ...mapping };
  for (const [field, col] of Object.entries(guessed)) {
    if (!(field in out) && Number.isInteger(col)) out[field] = col;
  }
  return out;
}

/**
 * What to read from each sheet: where its headings are, and which column
 * is which.
 *
 * ONE MAPPING PER SHEET, because the sheets of one workbook do not share
 * a layout. Microsoft's November 2026 list puts the price in column 14 on
 * NCE, column 15 on PERPETUAL and column 12 on EST, and NCE has no
 * ProductTitle column at all. A single mapping across them reads a price
 * out of "Discount %".
 *
 * A SHEET THAT CANNOT BE READ IS SKIPPED, NOT FATAL — unless the Admin
 * named that sheet themselves, in which case it is a question and comes
 * back as the mapping screen. That is what keeps a "Read me" tab out of a
 * merged load without anybody having to say so, and it is why the result
 * carries `skipped` with a reason for each: a merged load that quietly
 * dropped a sheet would be the same fault as reading only one of them.
 */
export function planSheets(chosen, { wantOne = false, headerRow, mapping: asked, remembered } = {}) {
  const plans = [];
  const skipped = [];
  const short = [];
  for (const s of chosen) {
    /* A header row given by hand belongs to the sheet it was given for. */
    const headerAt = wantOne && Number.isInteger(headerRow) ? headerRow : headerRowIndex(s.rows);
    if (headerAt < 0) {
      skipped.push({ name: s.name, why: "no column headings were found" });
      continue;
    }
    const sheetHeaders = headerNames(s.rows, headerAt);

    /* The mapping, in order of how much it is worth trusting: what the
       Admin set on this upload, then what was used for this OEM last
       month — which is what makes next month one click — then a guess
       from the headings. Each sheet gets its own: the four sheets of one
       Microsoft workbook have four different column layouts, and one
       mapping across them would read prices out of the wrong column. */
    let mapping = mappingFor(asked, s.name);
    let mappingFrom = mapping ? "you" : null;

    if (!mapping) {
      const saved = mappingFor(remembered?.column_map, s.name);
      /* Only if it still fits this file: a distributor who reorders their
         columns would otherwise have every price read out of the wrong one. */
      if (saved && Object.keys(saved).length && headersFit(saved, sheetHeaders)) {
        mapping = saved;
        mappingFrom = `the ${remembered.period} upload`;
      }
    }
    if (!mapping) {
      mapping = suggestMapping(sheetHeaders);
      mappingFrom = "the column headings";
    }
    mapping = withGuessedGaps(mapping, sheetHeaders);

    const missing = missingFields(mapping);
    if (missing.length) {
      /* NOT A PLAN, BUT NOT NOTHING EITHER. A sheet whose columns cannot
         all be found is left out of a merged load and reported — but it is
         kept here so that a workbook where NOTHING mapped can still ask
         the Admin which column is which, rather than refusing outright.
         A single-sheet workbook with an oddly named price column is
         exactly who the mapping screen is for. */
      skipped.push({ name: s.name, why: `no column holds ${missing.join(" or ")}` });
      short.push({ sheet: s, headerRow: headerAt, headers: sheetHeaders, mapping, mappingFrom, missing });
      continue;
    }
    plans.push({ sheet: s, headerRow: headerAt, headers: sheetHeaders, mapping, mappingFrom, missing: [] });
  }
  return { plans, skipped, short };
}

/**
 * Whether the browser asked for one named sheet.
 *
 * EVERY SHEET IS THE DEFAULT, and this is where that is decided. Asking
 * for nothing means all of them: a price list workbook is usually several
 * sheets of price list, and reading one leaves the rest of the month's
 * prices out of the book — 1,340 rows of 4,887, on the November 2026
 * Microsoft list.
 */
export const wantsOneSheet = (asked) => Boolean(asked && asked !== ALL_SHEETS);

export function isMapping(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v).every((n) => Number.isInteger(n) && n >= 0 && n < 16384);
}

/**
 * The mapping for one sheet, out of either shape.
 *
 * TWO SHAPES, BECAUSE THERE ARE TWO KINDS OF UPLOAD. A single-sheet load
 * carries one field -> column object, which is what every list loaded
 * before this existed was stored as. A merged load carries one of those
 * PER SHEET, keyed by sheet name, because the four sheets of a Microsoft
 * workbook have four different column layouts — NCE puts the price in
 * column 14 and PERPETUAL in column 15, and one mapping across both would
 * read a price out of "Discount %".
 *
 * A flat mapping is returned for any sheet asked for, so last month's
 * single-sheet mapping still fits this month's single-sheet load.
 */
export function mappingFor(stored, sheetName) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  if (isMapping(stored) && Object.keys(stored).length) return stored;
  const own = stored[sheetName];
  return isMapping(own) && Object.keys(own).length ? own : null;
}

/**
 * Put the sheets' rows together into one list.
 *
 * SKUs ARE UNIQUE WITHIN A SHEET ALREADY — readGrid sees to that — so the
 * only thing left to settle is a clash BETWEEN sheets, where two licensing
 * programmes happen to name an item the same way. The sheet name goes in
 * front of every SKU when that happens, and in front of none when it does
 * not: the November 2026 Microsoft workbook merges 4,887 rows across four
 * sheets with no clash at all, and prefixing those would have changed
 * every SKU in the book for nothing.
 *
 * ALL OR NOTHING, for the reason the SKU widening is: a list where some
 * SKUs carry a sheet name and others do not is a list nobody can search.
 */
export function mergeSheets(read) {
  const tag = (r) => r.items.map((it) => ({ ...it, sheet: r.name }));
  const items = read.flatMap(tag);
  const errors = read.flatMap((r) => r.errors.map((e) => ({ ...e, sheet: r.name })));

  const keys = items.map((it) => String(it.sku).toLowerCase());
  const clashes = keys.length - new Set(keys).size;
  if (!clashes || read.length < 2) return { items, errors, qualifiedBySheet: false };

  return {
    items: items.map((it) => ({ ...it, sku: `${it.sheet}/${it.sku}` })),
    errors,
    qualifiedBySheet: true,
  };
}

/**
 * Whether a remembered mapping still points at columns this file has.
 *
 * Not a guarantee that it points at the RIGHT ones — a distributor who
 * swaps two columns of the same width would defeat this — which is why the
 * preview shows the mapping it used and where it came from, and why the
 * changes report is in front of the Admin before anything is loaded.
 */
export function headersFit(mapping, headers) {
  const indexes = Object.values(mapping).filter(Number.isInteger);
  if (!indexes.length) return false;
  return indexes.every((i) => i < headers.length) && headers.some((h) => String(h ?? "").trim() !== "");
}

const forStorage = (i) => ({
  sku: i.sku,
  productName: i.productName,
  category: i.category,
  licenceType: i.licenceType,
  billingPlan: i.billingPlan,
  unit: i.unit,
  resellerPrice: i.resellerPrice,
  dtp: i.dtp,
  currency: i.currency,
});

const forComparison = (i) => ({ sku: i.sku, productName: i.productName, resellerPrice: i.resellerPrice });

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
