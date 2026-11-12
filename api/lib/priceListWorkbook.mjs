/**
 * Opening the .xlsx, and nothing else.
 *
 * The one part of the price list upload that cannot be tested without a real
 * workbook, so it is kept as small as it can be and given no decisions to
 * make: every rule about what a price list row is lives in
 * priceListSheet.mjs, which is pure. The same split as azureBlob.mjs and
 * blob.mjs.
 *
 * NOT `xlsx@0.18.5`. That is the version npm has been stuck on since
 * SheetJS moved distribution to their own CDN, and it carries published
 * prototype-pollution and denial-of-service advisories. This reads with
 * `read-excel-file`, which is maintained, pulls in seven packages, and has
 * no advisories against it. The frontend still has `xlsx` for the product
 * catalog import and the report exports; nothing here uses it.
 *
 * PINNED EXACTLY, not with a caret. This version returns every sheet as
 * `{ sheet, data }` and ignores the `sheet` option when handed a stream,
 * which is not what its own README describes — so a minor upgrade could
 * quietly change the shape of what comes back. `asSheets` below copes with
 * either shape, and the pin means the upgrade is a decision somebody makes
 * rather than something a deploy does.
 */
import { Readable } from "node:stream";
import readXlsxFile from "read-excel-file/node";

/** Anything bigger than this is not a price list. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * Normalise whatever the library returns into `[{ name, rows }]`.
 *
 * Handles the `{ sheet, data }` shape this version gives, the bare grid its
 * README describes, and a single sheet object, so the module above does not
 * have to care which it got.
 */
export function asSheets(parsed) {
  if (!Array.isArray(parsed)) return [];
  if (!parsed.length) return [];

  /* [{ sheet, data }, ...] */
  if (parsed.every((s) => s && typeof s === "object" && !Array.isArray(s) && Array.isArray(s.data))) {
    return parsed.map((s, i) => ({ name: String(s.sheet ?? `Sheet${i + 1}`), rows: s.data }));
  }
  /* A bare grid: rows of cells. */
  if (parsed.every((r) => Array.isArray(r))) return [{ name: "Sheet1", rows: parsed }];
  return [];
}

/**
 * Read a workbook's sheets from a Buffer.
 *
 * Throws with a plain message rather than the library's own, because the
 * person reading it uploaded a spreadsheet and should be told that the file
 * could not be opened, not what a central directory record is.
 */
export async function readWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("That file was empty.");
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error(`That file is ${Math.round(buffer.length / 1024 / 1024)} MB. Price lists are expected under ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
  /* A .xlsx is a ZIP, and every ZIP starts PK. Checked here so that a .xls,
     a CSV renamed, or a PDF gets a sentence a person can act on instead of
     a parser error. */
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("That is not an .xlsx file. Save the price list as Excel Workbook (.xlsx) and upload it again — .xls and .csv are not read.");
  }

  let parsed;
  try {
    parsed = await readXlsxFile(Readable.from(buffer));
  } catch {
    throw new Error("That .xlsx could not be opened. If it came from a distributor portal, open it in Excel and save it again.");
  }

  const sheets = asSheets(parsed);
  if (!sheets.length) throw new Error("That workbook has no sheets in it.");
  return sheets;
}
