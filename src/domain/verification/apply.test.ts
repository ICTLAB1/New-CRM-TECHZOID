import { describe, expect, it } from "vitest";
import {
  STALE_AFTER_DAYS, applyGstinVerification, applyPanVerification, panContradictsGstin,
  useLegalName, verificationAgeDays, verificationIsStale,
} from "./apply";
import { parseGstinResponse } from "./gstin";
import { looksLikePan, panWithinGstin, parsePanResponse } from "./pan";
import type { Customer } from "../customers/customer";

const NOW = Date.UTC(2026, 7, 27);
const DAY = 86_400_000;

const V = parseGstinResponse({
  data: {
    gstin: "27AACCN1234M1ZG",
    lgnm: "NORTHLINE LOGISTICS PRIVATE LIMITED",
    tradeNam: "Northline Logistics",
    sts: "Active", dty: "Regular", rgdt: "01/07/2017",
    pradr: { addr: { bno: "402", st: "Senapati Bapat Marg", city: "Pune", stcd: "Maharashtra", pncd: "411016" } },
  },
})!;

const base = (o: Partial<Customer> = {}): Customer => ({ id: "c1", ownerId: "u1", ...o });

describe("what a GSTIN verification writes", () => {
  it("records what the register said", () => {
    const c = applyGstinVerification(base(), V, NOW);
    expect(c.legalName).toBe("NORTHLINE LOGISTICS PRIVATE LIMITED");
    expect(c.tradeName).toBe("Northline Logistics");
    expect(c.gstinStatus).toBe("Active");
    expect(c.gstinTaxpayerType).toBe("Regular");
    expect(c.gstinRegisteredOn).toBe("2017-07-01");
    expect(c.gstinVerifiedAt).toBe(NOW);
  });

  it("NEVER overwrites the name people here use", () => {
    // Silently rewriting `company` would change how this customer appears on
    // every screen and every document, with nothing to notice it by.
    const c = applyGstinVerification(base({ company: "Northline (Pune depot)" }), V, NOW);
    expect(c.company).toBe("Northline (Pune depot)");
    expect(c.legalName).toBe("NORTHLINE LOGISTICS PRIVATE LIMITED");
  });

  it("applies the legal name only when somebody asks for it", () => {
    const c = useLegalName(applyGstinVerification(base({ company: "Northline (Pune depot)" }), V, NOW));
    expect(c.company).toBe("NORTHLINE LOGISTICS PRIVATE LIMITED");
  });

  it("does nothing when there is no legal name to apply", () => {
    const c = base({ company: "Northline" });
    expect(useLegalName(c)).toBe(c);
  });

  it("fills an empty address but leaves a typed one alone", () => {
    const blank = applyGstinVerification(base(), V, NOW);
    expect(blank.city).toBe("Pune");
    expect(blank.pincode).toBe("411016");

    const typed = applyGstinVerification(base({ city: "Pimpri", address: "Unit 7, MIDC" }), V, NOW);
    expect(typed.city).toBe("Pimpri");
    expect(typed.address).toBe("Unit 7, MIDC");
    // Still fills the ones nobody had typed.
    expect(typed.pincode).toBe("411016");
  });

  it("takes the PAN out of the GSTIN, but not over one typed by hand", () => {
    expect(applyGstinVerification(base(), V, NOW).pan).toBe("AACCN1234M");
    expect(applyGstinVerification(base({ pan: "ZZZZZ9999Z" }), V, NOW).pan).toBe("ZZZZZ9999Z");
  });

  it("does not touch the customer it was given", () => {
    const c = base({ company: "Northline" });
    applyGstinVerification(c, V, NOW);
    expect(c.legalName).toBeUndefined();
    expect(c.gstinVerifiedAt).toBeUndefined();
  });
});

describe("what a PAN verification writes", () => {
  it("records a PAN the register recognised", () => {
    const v = parsePanResponse({ data: { pan: "AACCN1234M", full_name: "NORTHLINE LOGISTICS PRIVATE LIMITED", status: "VALID", category: "Company" } })!;
    const c = applyPanVerification(base(), v, NOW);
    expect(c).toMatchObject({ pan: "AACCN1234M", panVerified: true, panVerifiedAt: NOW });
    expect(c.panName).toBe("NORTHLINE LOGISTICS PRIVATE LIMITED");
  });

  it("records one it did not, rather than quietly dropping the answer", () => {
    const v = parsePanResponse({ data: { pan: "AACCN1234M", status: "INVALID" } })!;
    expect(applyPanVerification(base(), v, NOW).panVerified).toBe(false);
  });

  it("treats an unfamiliar status as not verified", () => {
    // Saying a bad PAN is good is the expensive direction to be wrong in.
    const v = parsePanResponse({ data: { pan: "AACCN1234M", status: "SOMETHING NEW" } })!;
    expect(v.valid).toBe(false);
  });
});

describe("a PAN that disagrees with the GSTIN it should be inside", () => {
  it("is caught, because one of the two is a typo", () => {
    expect(panContradictsGstin({ gstin: "27AACCN1234M1ZG", pan: "ZZZZZ9999Z" })).toBe(true);
  });

  it("is quiet when they agree, or when either is missing", () => {
    expect(panContradictsGstin({ gstin: "27AACCN1234M1ZG", pan: "AACCN1234M" })).toBe(false);
    expect(panContradictsGstin({ gstin: "27AACCN1234M1ZG", pan: "aaccn1234m" })).toBe(false);
    expect(panContradictsGstin({ gstin: "", pan: "AACCN1234M" })).toBe(false);
    expect(panContradictsGstin({ gstin: "27AACCN1234M1ZG", pan: "" })).toBe(false);
    expect(panContradictsGstin({ gstin: "too-short", pan: "AACCN1234M" })).toBe(false);
  });
});

describe("how old an answer is", () => {
  it("counts whole days, and says nothing when never checked", () => {
    expect(verificationAgeDays(undefined, NOW)).toBeNull();
    expect(verificationAgeDays(NOW, NOW)).toBe(0);
    expect(verificationAgeDays(NOW - 3 * DAY, NOW)).toBe(3);
  });

  it("calls a verification stale after half a year", () => {
    // A registration active in March can be cancelled by September.
    expect(verificationIsStale(NOW - (STALE_AFTER_DAYS - 1) * DAY, NOW)).toBe(false);
    expect(verificationIsStale(NOW - STALE_AFTER_DAYS * DAY, NOW)).toBe(true);
    expect(verificationIsStale(undefined, NOW)).toBe(false);
  });

  it("does not report a future timestamp as ancient", () => {
    // Clock skew between a phone and the server is ordinary.
    expect(verificationAgeDays(NOW + 5 * DAY, NOW)).toBe(0);
  });
});

describe("the PAN inside a GSTIN", () => {
  it("is characters three to twelve", () => {
    expect(panWithinGstin("27AACCN1234M1ZG")).toBe("AACCN1234M");
    expect(looksLikePan(panWithinGstin("27AACCN1234M1ZG"))).toBe(true);
  });

  it("is nothing at all for anything that is not 15 characters", () => {
    expect(panWithinGstin("27AACCN1234M")).toBe("");
    expect(panWithinGstin("")).toBe("");
  });
});
