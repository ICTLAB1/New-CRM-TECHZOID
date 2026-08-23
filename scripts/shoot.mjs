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
    /* Nav items with a badge have it in their accessible name ("Renewals 7"),
       so match on the label rather than the whole string. */
    await page.getByRole("button", { name: new RegExp(`^${navLabel}\\b`) }).first().click();
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
await shoot("quotations", DESKTOP, "Quotations");
await shoot("editor", { width: 1600, height: 1100 }, "Quotations", async (page) => {
  await page.getByText("TZ/QT/2627/0117").first().click();
  await page.waitForTimeout(600);
});
await shoot("editor-items", { width: 1600, height: 1100 }, "Quotations", async (page) => {
  await page.getByText("TZ/QT/2627/0117").first().click();
  await page.waitForTimeout(400);
  await page.getByRole("tab", { name: /Items/ }).click();
  await page.waitForTimeout(400);
});
await shoot("dashboard", DESKTOP, "Dashboard");
await shoot("reports", DESKTOP, "Reports");
await shoot("orders", DESKTOP, "Sales orders");
await shoot("renewals", DESKTOP, "Renewals");
await shoot("components", DESKTOP, "Components");
await shoot("integrations", DESKTOP, "Integrations");
await shoot("integrations-setup", DESKTOP, "Integrations", async (page) => {
  await page.getByRole("button", { name: /One-time setup/ }).click();
  await page.waitForTimeout(500);
});
await shoot("assistant", DESKTOP, "Assistant");
await shoot("doc-email", { width: 1600, height: 1100 }, "Quotations", async (page) => {
  await page.getByText("TZ/QT/2627/0117").first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.waitForTimeout(400);
});
await shoot("doc-invoicing", { width: 1600, height: 1100 }, "Quotations", async (page) => {
  await page.getByText("TZ/QT/2627/0117").first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Send for invoicing/ }).click();
  await page.waitForTimeout(400);
});
await shoot("integrations-phone", PHONE, null, async (page) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Integrations", exact: true }).first().click();
  await page.waitForTimeout(350);
});
await shoot("pipeline-phone", PHONE, null, async (page) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Pipeline", exact: true }).first().click();
  await page.waitForTimeout(350);
});

await browser.close();
server.close();
