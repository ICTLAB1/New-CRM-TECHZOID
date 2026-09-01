import { describe, expect, it } from "vitest";
import { auditRows, inferMapping, mapRow, normaliseHeader } from "./importMap";

describe("guessing which column is which", () => {
  it("recognises the spellings a real list uses", () => {
    const m = inferMapping(["First Name", "Last Name", "Work Email", "Designation", "Company Name", "Mobile No"]);
    expect(m.firstName).toBe("First Name");
    expect(m.lastName).toBe("Last Name");
    expect(m.email).toBe("Work Email");
    expect(m.jobTitle).toBe("Designation");
    expect(m.company).toBe("Company Name");
    expect(m.mobile).toBe("Mobile No");
  });

  it("does not care about case, spaces, underscores or hyphens", () => {
    expect(normaliseHeader("  E-Mail_Address ")).toBe("emailaddress");
    expect(inferMapping(["email_address"]).email).toBe("email_address");
    expect(inferMapping(["EMAIL ADDRESS"]).email).toBe("EMAIL ADDRESS");
  });

  /* THE ORDERING BUG THIS PREVENTS. "Company Domain" starts with "company",
     so a prefix-first pass binds it to `company` and the real Company column
     is left unmapped. Exact matches are taken across every field before any
     prefix matching begins. */
  it("does not let Company Domain steal the Company column", () => {
    const m = inferMapping(["Company Domain", "Company"]);
    expect(m.company).toBe("Company");
    expect(m.companyDomain).toBe("Company Domain");
  });

  it("never binds one column to two fields", () => {
    const m = inferMapping(["Email"]);
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });

  it("leaves a field unmapped rather than guessing wildly", () => {
    expect(inferMapping(["Notes", "Remarks"]).email).toBeUndefined();
  });
});

describe("turning a row into a prospect", () => {
  const mapping = { email: "Email", fullName: "Name", company: "Company", companyDomain: "Website" };

  it("splits a full name when the halves are missing", () => {
    const p = mapRow({ Email: "R@Acme.IN", Name: "Ravi Menon", Company: "Acme" }, mapping);
    expect(p.email).toBe("r@acme.in");
    expect(p.firstName).toBe("Ravi");
    expect(p.lastName).toBe("Menon");
  });

  it("builds a full name when only the halves are there", () => {
    const p = mapRow({ First: "Ravi", Last: "Menon" }, { firstName: "First", lastName: "Last" });
    expect(p.fullName).toBe("Ravi Menon");
  });

  it("handles a one-word name without inventing a surname", () => {
    const p = mapRow({ Name: "Ravi" }, { fullName: "Name" });
    expect(p.firstName).toBe("Ravi");
    expect(p.lastName).toBe("");
  });

  it("reduces a website to a bare domain", () => {
    for (const site of ["https://www.acme.in/about", "HTTP://Acme.in", "acme.in"]) {
      expect(mapRow({ Website: site }, mapping).companyDomain, site).toContain("acme.in");
    }
  });

  /* An unmapped column is kept, not dropped. Somebody's "Renewal Month"
     column is often the reason the list was worth importing. */
  it("keeps the columns it did not claim", () => {
    const p = mapRow({ Email: "r@acme.in", "Renewal Month": "March", Blank: "" }, mapping);
    expect(p.extra).toEqual({ "Renewal Month": "March" });
  });
});

describe("what the audit tells you before anything is written", () => {
  const mapping = { email: "Email", fullName: "Name", company: "Company" };
  const rows = [
    { Email: "ravi@acme.in", Name: "Ravi Menon", Company: "Acme" },
    { Email: "RAVI@ACME.IN", Name: "Ravi M", Company: "Acme" },      // same person, different case
    { Email: "not-an-email", Name: "Broken", Company: "Acme" },
    { Email: "temp@mailinator.com", Name: "Throwaway", Company: "X" },
    { Email: "", Name: "No Address", Company: "Y" },
    { Email: "meena@acme.in", Name: "", Company: "" },                // usable, but gaps
    { Email: "old@known.com", Name: "Known", Company: "Known Ltd" },
    { Email: "gone@acme.in", Name: "Left", Company: "Acme" },
  ];
  const audit = auditRows(rows, mapping, {
    existing: new Set(["old@known.com"]),
    suppressed: new Set(["gone@acme.in"]),
  });

  it("counts every problem, not just the first one it hits", () => {
    expect(audit.total).toBe(8);
    expect(audit.counts["duplicate-in-file"]).toBe(1);
    expect(audit.counts["invalid-email"]).toBe(2);   // syntax + disposable
    expect(audit.counts["no-email"]).toBe(1);
    expect(audit.counts["already-imported"]).toBe(1);
    expect(audit.counts.suppressed).toBe(1);
    expect(audit.counts["no-name"]).toBe(1);
    expect(audit.counts["no-company"]).toBe(1);
  });

  it("offers only the rows that can safely be written", () => {
    expect(audit.importable).toBe(2);   // ravi + meena
    expect(audit.rows.filter((r) => r.importable).map((r) => r.prospect.email))
      .toEqual(["ravi@acme.in", "meena@acme.in"]);
  });

  /* A duplicate in the file is caught case-insensitively — the same guarantee
     the database's unique index gives, checked here so the user is told
     BEFORE the insert fails rather than after. */
  it("treats RAVI@ACME.IN as the same person as ravi@acme.in", () => {
    expect(audit.rows[1]?.problems).toContain("duplicate-in-file");
    expect(audit.rows[0]?.problems).not.toContain("duplicate-in-file");
  });

  it("keeps a row with gaps — a missing name is not a reason to drop a lead", () => {
    const gappy = audit.rows.find((r) => r.prospect.email === "meena@acme.in");
    expect(gappy?.importable).toBe(true);
    expect(gappy?.problems).toEqual(["no-name", "no-company"]);
  });

  it("attaches the reason an address was rejected, ready to show", () => {
    const disposable = audit.rows.find((r) => r.prospect.email === "temp@mailinator.com");
    expect(disposable?.verdict.status).toBe("Disposable");
    expect(disposable?.verdict.reason).toContain("mailinator.com");
  });

  it("says nothing is importable when the file is empty", () => {
    const empty = auditRows([], mapping);
    expect(empty.total).toBe(0);
    expect(empty.importable).toBe(0);
  });
});
