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

  const sheet = chooseSheet(sheets, body.sheet);
  if (!sheet) return fail(event, 400, "That workbook has no sheets in it.");

  const headerRow = Number.isInteger(body.headerRow) ? body.headerRow : headerRowIndex(sheet.rows);
  if (headerRow < 0) {
    return fail(event, 400, `No column headings were found on "${sheet.name}". Pick the sheet and the heading row, or check the file has a row naming the SKU and the price.`);
  }
  const headers = headerNames(sheet.rows, headerRow);

  /* The mapping, in order of how much it is worth trusting: what the Admin
     set on this upload, then what was used for this OEM last month — which
     is what makes next month one click — then a guess from the headings. */
  let mapping = isMapping(body.mapping) ? body.mapping : null;
  let mappingFrom = mapping ? "you" : null;

  if (!mapping) {
    const { data: last } = await db.rpc("price_list_last_mapping", { p_company: company, p_oem: oem });
    const remembered = Array.isArray(last) ? last[0] : null;
    if (remembered && isMapping(remembered.column_map) && Object.keys(remembered.column_map).length) {
      /* Only if it still fits this file: a distributor who reorders their
         columns would otherwise have every price read out of the wrong one. */
      const fits = headersFit(remembered.column_map, headers);
      if (fits) {
        mapping = remembered.column_map;
        mappingFrom = `the ${remembered.period} upload`;
      }
    }
  }
  if (!mapping) {
    mapping = suggestMapping(headers);
    mappingFrom = "the column headings";
  }

  const short = missingFields(mapping);
  if (short.length) {
    return json(event, 200, {
      stage: "mapping",
      sheets: sheets.map((s) => s.name),
      sheet: sheet.name,
      headerRow,
      headers,
      mapping,
      mappingFrom,
      missing: short,
      message: `Say which column holds ${short.join(" and ")}.`,
    });
  }

  const { items, errors, truncated } = readGrid(sheet.rows, mapping, { headerRow });

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
      sheet: sheet.name,
      headerRow,
      headers,
      mapping,
      mappingFrom,
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
    p_sheet: sheet.name,
    p_header_row: headerRow,
    p_map: JSON.stringify(mapping),
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
export function isMapping(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v).every((n) => Number.isInteger(n) && n >= 0 && n < 16384);
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
  unit: i.unit,
  resellerPrice: i.resellerPrice,
  currency: i.currency,
});

const forComparison = (i) => ({ sku: i.sku, productName: i.productName, resellerPrice: i.resellerPrice });

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
