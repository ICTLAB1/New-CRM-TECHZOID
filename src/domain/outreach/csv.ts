/**
 * Reading a CSV somebody exported from somewhere else.
 *
 * Written rather than pulled in as a dependency because the job is small and
 * the failure mode of getting it wrong is specific: a prospect list exported
 * from Apollo, Sales Navigator or a conference organiser routinely contains
 * `"Acme Pvt Ltd, Delhi"` in the company column and `"Head of IT, Infra"` in
 * the title. Splitting on commas turns one row into two and shifts every
 * column after it — silently, so the import "works" and every email goes out
 * addressed to a job title.
 *
 * So: quotes are honoured, doubled quotes inside a quoted field are an
 * escaped quote, and a newline inside quotes is part of the value rather than
 * the end of the row. Those three rules are the whole of RFC 4180 that
 * matters here.
 *
 * WHAT IT DOES NOT DO. No type inference, no trimming of values that might
 * be meaningful, no dropping of blank columns. Everything comes out as a
 * string, because a phone number that starts 0 and a GSTIN that looks like a
 * number in scientific notation are the two things a "helpful" parser
 * destroys first.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** Rows whose column count did not match the header. Kept, not dropped:
   *  a screen should say "3 rows looked malformed" rather than quietly
   *  importing fewer people than the file contains. */
  ragged: number[];
}

/** Split one delimited document into rows of raw cells. */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  /* A byte-order mark at the start of a file Excel wrote. Left in, it becomes
     part of the first header and every mapping guess misses. */
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < src.length) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"' && field === "") { quoted = true; i += 1; continue; }
    if (ch === delimiter) { endField(); i += 1; continue; }

    if (ch === "\r") {
      /* CRLF from a Windows export, or a lone CR from something older. */
      if (src[i + 1] === "\n") i += 1;
      endRow(); i += 1; continue;
    }
    if (ch === "\n") { endRow(); i += 1; continue; }

    field += ch; i += 1;
  }

  /* A file that does not end in a newline still has a last row. */
  if (field !== "" || row.length) endRow();

  return rows;
}

/**
 * Guess the delimiter.
 *
 * European exports use semicolons, and a tab-separated file saved as .csv is
 * common enough to be worth handling. Decided on the header line only: the
 * winner is whichever character produces the most fields, which is wrong only
 * for a single-column file, where it does not matter.
 */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = (parseDelimited(firstLine, d)[0] ?? []).length;
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

/**
 * Parse a whole file into objects keyed by header.
 *
 * A duplicated header gets a suffix rather than silently overwriting: two
 * columns both called "Email" is a real export, and losing the second one
 * without saying so is how somebody's mobile numbers disappear.
 */
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const d = delimiter ?? sniffDelimiter(text);
  const table = parseDelimited(text, d).filter((r) => r.some((c) => c.trim() !== ""));

  if (!table.length) return { headers: [], rows: [], ragged: [] };

  const seen = new Map<string, number>();
  const headers = (table[0] ?? []).map((h, idx) => {
    const name = h.trim() || `Column ${idx + 1}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name} (${n + 1})`;
  });

  const rows: Record<string, string>[] = [];
  const ragged: number[] = [];

  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r] ?? [];
    if (cells.length !== headers.length) ragged.push(r + 1);

    const obj: Record<string, string> = {};
    headers.forEach((h, c) => { obj[h] = (cells[c] ?? "").trim(); });
    rows.push(obj);
  }

  return { headers, rows, ragged };
}
