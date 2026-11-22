import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import { COMPANY_LOCKUP_PATH } from "./brand";

/**
 * The logo the interface shows.
 *
 * The guard here is the one SIGNATURE_IMAGE_PATH has in
 * emailIdentity.test.ts, and it exists for the same reason: the code
 * once named a brand file before anybody had put it in public/, and
 * every email went out with a broken-image icon and its alt text
 * spilling out underneath. A constant naming a file that is not there
 * fails at the only moment nobody is looking — on somebody else's
 * screen.
 */

describe("the company lockup", () => {
  it("names a file that is actually in public/", () => {
    expect(COMPANY_LOCKUP_PATH.startsWith("/")).toBe(true);
    expect(existsSync(`public${COMPANY_LOCKUP_PATH}`), `public${COMPANY_LOCKUP_PATH} is missing`).toBe(true);
  });

  it("is small enough to sit in the shell of every page", () => {
    /* It loads on first paint, before anything else on the screen. The
       wordmark it sits beside in public/brand is 21 KB; this one carries
       the strapline too and still has no business being larger than a
       photograph nobody asked for. */
    const bytes = statSync(`public${COMPANY_LOCKUP_PATH}`).size;
    expect(bytes, `${Math.round(bytes / 1024)} KB`).toBeLessThan(60 * 1024);
  });

  it("is NOT the email's wordmark — those two were cropped differently", () => {
    /* company-logo.png has the strapline cropped away, because the email
       header prints it as text and would otherwise say it twice. The
       interface sets no such text, so it shows the lockup whole. Pointing
       one at the other undoes a decision recorded in
       public/brand/README.md. */
    expect(COMPANY_LOCKUP_PATH).not.toBe("/brand/company-logo.png");
    expect(existsSync("public/brand/company-logo.png")).toBe(true);
  });
});
