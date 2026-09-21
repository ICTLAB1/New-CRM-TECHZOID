import { describe, expect, it } from "vitest";
import {
  CURRENCY_BY_COUNTRY as SERVER_MAP, currencyForCountry as serverFor,
} from "./currencyForCountry.mjs";
import {
  CURRENCY_BY_COUNTRY as APP_MAP, currencyForCountry as appFor,
} from "../../src/domain/geo/currencyForCountry";
import { COUNTRIES } from "../../src/domain/geo/countries";

/**
 * The browser and the server must agree on what a customer is quoted in.
 *
 * The registration form runs in a browser; the endpoint that saves what it
 * collects runs on a server and cannot import TypeScript. Two copies of the
 * same table is a liability, not a design — this is where it is paid off.
 * If you change one, change the other, and this will tell you if you did
 * not. Do not "fix" a difference by editing the test.
 */

describe("the two copies of the country-to-currency table", () => {
  it("give the same answer for every country the forms offer", () => {
    for (const country of [...COUNTRIES, "", "Narnia", "  India  "]) {
      expect(serverFor(country), country).toBe(appFor(country));
    }
  });

  it("hold exactly the same entries", () => {
    expect(Object.keys(SERVER_MAP).sort()).toEqual(Object.keys(APP_MAP).sort());
    for (const [country, code] of Object.entries(APP_MAP)) {
      expect(SERVER_MAP[country], country).toBe(code);
    }
  });

  it("both trim what somebody typed with a stray space", () => {
    expect(serverFor(" United Arab Emirates ")).toBe("AED");
    expect(appFor(" United Arab Emirates ")).toBe("AED");
  });
});
