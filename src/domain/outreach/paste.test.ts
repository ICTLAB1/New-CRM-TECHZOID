import { describe, expect, it } from "vitest";
import {
  companyFromEmail, enrichFromAddress, firstNameFromEmail, parsePastedList,
  pasteSummary, readFragment, splitFragments, splitName,
} from "./paste";

const emails = (text: string) => parsePastedList(text).people.map((p) => p.email);

describe("reading a pasted list of addresses", () => {
  it("reads one address per line", () => {
    expect(emails("ravi@acme.example\npriya@beta.example"))
      .toEqual(["ravi@acme.example", "priya@beta.example"]);
  });

  it("reads a comma-separated line", () => {
    expect(emails("ravi@acme.example, priya@beta.example, arun@gamma.example"))
      .toEqual(["ravi@acme.example", "priya@beta.example", "arun@gamma.example"]);
  });

  it("reads semicolons, which is what Outlook produces", () => {
    expect(emails("ravi@acme.example; priya@beta.example"))
      .toEqual(["ravi@acme.example", "priya@beta.example"]);
  });

  it("reads a column dragged out of Excel", () => {
    expect(emails("ravi@acme.example\r\npriya@beta.example\r\n"))
      .toEqual(["ravi@acme.example", "priya@beta.example"]);
  });

  /* The single most common paste: the To: line of a mail client. */
  it("reads the display-name form and keeps the name", () => {
    const [p] = parsePastedList("Ravi Sharma <ravi@acme.example>").people;
    expect(p).toMatchObject({
      email: "ravi@acme.example", firstName: "Ravi", lastName: "Sharma", fullName: "Ravi Sharma",
    });
  });

  /* Splitting this on the comma makes two people, one of them nonsense. */
  it("does not split a quoted name that contains a comma", () => {
    const out = parsePastedList('"Sharma, Ravi" <ravi@acme.example>').people;
    expect(out).toHaveLength(1);
    expect(out[0]!.email).toBe("ravi@acme.example");
  });

  /* Surname-first is Outlook's default in a lot of corporate directories.
     Getting it backwards produces "Hello Sharma," in a stranger's inbox. */
  it("understands surname-first, so the greeting is not the surname", () => {
    expect(splitName("Sharma, Ravi")).toEqual({
      firstName: "Ravi", lastName: "Sharma", fullName: "Ravi Sharma",
    });
  });

  it("does not split several bracketed people on their internal commas", () => {
    const out = parsePastedList('Ravi Sharma <ravi@acme.example>, "Menon, Priya" <priya@beta.example>');
    expect(out.people.map((p) => p.email)).toEqual(["ravi@acme.example", "priya@beta.example"]);
    expect(out.people[1]!.firstName).toBe("Priya");
  });

  it("handles a mixture of forms in one paste", () => {
    expect(emails('ravi@acme.example\nPriya Menon <priya@beta.example>; arun@gamma.example'))
      .toEqual(["ravi@acme.example", "priya@beta.example", "arun@gamma.example"]);
  });

  it("strips a mailto: prefix rather than treating it as a name", () => {
    const [p] = parsePastedList("mailto:ravi@acme.example").people;
    expect(p!.email).toBe("ravi@acme.example");
    expect(p!.firstName).toBe("");
  });

  it("ignores the bullets and numbering of a pasted list", () => {
    const out = parsePastedList("1. Ravi Sharma <ravi@acme.example>\n- priya@beta.example\n• arun@gamma.example");
    expect(out.people.map((p) => p.email))
      .toEqual(["ravi@acme.example", "priya@beta.example", "arun@gamma.example"]);
    expect(out.people[0]!.firstName).toBe("Ravi");
  });

  it("drops a trailing full stop from a sentence", () => {
    expect(emails("Write to ravi@acme.example.")).toEqual(["ravi@acme.example"]);
  });

  /* A paste that quietly loses four addresses out of forty is a campaign
     that quietly misses four companies. */
  it("reports what it could not read rather than swallowing it", () => {
    const out = parsePastedList("ravi@acme.example\nnot an address at all\npriya@beta.example");
    expect(out.people).toHaveLength(2);
    expect(out.unreadable).toEqual(["not an address at all"]);
  });

  it("does not report punctuation as a lost address", () => {
    expect(parsePastedList("ravi@acme.example\n---\n•\npriya@beta.example").unreadable).toEqual([]);
  });

  it("collapses a repeat and says so", () => {
    const out = parsePastedList("ravi@acme.example\nRavi Sharma <RAVI@ACME.example>\npriya@beta.example");
    expect(out.people.map((p) => p.email)).toEqual(["ravi@acme.example", "priya@beta.example"]);
    expect(out.duplicates).toHaveLength(1);
  });

  it("keeps the first occurrence, which is the one likelier to carry a name", () => {
    const out = parsePastedList("Ravi Sharma <ravi@acme.example>\nravi@acme.example");
    expect(out.people[0]!.firstName).toBe("Ravi");
  });

  it("copes with an empty paste", () => {
    expect(parsePastedList("")).toEqual({ people: [], unreadable: [], duplicates: [] });
    expect(parsePastedList("   \n\n  ").people).toEqual([]);
  });

  it("classifies each address as it goes, so the count can be honest", () => {
    const out = parsePastedList("ravi@acme.example\nmeera@mailinator.com\nnonsense@\nprocurement@acme.example");
    const summary = pasteSummary(out);
    /* nonsense@ has no dot-suffix so it never reads as an address at all. */
    expect(summary.total).toBe(3);
    expect(summary.usable).toBe(2);      // ravi + procurement (role addresses stay eligible)
    expect(summary.rejected).toBe(1);    // the disposable one
    expect(out.unreadable).toEqual(["nonsense@"]);
  });

  it("counts how many arrived with a name, so the template gap is visible", () => {
    const out = parsePastedList("Ravi Sharma <ravi@acme.example>\npriya@beta.example");
    expect(pasteSummary(out).named).toBe(1);
  });
});

