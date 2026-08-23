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

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Screenshot one screen, navigating to it by its sidebar item first. */
async function shoot(name, viewport, navLabel, after) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto("http://localhost:4599/", { waitUntil: "networkidle" });
  if (navLabel) {
    await page.getByRole("button", { name: navLabel, exact: true }).first().click();
    await page.waitForTimeout(300);
  }
  if (after) await after(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `tmp/ui-${name}.png`, fullPage: !!(after === undefined && viewport === DESKTOP) });
  console.log(`tmp/ui-${name}.png`);
  await page.close();
}

await shoot("pipeline", DESKTOP, "Pipeline");
await shoot("customers", DESKTOP, "Customers");
await shoot("customer-sheet", DESKTOP, "Customers", async (page) => {
  await page.getByText("Acme Manufacturing India Pvt Ltd").first().click();
  await page.waitForTimeout(400);
});
await shoot("components", DESKTOP, "Components");
await shoot("pipeline-phone", PHONE, null, async (page) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Pipeline", exact: true }).first().click();
  await page.waitForTimeout(350);
});

await browser.close();
server.close();
