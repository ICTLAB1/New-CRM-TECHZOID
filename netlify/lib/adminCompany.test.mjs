import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The company a new sign-in joins.
 *
 * `companyToJoin` lives inside admin-users.mjs, which is a handler and not
 * importable without a Supabase client, so this exercises the same logic
 * against a fake and pins the handler's own source to it. The thing being
 * guarded is not a crash: it is somebody being created into a company their
 * creator has nothing to do with, using a service key that is above
 * row-level security.
 */

/** The same shape the real one has, so the cases below mean something. */
function companyToJoin(rows, requested) {
  if (!rows.length) return { id: "", name: "" };
  const chosen = requested ? rows.find((r) => String(r.company_id) === requested) : rows[0];
  if (requested && !chosen) return { error: "You can only add somebody to a company you belong to." };
  if (!["Admin", "Manager"].includes(String(chosen?.role ?? ""))) {
    return { error: "Only an admin or manager of that company can add somebody to it." };
  }
  const company = Array.isArray(chosen.companies) ? chosen.companies[0] : chosen.companies;
  return { id: String(chosen.company_id), name: String(company?.name ?? "") };
}

const TZ = { company_id: "tz", role: "Admin", companies: { name: "TechZoid" } };
const VX = { company_id: "vx", role: "Admin", companies: { name: "Vertex" } };
const SALES_AT_VX = { company_id: "vx", role: "Sales", companies: { name: "Vertex" } };

describe("which company a new person joins", () => {
  it("is the one the browser asked for, when the caller belongs to it", () => {
    expect(companyToJoin([TZ, VX], "vx")).toMatchObject({ id: "vx", name: "Vertex" });
  });

  /* The service key this endpoint holds is above row-level security, so
     nothing else would have stopped this. */
  it("refuses a company the caller does not belong to", () => {
    expect(companyToJoin([TZ], "vx").error).toMatch(/company you belong to/i);
  });

  it("refuses a company the caller is only a salesperson in", () => {
    expect(companyToJoin([SALES_AT_VX], "vx").error).toMatch(/admin or manager/i);
  });

  /* An older deployment does not send one. Landing nowhere is the worst
     outcome: they sign in, every screen is empty because every record is
     scoped to a company they are not in, and it reads as a broken account. */
  it("falls back to the caller's own company when none was named", () => {
    expect(companyToJoin([TZ, VX], "")).toMatchObject({ id: "tz" });
  });

  it("adds nobody to anything when the caller belongs to nothing", () => {
    expect(companyToJoin([], "")).toEqual({ id: "", name: "" });
  });

  it("reads the joined company whether it arrives as an object or an array", () => {
    const asArray = { company_id: "tz", role: "Admin", companies: [{ name: "TechZoid" }] };
    expect(companyToJoin([asArray], "tz").name).toBe("TechZoid");
  });
});

describe("the handler still does what these cases describe", () => {
  const source = readFileSync(new URL("../functions/admin-users.mjs", import.meta.url), "utf8");

  it("verifies the company before creating the sign-in", () => {
    /* Order matters: creating the account first and then discovering the
       caller may not staff that company leaves an orphaned sign-in. */
    const check = source.indexOf("companyToJoin(admin, caller, companyId)");
    const create = source.indexOf("auth.admin.createUser");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(create);
  });

  it("clamps the profile role but keeps the chosen role on the membership", () => {
    /* profiles.role allows Admin, Manager and Sales; company_members.role
       also allows Accounts. Writing "Accounts" to the profile silently
       failed its check constraint. */
    expect(source).toMatch(/PROFILE_ROLES\s*=\s*\["Admin", "Manager", "Sales"\]/);
    expect(source).toMatch(/role:\s*profileRole/);
    expect(source).toMatch(/company_members[\s\S]{0,200}user_id: userId, role \}/);
  });

  it("adds the membership rather than leaving the account unattached", () => {
    expect(source).toMatch(/from\("company_members"\)\s*\.insert/);
  });
});
