/* Screenshot the built app at desktop and phone widths.
   The design gets the same treatment as the PDF: render it and look. */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";

const DIST = "dist";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".map": "application/json", ".svg": "image/svg+xml" };

const server = createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  let file = join(DIST, url === "/" ? "index.html" : url);
  if (!existsSync(file)) file = join(DIST, "index.html");
  res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4599, r));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

for (const [name, viewport] of Object.entries({
  desktop: { width: 1440, height: 1150 },
  "desktop-top": { width: 1440, height: 760 },
  phone: { width: 390, height: 844 },
})) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto("http://localhost:4599/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `tmp/ui-${name}.png`, fullPage: name === "desktop" });
  console.log(`tmp/ui-${name}.png`);
  await page.close();
}

// The bottom sheet: same Modal component, phone width.
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:4599/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Filters" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: "tmp/ui-sheet.png" });
console.log("tmp/ui-sheet.png");

await browser.close();
server.close();
