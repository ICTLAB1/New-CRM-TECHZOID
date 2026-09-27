import { chromium } from "playwright";
const screens = [
  ["login", "01-login", 1600, 1000],
  ["dashboard", "02-dashboard", 1600, 1480],
  ["leads", "03-leads", 1600, 900],
  ["lead", "04-lead-detail", 1600, 1180],
  ["accounts", "05-accounts", 1600, 700],
  ["opportunity", "06-opportunity", 1600, 1050],
  ["pipeline", "07-pipeline", 1600, 900],
  ["tasks", "08-tasks", 1600, 1040],
  ["team", "09-my-performance", 1600, 980],
  ["management", "10-management", 1600, 1090],
  ["reports", "11-reports", 1600, 1420],
  ["automations", "12-automations", 1600, 1120],
];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errs = [];
for (const [s, name, w, h] of screens) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  p.on("pageerror", (e) => errs.push(name + ": " + String(e.message).slice(0, 110)));
  await p.goto(`http://localhost:5300/?s=${s}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  await p.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: true });
  const o = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  if (o.s > o.c + 2) errs.push(name + ": sideways scroll " + o.s + " > " + o.c);
  await p.close();
}
// phone
const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
m.on("pageerror", (e) => errs.push("mobile: " + String(e.message).slice(0, 110)));
await m.goto("http://localhost:5300/?s=mobile", { waitUntil: "networkidle" });
await m.waitForTimeout(600);
await m.screenshot({ path: "/tmp/shots/13-mobile.png", fullPage: true });
const mo = await m.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
if (mo.s > mo.c + 2) errs.push("mobile sideways scroll");
// tablet check of a dense screen
const t = await b.newPage({ viewport: { width: 834, height: 1100 }, deviceScaleFactor: 2 });
await t.goto("http://localhost:5300/?s=dashboard", { waitUntil: "networkidle" });
await t.waitForTimeout(500);
await t.screenshot({ path: "/tmp/shots/14-tablet.png", fullPage: false });
const to = await t.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
if (to.s > to.c + 2) errs.push("tablet sideways scroll " + to.s + ">" + to.c);
await b.close();
console.log(errs.length ? "ISSUES:\n" + errs.join("\n") : "all screens captured clean");
