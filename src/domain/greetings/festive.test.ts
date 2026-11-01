import { describe, expect, it } from "vitest";
import {
  bannerUrlFor, DIWALI_2026, greetingFor, greetingIsCurrent, PUBLIC_SITE,
  type FestiveGreeting,
} from "./festive";

const on = (today: string, country?: string | null) => greetingFor({ today, country });

describe("Diwali 2026", () => {
  it("goes out on the last day of the window and not the day after", () => {
    /* THE WHOLE POINT OF THE END DATE. "Till the 10th" includes the 10th,
       and a greeting on the 11th is a company not looking at what it
       sends. */
    expect(on("2026-11-10", "India")?.id).toBe("diwali-2026");
    expect(on("2026-11-11", "India")).toBe(null);
  });

  it("goes out on the first day of the window and not the day before", () => {
    expect(on("2026-10-01", "India")?.id).toBe("diwali-2026");
    expect(on("2026-09-30", "India")).toBe(null);
  });

  it("dies on its own, with nothing to deploy", () => {
    /* A year later it is simply not found. Nobody has to remember. */
    expect(on("2027-11-08", "India")).toBe(null);
  });

  it("reaches India, and nowhere else", () => {
    expect(on("2026-11-08", "India")?.id).toBe("diwali-2026");
    for (const abroad of ["United Arab Emirates", "Germany", "United States", "Singapore"]) {
      expect(on("2026-11-08", abroad), abroad).toBe(null);
    }
  });

  it("treats a blank country as India, as the rest of the CRM does", () => {
    /* A customer typed in a hurry has no country, and the tax engine
       already reads that as a domestic sale. Two meanings for one empty
       field would be worse than either. */
    for (const blank of ["", "   ", null, undefined]) {
      expect(on("2026-11-08", blank)?.id).toBe("diwali-2026");
    }
  });

  it("does not care how the country was capitalised or spaced", () => {
    expect(on("2026-11-08", "india")?.id).toBe("diwali-2026");
    expect(on("2026-11-08", "  India  ")?.id).toBe("diwali-2026");
  });

  it("says nothing when it does not know what day it is", () => {
    /* Better no greeting than one sent on a date nobody established. */
    expect(on("", "India")).toBe(null);
  });

  it("carries words a customer can actually read", () => {
    const g = on("2026-11-08", "India")!;
    expect(g.headline).toMatch(/diwali/i);
    expect(g.line.length).toBeGreaterThan(20);
    expect(g.name).toBe("Diwali greetings");
  });
});

describe("the window rule on its own", () => {
  const g: FestiveGreeting = { ...DIWALI_2026, from: "2026-03-01", until: "2026-03-03" };

  it("includes both ends and excludes both sides", () => {
    expect(greetingIsCurrent(g, "2026-02-28")).toBe(false);
    expect(greetingIsCurrent(g, "2026-03-01")).toBe(true);
    expect(greetingIsCurrent(g, "2026-03-02")).toBe(true);
    expect(greetingIsCurrent(g, "2026-03-03")).toBe(true);
    expect(greetingIsCurrent(g, "2026-03-04")).toBe(false);
  });

  it("picks the greeting whose window is open, not the first in the list", () => {
    const earlier: FestiveGreeting = { ...DIWALI_2026, id: "old", from: "2026-01-01", until: "2026-01-02" };
    const now: FestiveGreeting = { ...DIWALI_2026, id: "now", from: "2026-11-01", until: "2026-11-10" };
    expect(greetingFor({ today: "2026-11-05", country: "India" }, [earlier, now])?.id).toBe("now");
  });
});

describe("the banner", () => {
  it("says on the artwork what it says in words", () => {
    /* A reader with images off must get the same greeting as one with them
       on, so the alt text, the headline and the line cannot drift from what
       is drawn on the strip. */
    const b = DIWALI_2026.banner!;
    expect(b.alt).toContain(DIWALI_2026.headline);
    expect(b.alt).toContain(DIWALI_2026.line);
  });

  it("declares that it claims an attachment", () => {
    /* It reads "Festive Quotation Attached". The send dialog reads this
       flag to keep it off an email with no file on it. */
    expect(DIWALI_2026.banner?.claimsAttachment).toBe(true);
  });

  it("is a real shape, so the markup can reserve it", () => {
    const b = DIWALI_2026.banner!;
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
    expect(b.path).not.toMatch(/^\//);
  });

  it("becomes an absolute URL on the host the CRM is open on", () => {
    /* A relative path in an email resolves against nothing. */
    expect(bannerUrlFor(DIWALI_2026, "https://crm.ttpldelhi.com"))
      .toBe("https://crm.ttpldelhi.com/email/diwali-2026.jpg");
    expect(bannerUrlFor(DIWALI_2026, "https://happy-wave-0df67e900.3.azurestaticapps.net/"))
      .toBe("https://happy-wave-0df67e900.3.azurestaticapps.net/email/diwali-2026.jpg");
  });

  it("never sends a customer a picture on somebody's laptop", () => {
    /* THE ONE THAT MATTERS. A developer sending a test from localhost would
       otherwise mail a customer an image only that machine can serve. */
    for (const local of ["http://localhost:5173", "https://localhost:5173", "https://127.0.0.1:8080", "http://crm.example", "", null]) {
      expect(bannerUrlFor(DIWALI_2026, local), String(local)).toBe(`${PUBLIC_SITE}/email/diwali-2026.jpg`);
    }
  });

  it("says there is no banner for a greeting that has none", () => {
    const wordsOnly: FestiveGreeting = { ...DIWALI_2026, banner: undefined };
    expect(bannerUrlFor(wordsOnly, "https://crm.ttpldelhi.com")).toBe(null);
  });
});
