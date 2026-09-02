import { describe, expect, it } from "vitest";
import { listOf, senderRows, senderTokensUsed } from "./SenderPanel";
import { buildAudience } from "../../domain/outreach/sending";
import { valuesFor } from "../../domain/outreach/personalise";

/**
 * The panel that answers "where do I enter the sender name".
 *
 * The interesting assertion is the last one: it checks that the warning the
 * panel shows is TRUE, rather than being alarming prose written into a JSX
 * file that nobody ever ran. A blank sender variable really does hold every
 * recipient back, and that is what makes the panel worth having.
 */

const SENDER = {
  name: "Abhinav Jain",
  email: "abhinav.jain@techzoidtechnologies.com",
  company: "TechZoid Technologies Private Limited",
  designation: "",
  phone: "",
};

describe("which sender variables a message uses", () => {
  it("finds them in the subject and the body", () => {
    const used = senderTokensUsed(
      "Software licensing for {{company_name}}",
      "I am {{sender_name}} from {{sender_company}}.",
    );
    expect([...used].sort()).toEqual(["sender_company", "sender_name"]);
  });

  it("ignores the recipient's own variables — those come from their row", () => {
    const used = senderTokensUsed("", "Hello {{first_name}} at {{company_name}}, {{job_title}}");
    expect(used.size).toBe(0);
  });

  it("tolerates spacing inside the braces", () => {
    expect(senderTokensUsed("", "{{ sender_phone }}").has("sender_phone")).toBe(true);
  });
});

describe("what each one will say", () => {
  it("shows the resolved value beside the token", () => {
    const rows = senderRows(SENDER);
    const byToken = Object.fromEntries(rows.map((r) => [r.token, r.value]));
    expect(byToken["sender_name"]).toBe("Abhinav Jain");
    expect(byToken["sender_company"]).toBe("TechZoid Technologies Private Limited");
    expect(byToken["sender_designation"]).toBe("");
  });

  it("names where a blank one is set, so nobody has to hunt for it", () => {
    /* The job title is the one that is set on this very screen, so it says
       so rather than sending somebody to Team and back. */
    const title = senderRows(SENDER).find((r) => r.token === "sender_designation");
    expect(title?.source).toMatch(/below/);
    const phone = senderRows(SENDER).find((r) => r.token === "sender_phone");
    expect(phone?.source).toMatch(/below/);
  });
});

describe("why a blank one matters", () => {
  /* The claim the panel makes in red. If this ever stops being true, the
     warning becomes a lie and this test is the thing that says so. */
  it("holds every recipient back rather than leaving a hole in the email", () => {
    const prospect = {
      firstName: "Ravi", lastName: "Sharma", email: "ravi@acme.example",
      company: "Acme Technologies", jobTitle: "IT Head",
    };
    const parts = {
      subject: "Licensing for {{company_name}}",
      body: "I'm {{sender_name}}, {{sender_designation}} at {{sender_company}}.",
    };
    const candidate = {
      id: "p1",
      email: prospect.email,
      values: valuesFor(prospect, SENDER),
      quarantined: false,
      verificationStatus: "Valid" as const,
    };

    const blank = buildAudience({ candidates: [candidate], parts, suppressed: new Set() });
    expect(blank.send).toHaveLength(0);
    expect(blank.excluded[0]?.reason).toBe("missing-data");
    expect(blank.excluded[0]?.missing).toContain("sender_designation");

    /* …and filling it in is all it takes. */
    const filled = buildAudience({
      candidates: [{ ...candidate, values: valuesFor(prospect, { ...SENDER, designation: "Managing Director" }) }],
      parts,
      suppressed: new Set(),
    });
    expect(filled.send).toHaveLength(1);
  });
});

describe("the sentence that lists what is blank", () => {
  it("reads as English rather than as an array", () => {
    expect(listOf(["{{a}}"])).toBe("{{a}}");
    expect(listOf(["{{a}}", "{{b}}"])).toBe("{{a}} and {{b}}");
    expect(listOf(["{{a}}", "{{b}}", "{{c}}"])).toBe("{{a}}, {{b}} and {{c}}");
    expect(listOf([])).toBe("");
  });
});


describe("whose phone number is under the name", () => {
  const COMPANY = "+91 11 4000 0000";

  /* The bug this fixes: settings.company.phone was the ONLY number either
     renderer could reach, so a purchase manager who rang the number under a
     salesperson's name got the switchboard. */
  it("uses the person's own mobile when they have set one", () => {
    const rows = senderRows({ ...SENDER, phone: "+91 98100 12345" }, COMPANY);
    const phone = rows.find((r) => r.token === "sender_phone");
    expect(phone?.value).toBe("+91 98100 12345");
    expect(phone?.label).toBe("Your mobile");
    expect(phone?.source).toBe("the box below");
  });

  it("says so when the number shown is the company's, not theirs", () => {
    /* The composer falls back before it reaches here, so the value IS the
       company number — and the panel must not let that pass as personal. */
    const rows = senderRows({ ...SENDER, phone: COMPANY }, COMPANY);
    const phone = rows.find((r) => r.token === "sender_phone");
    expect(phone?.source).toMatch(/Settings → Company/);
    expect(phone?.source).toMatch(/no mobile of your own/);
  });

  it("treats a blank as something to fill in here", () => {
    const phone = senderRows({ ...SENDER, phone: "" }, COMPANY).find((r) => r.token === "sender_phone");
    expect(phone?.value).toBe("");
    expect(phone?.source).toBe("the box below");
  });
});
