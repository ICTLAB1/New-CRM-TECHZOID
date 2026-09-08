import { describe, expect, it } from "vitest";
import { readableCompanyError, resolveActiveCompany, roleIn, type Company } from "./companies";

/**
 * Which company is on screen.
 *
 * The failure these guard is not a crash. It is somebody raising an invoice
 * under the wrong business's GSTIN because the CRM quietly put them
 * somewhere they did not expect to be.
 */

const TZ: Company = { id: "tz", name: "TechZoid Technologies", role: "Admin" };
const FX: Company = { id: "fx", name: "Foxpopz Trading", role: "Sales" };

describe("the company to open with", () => {
  it("is the one this browser was left on", () => {
    expect(resolveActiveCompany([TZ, FX], "fx")).toBe("fx");
  });

  it("is the first when nothing was remembered", () => {
    expect(resolveActiveCompany([TZ, FX], null)).toBe("tz");
  });

  /* Somebody removed from a company must not be left pointing at it, seeing
     an empty workspace with no explanation for why their work vanished. */
  it("falls back when the remembered company is no longer theirs", () => {
    expect(resolveActiveCompany([TZ], "fx")).toBe("tz");
  });

  it("has no answer when they belong to nothing, and says so", () => {
    /* A real state: an account that exists but has not been added to a
       company. Not an error — the store then behaves as it did before
       companies existed. */
    expect(resolveActiveCompany([], "fx")).toBeNull();
    expect(resolveActiveCompany([], null)).toBeNull();
  });

  it("ignores a remembered id that was tampered with", () => {
    /* The active company lives in localStorage, which the person can edit.
       It is a preference, never a permission — but it must not survive as a
       value the app then queries with. */
    expect(resolveActiveCompany([TZ], "'; drop table customers; --")).toBe("tz");
  });
});

describe("what you may do here", () => {
  it("reads the role from the company on screen, not from the profile", () => {
    /* A director of one business can be a salesperson in another, and the
       CRM has to believe the company. */
    expect(roleIn([TZ, FX], "tz")).toBe("Admin");
    expect(roleIn([TZ, FX], "fx")).toBe("Sales");
  });

  it("assumes the least when it cannot tell", () => {
    expect(roleIn([TZ, FX], null)).toBe("Sales");
    expect(roleIn([], "tz")).toBe("Sales");
  });
});

describe("what somebody is told when adding a company fails", () => {
  it("passes on the reason they can act on", () => {
    expect(readableCompanyError("Only an admin can add a company.")).toMatch(/admin/i);
    expect(readableCompanyError("A company needs a name.")).toMatch(/name/i);
    expect(readableCompanyError("Not signed in.")).toMatch(/sign in/i);
  });

  it("does not repeat a database error at somebody", () => {
    const said = readableCompanyError('duplicate key value violates unique constraint "companies_pkey"');
    expect(said).not.toMatch(/constraint|pkey|violates/i);
    expect(said).toMatch(/try again/i);
  });
});
