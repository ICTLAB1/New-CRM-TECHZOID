import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import { COMPANY_LOCKUP_PATH, MICROSOFT_MARK_PATH, SIGNIN_BACKDROP_PATH } from "./brand";

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

describe("the Microsoft mark on the sign-in button", () => {
  it("names a file that is actually in public/", () => {
    expect(MICROSOFT_MARK_PATH.startsWith("/")).toBe(true);
    expect(existsSync(`public${MICROSOFT_MARK_PATH}`), `public${MICROSOFT_MARK_PATH} is missing`).toBe(true);
  });

  it("IS NOT THE WORDMARK — the button sets that word itself", () => {
    /* vendor-microsoft.png is the mark AND the word "Microsoft", drawn
       for the company profile email. On a button labelled "Sign in with
       Microsoft" it would print the word twice. Pointing this constant at
       that file is the mistake this guard exists to catch. */
    expect(MICROSOFT_MARK_PATH).not.toBe("/brand/vendor-microsoft.png");
    expect(existsSync("public/brand/vendor-microsoft.png")).toBe(true);
  });

  it("is a few kilobytes, like the other marks beside it", () => {
    /* It sits on the first screen anybody sees, before anything else has
       loaded. A mark that is not tiny here is a mark somebody exported at
       the wrong size. */
    const bytes = statSync(`public${MICROSOFT_MARK_PATH}`).size;
    expect(bytes, `${Math.round(bytes / 1024)} KB`).toBeLessThan(20 * 1024);
  });
});

describe("the photograph behind the sign-in panel", () => {
  it("names a file that is actually in public/", () => {
    expect(SIGNIN_BACKDROP_PATH.startsWith("/")).toBe(true);
    expect(existsSync(`public${SIGNIN_BACKDROP_PATH}`), `public${SIGNIN_BACKDROP_PATH} is missing`).toBe(true);
  });

  it("IS A PHOTOGRAPH, so it is stored as one", () => {
    /* The same picture as a PNG is roughly eight times the bytes for no
       visible gain. This is the one file in public/brand that is a
       photograph rather than a mark, and the one that should not be a
       PNG. */
    expect(SIGNIN_BACKDROP_PATH).toMatch(/\.jpe?g$/);
  });

  it("stays small enough to sit on the front door", () => {
    /* It loads on the sign-in screen, which is the first thing anybody
       waits for and often on a phone on mobile data. Under 120 KB —
       generous for a photograph, and far under what an unoptimised
       export off a design tool weighs. */
    const bytes = statSync(`public${SIGNIN_BACKDROP_PATH}`).size;
    expect(bytes, `${Math.round(bytes / 1024)} KB`).toBeLessThan(120 * 1024);
  });
});
