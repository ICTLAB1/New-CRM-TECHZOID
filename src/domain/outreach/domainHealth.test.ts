import { describe, expect, it } from "vitest";
import { buildHealth, gradeDkim, gradeDmarc, gradeMx, gradeSpf, overallGrade, safeToSend } from "./domainHealth";

describe("SPF", () => {
  it("passes a strict Microsoft 365 record", () => {
    const c = gradeSpf(["v=spf1 include:spf.protection.outlook.com -all"]);
    expect(c.grade).toBe("pass");
    expect(c.action).toBe("");
  });

  it("passes a soft fail, and says what stricter would look like", () => {
    const c = gradeSpf(["v=spf1 include:spf.protection.outlook.com ~all"]);
    expect(c.grade).toBe("pass");
    expect(c.action).toContain("-all");
  });

  /* RFC 7208: two SPF records is a PERMANENT ERROR and receivers fail the
     check outright — so adding a second one "for another sender" silently
     breaks the first. Worse than having none, and graded that way. */
  it("fails two records, which is worse than none", () => {
    const c = gradeSpf(["v=spf1 include:a -all", "v=spf1 include:b -all"]);
    expect(c.grade).toBe("fail");
    expect(c.summary).toContain("only one");
  });

  it("warns when the record lets anyone send", () => {
    for (const rec of ["v=spf1 include:x +all", "v=spf1 include:x ?all"]) {
      expect(gradeSpf([rec]).grade, rec).toBe("warn");
    }
  });

  it("warns when there is no all mechanism at all", () => {
    expect(gradeSpf(["v=spf1 include:spf.protection.outlook.com"]).grade).toBe("warn");
  });

  it("fails when missing, and gives the record to publish", () => {
    const c = gradeSpf(["some-unrelated-txt-record"]);
    expect(c.grade).toBe("fail");
    expect(c.action).toContain("spf.protection.outlook.com");
  });
});

describe("DKIM", () => {
  it("passes when both Microsoft selectors are published", () => {
    expect(gradeDkim({ selector1: "selector1-x._domainkey.tz.onmicrosoft.com", selector2: "selector2-x._domainkey.tz.onmicrosoft.com" }).grade).toBe("pass");
  });

  /* Microsoft ALTERNATES between the two selectors when rotating keys, so a
     missing second one is not cosmetic — mail signed with it fails
     verification. Warn, and say why. */
  it("warns on a half-published pair and explains the rotation", () => {
    const c = gradeDkim({ selector1: "selector1-x._domainkey.tz.onmicrosoft.com", selector2: null });
    expect(c.grade).toBe("warn");
    expect(c.summary).toContain("selector2");
    expect(c.action).toContain("rotates");
  });

  it("fails when nothing is signed", () => {
    const c = gradeDkim({ selector1: null, selector2: null });
    expect(c.grade).toBe("fail");
    expect(c.summary).toContain("not signed");
  });
});

describe("DMARC", () => {
  it("passes reject and quarantine", () => {
    expect(gradeDmarc(["v=DMARC1; p=reject; rua=mailto:d@x.in"]).grade).toBe("pass");
    expect(gradeDmarc(["v=DMARC1; p=quarantine; rua=mailto:d@x.in"]).grade).toBe("pass");
  });

  it("suggests reporting when there is none", () => {
    expect(gradeDmarc(["v=DMARC1; p=reject"]).action).toContain("rua=");
  });

  /* p=none is the CORRECT first step. Grading it fail would push somebody
     to jump straight to reject without reading the reports, which is how a
     company blocks its own invoices. */
  it("treats monitoring mode as a warning and endorses it as a starting point", () => {
    const c = gradeDmarc(["v=DMARC1; p=none; rua=mailto:d@x.in"]);
    expect(c.grade).toBe("warn");
    expect(c.action).toContain("right place to start");
  });

  it("fails when missing", () => {
    expect(gradeDmarc([]).grade).toBe("fail");
  });

  it("is not fooled by a record that merely mentions DMARC", () => {
    expect(gradeDmarc(["this domain uses v=DMARC1 somewhere in the middle"]).grade).toBe("fail");
  });
});

describe("MX", () => {
  it("passes when mail servers exist", () => {
    expect(gradeMx(["techzoid-in.mail.protection.outlook.com"]).grade).toBe("pass");
  });

  it("fails when nobody could reply", () => {
    const c = gradeMx([]);
    expect(c.grade).toBe("fail");
    expect(c.action).toContain("reply");
  });
});

describe("the overall verdict", () => {
  const ok = { spfTxt: ["v=spf1 include:spf.protection.outlook.com -all"],
               dkim: { selector1: "a", selector2: "b" },
               dmarcTxt: ["v=DMARC1; p=reject; rua=mailto:d@x.in"],
               mx: ["mx.outlook.com"] };

  it("reports a fully configured domain as safe", () => {
    const h = buildHealth("techzoid.in", ok);
    expect(h.overall).toBe("pass");
    expect(h.safeToSend).toBe(true);
  });

  it("takes the worst of the four", () => {
    expect(overallGrade([{ grade: "pass" }, { grade: "warn" }] as never)).toBe("warn");
    expect(overallGrade([{ grade: "warn" }, { grade: "fail" }] as never)).toBe("fail");
    expect(overallGrade([{ grade: "pass" }, { grade: "pass" }] as never)).toBe("pass");
  });

  /* A domain with good SPF and DKIM authenticates properly even with no
     DMARC — blocking it would be officious and would stop legitimate mail. */
  it("still lets a domain send when only DMARC is missing", () => {
    const h = buildHealth("techzoid.ae", { ...ok, dmarcTxt: [] });
    expect(h.overall).toBe("fail");        // the badge is honest
    expect(h.safeToSend).toBe(true);       // but it is not blocked
  });

  /* Sending unauthenticated mail in volume damages the domain for every
     ordinary quotation afterwards, not just the campaign. */
  it("refuses to send from a domain that cannot authenticate", () => {
    expect(safeToSend(buildHealth("x.in", { ...ok, spfTxt: [] }))).toBe(false);
    expect(safeToSend(buildHealth("x.in", { ...ok, dkim: { selector1: null, selector2: null } }))).toBe(false);
    expect(safeToSend(buildHealth("x.in", { ...ok, mx: [] }))).toBe(false);
  });

  it("carries every record it found, so an admin can see the evidence", () => {
    const h = buildHealth("techzoid.in", ok);
    expect(h.spf.found).toContain("spf.protection.outlook.com");
    expect(h.dmarc.found).toContain("p=reject");
    expect(h.mx.found).toContain("mx.outlook.com");
  });
});
