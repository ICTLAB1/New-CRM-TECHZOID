import { describe, expect, it } from "vitest";
import {
  applyMxResult, classifyLocally, domainOf, isDisposable, isEligible,
  isRoleAddress, localPartOf,
} from "./verify";

describe("what a local check can decide", () => {
  it("rejects a malformed address with something a person can act on", () => {
    const v = classifyLocally("ravi.acme.in");
    expect(v.status).toBe("Syntax Error");
    expect(v.eligible).toBe(false);
    expect(v.reason).toContain("missing @");
  });

  it("catches the spreadsheet classics", () => {
    for (const bad of ["", "  ", "ravi @acme.in", "ravi@", "@acme.in", "ravi@@acme.in", "ravi@acme..in", "ravi@acme.in."]) {
      expect(classifyLocally(bad).eligible, bad).toBe(false);
    }
  });

  it("rejects a domain with no dot in it", () => {
    const v = classifyLocally("ravi@acme");
    expect(v.status).toBe("Domain Invalid");
    expect(v.reason).toContain("not a full domain");
  });

  it("rejects a throwaway mailbox, and names the provider", () => {
    const v = classifyLocally("someone@mailinator.com");
    expect(v.status).toBe("Disposable");
    expect(v.eligible).toBe(false);
    expect(v.reason).toContain("mailinator.com");
  });

  it("never writes to an automated address", () => {
    for (const bad of ["noreply@acme.in", "no-reply@acme.in", "mailer-daemon@acme.in", "abuse@acme.in"]) {
      expect(classifyLocally(bad).eligible, bad).toBe(false);
    }
  });

  /* THE JUDGEMENT CALL, and it is specific to this business. Selling
     Microsoft and Autodesk licensing means the buyer is very often behind
     procurement@ or it@. Excluding role addresses by default would throw
     away the best contacts on the list. */
  it("keeps procurement@ and it@ — for licensing they are the buyer", () => {
    for (const good of ["procurement@acme.in", "purchase@acme.ae", "it@acme.com", "accounts@acme.in"]) {
      const v = classifyLocally(good);
      expect(v.status, good).toBe("Role-based");
      expect(v.eligible, good).toBe(true);
    }
  });

  it("warns that a shared inbox will not read a personal greeting", () => {
    expect(classifyLocally("info@acme.in").reason).toContain("shared inbox");
  });

  /* NO LOCAL CHECK EVER SAYS "Valid". Nothing short of asking the receiving
     server can confirm a mailbox exists, and a campaign that reports "842
     valid" when it means "842 not obviously broken" is lying to whoever
     presses Send. */
  it("never claims an address is Valid", () => {
    for (const e of ["ravi@acme.in", "r.menon@bigco.co.uk", "a+tag@sub.domain.ae"]) {
      const v = classifyLocally(e);
      expect(v.status, e).toBe("Unknown");
      expect(v.eligible, e).toBe(true);
      expect(v.needsProvider, e).toBe(true);
    }
  });

  it("accepts the shapes real B2B addresses actually take", () => {
    for (const e of [
      "ravi.menon@acme.co.in", "r_menon@acme-group.ae", "ravi+crm@acme.com",
      "RAVI@ACME.IN", "o'neill@acme.ie".replace("'", ""),
    ]) {
      expect(classifyLocally(e).eligible, e).toBe(true);
    }
  });
});

describe("what the MX lookup adds", () => {
  it("condemns a domain that cannot receive mail", () => {
    const v = applyMxResult(classifyLocally("ravi@acme.in"), false);
    expect(v.status).toBe("Domain Invalid");
    expect(v.reason).toContain("does not accept mail");
    expect(v.eligible).toBe(false);
  });

  it("leaves a good one as it was — still unconfirmed, not Valid", () => {
    expect(applyMxResult(classifyLocally("ravi@acme.in"), true).status).toBe("Unknown");
  });

  it("does not resurrect an address already ruled out", () => {
    const disposable = classifyLocally("x@mailinator.com");
    expect(applyMxResult(disposable, true).status).toBe("Disposable");
    const broken = classifyLocally("nonsense");
    expect(applyMxResult(broken, true).status).toBe("Syntax Error");
  });

  it("checks MX for a role address too", () => {
    expect(applyMxResult(classifyLocally("it@acme.in"), false).status).toBe("Domain Invalid");
  });
});

describe("the small helpers", () => {
  it("splits an address regardless of case and whitespace", () => {
    expect(localPartOf("  Ravi@Acme.IN ")).toBe("ravi");
    expect(domainOf("  Ravi@Acme.IN ")).toBe("acme.in");
  });

  it("answers the two questions a list filter asks", () => {
    expect(isRoleAddress("Procurement@Acme.in")).toBe(true);
    expect(isRoleAddress("ravi@acme.in")).toBe(false);
    expect(isDisposable("x@YOPMAIL.com")).toBe(true);
  });

  it("knows which statuses may enter a campaign", () => {
    expect(isEligible("Unknown")).toBe(true);
    expect(isEligible("Role-based")).toBe(true);
    expect(isEligible("Valid")).toBe(true);
    expect(isEligible("Disposable")).toBe(false);
    expect(isEligible("Syntax Error")).toBe(false);
    expect(isEligible("Mailbox Unreachable")).toBe(false);
  });
});
