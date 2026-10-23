import { describe, expect, it } from "vitest";
import { billingChosen } from "./formGroups";
import { applyCountry, blankCustomer } from "./customer";

const blank = () => blankCustomer("u1", "c1");

describe("billingChosen", () => {
  it("is false for a customer nobody has touched", () => {
    /* THE REGRESSION. blankCustomer seeds segment "SMB" and source
       "Inbound Call", so treating those as "filled in" made every new
       customer look like one whose commercial terms had been decided, and
       the group that was supposed to be folded away opened on all of
       them. A browser found this; no test did. */
    expect(billingChosen(blank())).toBe(false);
  });

  it("is false after merely correcting the country", () => {
    /* applyCountry moves the currency and the regime with it. Following the
       country is not choosing. */
    expect(billingChosen(applyCountry(blank(), "United Arab Emirates"))).toBe(false);
    expect(billingChosen(applyCountry(blank(), "Germany"))).toBe(false);
  });

  it("is true for a currency somebody set against the country", () => {
    const german = applyCountry(blank(), "Germany");
    expect(billingChosen({ ...german, currency: "USD" })).toBe(true);
  });

  it("is true for a tax regime somebody set", () => {
    expect(billingChosen({ ...blank(), taxType: "export" })).toBe(true);
    expect(billingChosen({ ...applyCountry(blank(), "Germany"), taxType: "gst" })).toBe(true);
  });

  it("is true for a segment or a source somebody picked", () => {
    expect(billingChosen({ ...blank(), segment: "Enterprise" })).toBe(true);
    expect(billingChosen({ ...blank(), source: "GeM Portal" })).toBe(true);
  });
});
