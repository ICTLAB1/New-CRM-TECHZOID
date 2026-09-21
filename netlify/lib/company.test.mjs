import { describe, expect, it } from "vitest";
import { companyForOwner, withCompany } from "./company.mjs";

/**
 * Which company a record written by the server belongs to.
 *
 * The regression: migration 033 made company_id NOT NULL with a default that
 * reads the signed-in user, and every one of these endpoints runs as the
 * service role with nobody signed in. A customer filling in the registration
 * form got "Something went wrong submitting your details" and their enquiry
 * was lost.
 */

/** Enough of the Supabase client for the three queries this makes. */
function fakeAdmin({ settings = [], members = [], companies = [], fail = "" } = {}) {
  const table = (rows) => {
    const q = {
      _rows: rows,
      select() { return q; },
      not() { return q; },
      eq(_col, val) { q._rows = q._rows.filter((r) => String(r.user_id) === String(val)); return q; },
      order() { return q; },
      limit(n) { return Promise.resolve({ data: q._rows.slice(0, n) }); },
      then(resolve) { return Promise.resolve({ data: q._rows }).then(resolve); },
    };
    return q;
  };
  return {
    from(name) {
      if (fail === name) return { select() { throw new Error("boom"); } };
      if (name === "settings") return table(settings);
      if (name === "company_members") return table(members);
      if (name === "companies") return table(companies);
      return table([]);
    },
  };
}

const COMPANIES = [{ id: "tz" }, { id: "vx" }];

describe("which company an inbound record joins", () => {
  it("is the one whose settings nominate that person for inbound records", () => {
    /* The setting is per company, so naming somebody there is a statement
       about which business their leads belong to. */
    const admin = fakeAdmin({
      companies: COMPANIES,
      settings: [
        { company_id: "tz", data: { webhook: { inboundOwnerId: "other" } } },
        { company_id: "vx", data: { webhook: { inboundOwnerId: "u1" } } },
      ],
      members: [{ user_id: "u1", company_id: "tz" }],
    });
    return expect(companyForOwner(admin, "u1")).resolves.toBe("vx");
  });

  it("reads the IndiaMART owner setting too", async () => {
    const admin = fakeAdmin({
      companies: COMPANIES,
      settings: [{ company_id: "vx", data: { indiamart: { ownerId: "u1" } } }],
      members: [],
    });
    expect(await companyForOwner(admin, "u1")).toBe("vx");
  });

  it("falls back to the company that person belongs to", async () => {
    const admin = fakeAdmin({
      companies: COMPANIES,
      settings: [{ company_id: "tz", data: {} }],
      members: [{ user_id: "u1", company_id: "vx" }],
    });
    expect(await companyForOwner(admin, "u1")).toBe("vx");
  });

  /* Somewhere beats nowhere: a misfiled lead is visible and can be moved, a
     rejected one is gone and the person has closed the tab. */
  it("falls back to the oldest company when the owner belongs to none", async () => {
    const admin = fakeAdmin({ companies: COMPANIES, settings: [], members: [] });
    expect(await companyForOwner(admin, "nobody")).toBe("tz");
  });

  it("does the same when there is no owner at all", async () => {
    const admin = fakeAdmin({ companies: COMPANIES });
    expect(await companyForOwner(admin, "")).toBe("tz");
    expect(await companyForOwner(admin, null)).toBe("tz");
  });

  /* A workspace that has not run migration 033 has no companies table. The
     column does not exist either, so the caller must omit it rather than
     send a null. */
  it("answers null when there are no companies to choose from", async () => {
    expect(await companyForOwner(fakeAdmin({ companies: [] }), "u1")).toBeNull();
  });

  it("keeps going when a lookup throws rather than losing the record", async () => {
    const admin = fakeAdmin({ companies: COMPANIES, fail: "settings" });
    expect(await companyForOwner(admin, "u1")).toBe("tz");
  });
});

describe("adding the column to a row", () => {
  it("adds it when there is a company", () => {
    expect(withCompany({ id: "x" }, "tz")).toEqual({ id: "x", company_id: "tz" });
  });

  it("leaves the row untouched when there is not, rather than writing null", () => {
    /* Sending company_id: null is worse than omitting it — it defeats the
       column default, which is the floor under all of this. */
    expect(withCompany({ id: "x" }, null)).toEqual({ id: "x" });
    expect(withCompany({ id: "x" }, "")).toEqual({ id: "x" });
  });
});