describe("the pieces", () => {
  it("splits on every separator a clipboard produces", () => {
    expect(splitFragments("a\nb,c;d\te|f")).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("suspends the separators inside angle brackets", () => {
    expect(splitFragments("X <a,b@c.example>")).toEqual(["X <a,b@c.example>"]);
  });

  it("returns nothing for a fragment with no address", () => {
    expect(readFragment("just some words")).toBeNull();
    expect(readFragment("")).toBeNull();
  });

  it("reads a bare name with no address as nothing, not as an address", () => {
    expect(readFragment("Ravi Sharma")).toBeNull();
  });
});

describe("what a bare address still tells you", () => {
  /* Without this, a pasted list cannot use any template that mentions the
     recipient's company — which is most of them — and every recipient is
     held back for missing data. */
  it("takes the company from the domain", () => {
    expect(companyFromEmail("ravi@acme.example")).toBe("Acme");
    expect(companyFromEmail("ravi@techzoidtechnologies.com")).toBe("Techzoidtechnologies");
  });

  it("treats a hyphen in the domain as a word break", () => {
    expect(companyFromEmail("a@blue-star.com")).toBe("Blue Star");
  });

  it("looks past a two-part suffix", () => {
    expect(companyFromEmail("a@acme.co.in")).toBe("Acme");
    expect(companyFromEmail("a@acme.co.uk")).toBe("Acme");
    expect(companyFromEmail("a@acme.com.au")).toBe("Acme");
  });

  /* "Hello Ravi at Gmail" is the sort of thing that gets a sender reported. */
  it("derives nothing from a free-mail address", () => {
    for (const d of ["gmail.com", "yahoo.co.in", "rediffmail.com", "outlook.com", "hotmail.com"]) {
      expect(companyFromEmail(`ravi@${d}`), d).toBe("");
    }
  });

  it("derives nothing from a domain too short to be a name", () => {
    expect(companyFromEmail("a@x.io")).toBe("");
    expect(companyFromEmail("not-an-address")).toBe("");
  });

  it("guesses a first name from the local part", () => {
    expect(firstNameFromEmail("ravi@acme.example")).toBe("Ravi");
    expect(firstNameFromEmail("priya.menon@acme.example")).toBe("Priya");
    expect(firstNameFromEmail("arun_kumar@acme.example")).toBe("Arun");
  });

  /* "Hello Procurement," is worse than no greeting at all. */
  it("never greets a shared inbox by its name", () => {
    for (const role of ["procurement", "info", "sales", "it", "accounts", "hr"]) {
      expect(firstNameFromEmail(`${role}@acme.example`), role).toBe("");
    }
  });

  it("declines anything that does not read as a name", () => {
    expect(firstNameFromEmail("r@acme.example")).toBe("");        // an initial
    expect(firstNameFromEmail("user123@acme.example")).toBe("");  // an account number
    expect(firstNameFromEmail("bcdfg@acme.example")).toBe("");    // no vowel at all
  });

  /* Y counts as a vowel, and it has to: Shyam, Jyoti, Vyas and Krishnan are
     all real first names that a stricter check would refuse to greet. */
  it("greets a name whose only vowel is a y", () => {
    expect(firstNameFromEmail("shyam@acme.example")).toBe("Shyam");
    expect(firstNameFromEmail("jyoti.rao@acme.example")).toBe("Jyoti");
  });

  it("fills in what is missing and says what it inferred", () => {
    const [bare] = parsePastedList("priya@betatech.example").people;
    const out = enrichFromAddress(bare!);
    expect(out).toMatchObject({ firstName: "Priya", company: "Betatech" });
    expect(out.derived).toEqual(["first name", "company"]);
  });

  it("leaves a name that was actually given alone", () => {
    const [given] = parsePastedList("Ravinder Sharma <r.sharma@acme.example>").people;
    const out = enrichFromAddress(given!);
    expect(out.firstName).toBe("Ravinder");
    expect(out.derived).toEqual(["company"]);
  });

  it("infers nothing it cannot stand behind", () => {
    const [p] = parsePastedList("procurement@gmail.com").people;
    const out = enrichFromAddress(p!);
    expect(out.firstName).toBe("");
    expect(out.company).toBe("");
    expect(out.derived).toEqual([]);
  });
});
