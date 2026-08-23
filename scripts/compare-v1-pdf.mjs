/**
 * Render the SAME document through v1's generator and the v2 renderer, then
 * compare — extracted text, and a pixel diff of the rasterised pages.
 *
 * This is the byte-level comparison that caught the preview/PDF drift in v1,
 * made repeatable. Run it after ANY change to the renderer or the shared
 * column definition, and look at the images as well as the numbers.
 *
 *   node scripts/compare-v1-pdf.mjs
 *
 * Requires poppler-utils (pdftoppm, pdftotext).
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { generateDocPDF, DEFAULT_SETTINGS, computeQuote } from "./v1-pdf-reference.mjs";
import { SAMPLE } from "./sample-doc.mjs";

const settings = {
  ...DEFAULT_SETTINGS,
  ...SAMPLE.settings,
  logo: null, brandingLogos: [], certLogos: [],
};

const totals = computeQuote(SAMPLE.doc, "Delhi");
const out = await generateDocPDF({ doc: SAMPLE.doc, settings, totals, docType: "quotation", returnBlob: true });
writeFileSync("tmp/v1-quotation.pdf", Buffer.from(out.base64, "base64"));
console.log(`v1 rendered: grand ${totals.grand}`);

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });

run("pdftotext", ["tmp/v1-quotation.pdf", "tmp/v1r.txt"]);
run("pdftotext", ["tmp/quotation.pdf", "tmp/v2r.txt"]);
const same = run("bash", ["-c", "diff -q tmp/v1r.txt tmp/v2r.txt >/dev/null && echo yes || echo no"]).trim();
console.log(`extracted text identical: ${same}`);

run("pdftoppm", ["-gray", "-r", "150", "-f", "1", "-l", "1", "tmp/v1-quotation.pdf", "tmp/b"]);
run("pdftoppm", ["-gray", "-r", "150", "-f", "1", "-l", "1", "tmp/quotation.pdf", "tmp/a"]);
console.log(run("python3", ["scripts/pixel-diff.py", "tmp/a-1.pgm", "tmp/b-1.pgm"]).trim());
console.log("\nNow LOOK at tmp/quotation-1.png and tmp/v1q-1.png. Numbers are not enough.");
