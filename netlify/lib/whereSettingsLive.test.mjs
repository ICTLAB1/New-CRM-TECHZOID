import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { askAdminToAdd, whereSettingsLive } from "./whereSettingsLive.mjs";

const saved = process.env.WEBSITE_SITE_NAME;
afterEach(() => {
  if (saved === undefined) delete process.env.WEBSITE_SITE_NAME;
  else process.env.WEBSITE_SITE_NAME = saved;
});

describe("telling an admin where to change a setting", () => {
  it("names the Function App Azure says it is running as", () => {
    process.env.WEBSITE_SITE_NAME = "techzoid-fn-web7gna6q5rns";
    expect(whereSettingsLive()).toContain("techzoid-fn-web7gna6q5rns");
    expect(askAdminToAdd("INTERAKT_API_KEY")).toBe(
      "Ask an admin to add INTERAKT_API_KEY in Azure → Function App techzoid-fn-web7gna6q5rns → Environment variables, then Apply.",
    );
  });

  it("still says where to look when Azure has not named the app", () => {
    delete process.env.WEBSITE_SITE_NAME;
    expect(whereSettingsLive()).toMatch(/Azure/);
    expect(whereSettingsLive()).not.toMatch(/undefined|null/);
  });

  it("no message sends an admin to Netlify any more", () => {
    /* The bug this guards: ten literals saying "add INTERAKT_API_KEY in
       Netlify", each correct when written and all wrong after the move to
       Azure. Nothing on screen pointed at the dashboard that actually
       holds the setting. Comments may still mention the history. */
    const dir = new URL(".", import.meta.url).pathname;
    const offenders = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".mjs") || file.endsWith(".test.mjs")) continue;
      if (file === "whereSettingsLive.mjs") continue;
      const body = readFileSync(join(dir, file), "utf8");
      for (const line of body.split("\n")) {
        const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");
        if (/in Netlify|Netlify →/.test(code)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
