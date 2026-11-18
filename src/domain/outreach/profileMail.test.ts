import { describe, expect, it } from "vitest";
import {
  CHUNK, PROFILE_BODY, PROFILE_SUBJECT, chunk, greetingLine, messageFor, messagesFor,
  recipientsFromCustomers, recipientsFromPaste, type ProfileDraft,
} from "./profileMail";

/**
 * What is being asserted here is the promise the feature makes: thirty
 * customers get thirty emails that each read as though they were written to
 * that person. So the tests are mostly about the greeting, the variables and
 * the duplicates — the three ways a mailshot gives itself away.
 */

const SENDER = {
  name: "Abhinav Jain",
  company: "TechZoid Technologies",
  email: "abhinav@techzoid.example",
  phone: "+91 98100 00000",
  designation: "Managing Director",
};

const DRAFT: ProfileDraft = {
  subject: PROFILE_SUBJECT,
  body: PROFILE_BODY,
  sender: { name: SENDER.name, email: SENDER.email },
  company: { name: SENDER.company, website: "techzoidtechnologies.com" },
  attachmentName: "TechZoid-Company-Profile.pdf",
};

const customer = (over: Record<string, string>) => ({
  id: "c1", company: "Acme Industries", contact: "Ravi Sharma",
  designation: "IT Manager", email: "ravi@acme.example", ...over,
});

describe("the greeting, which is what gives a mail merge away", () => {
  it("uses the person when we know them", () => {
    expect(greetingLine({ first_name: "Ravi", company_name: "Acme Industries" })).toBe("Dear Ravi,");
  });

  it("falls back to the company when we only know that", () => {
    expect(greetingLine({ company_name: "Acme Industries" })).toBe("Dear Acme Industries,");
  });

  it("greets with no name at all rather than with an empty one", () => {
    // "Dear ," is the single clearest sign that nobody checked.
    expect(greetingLine({})).toBe("Hello,");
    expect(greetingLine({ first_name: "   " })).toBe("Hello,");
  });

  it("never says Dear Sir/Madam or Dear Customer", () => {
    for (const values of [{}, { first_name: "Ravi" }, { company_name: "Acme" }]) {
      expect(greetingLine(values)).not.toMatch(/sir|madam|customer/i);
    }
  });

  it("takes an offered fallback only when there is nothing better", () => {
    expect(greetingLine({}, "there")).toBe("Dear there,");
    expect(greetingLine({ first_name: "Ravi" }, "there")).toBe("Dear Ravi,");
  });
});

describe("one message, for one person", () => {
  const [ravi] = recipientsFromCustomers([customer({})], SENDER).recipients;

  it("puts their name in the greeting and the company in the subject", () => {
    const msg = messageFor(DRAFT, ravi!);
    expect(msg.subject).toBe("TechZoid Technologies — company profile");
    expect(msg.message).toContain("Dear Ravi,");
    expect(msg.html).toContain("Dear Ravi,");
  });

  it("names the attachment, so the closing line matches what arrives", () => {
    const msg = messageFor(DRAFT, ravi!);
    expect(msg.message).toContain("TechZoid-Company-Profile.pdf");
  });

  it("carries the sender's signature, and no job title in it", () => {
    const msg = messageFor(DRAFT, ravi!);
    expect(msg.html).toContain("Abhinav Jain");
    /* The designation is off — see EmailSender in emailTemplate.ts. It is
       still a team member's own field and still prints on the campaign
       signature; it does not print here. */
    expect(msg.html).not.toContain("Managing Director");
    expect(msg.message).not.toContain("Managing Director");
  });

  it("does NOT say a machine sent it", () => {
    /* The automated-message line belongs on follow-ups a scheduler sends.
       On this it would be a lie, and it would undo the one thing the
       feature is for. */
    const msg = messageFor(DRAFT, ravi!);
    expect(msg.message).not.toMatch(/automat|system.generated|do not reply/i);
    expect(msg.html).not.toMatch(/automat|system.generated/i);
  });

  it("sends the same words in text and in HTML", () => {
    const msg = messageFor(DRAFT, ravi!);
    for (const sentence of PROFILE_BODY.split("\n\n")) {
      const start = sentence.slice(0, 40);
      expect(msg.message).toContain(start);
      expect(msg.html).toContain(start.replace(/&/g, "&amp;"));
    }
  });

  it("leaves an unfilled variable visible rather than blanking it", () => {
    /* A SHARED INBOX, deliberately: a record with no contact name now takes
       one from the address, so `ravi@…` would fill the variable and this
       would stop testing anything. `sales@` is the case where there really
       is no name to be had. */
    const nameless = recipientsFromCustomers(
      [customer({ contact: "", company: "", email: "sales@acme.example" })], SENDER,
    ).recipients[0]!;
    const msg = messageFor({ ...DRAFT, body: "Hello {{first_name}}, a note." }, nameless);
    expect(msg.message).toContain("{{first_name}}");
    expect(msg.missing).toContain("first_name");
  });
});

describe("turning chosen customers into recipients", () => {
  it("keeps everyone who has an email address", () => {
    const { recipients, skipped } = recipientsFromCustomers(
      [customer({ id: "a", email: "ravi@acme.example" }),
       customer({ id: "b", email: "priya@beta.example", company: "Beta Ltd", contact: "Priya Nair" })],
      SENDER,
    );
    expect(recipients.map((r) => r.email)).toEqual(["ravi@acme.example", "priya@beta.example"]);
    expect(skipped).toEqual([]);
  });

  it("REPORTS a customer with no email instead of dropping them", () => {
    // Sending to 26 of 30 and saying "sent" is the failure this prevents.
    const { recipients, skipped } = recipientsFromCustomers(
      [customer({ id: "a" }), customer({ id: "b", email: "", company: "No Mail Ltd" })],
      SENDER,
    );
    expect(recipients).toHaveLength(1);
    expect(skipped).toEqual([{ label: "No Mail Ltd", reason: "no-email" }]);
  });

  it("writes to one address once, however many records hold it", () => {
    const { recipients, skipped } = recipientsFromCustomers(
      [customer({ id: "a" }), customer({ id: "b", company: "Acme Industries Pvt" })],
      SENDER,
    );
    expect(recipients).toHaveLength(1);
    expect(skipped[0]).toEqual({ label: "Acme Industries Pvt", reason: "duplicate" });
  });

  it("matches an address whatever case it was typed in", () => {
    const { recipients } = recipientsFromCustomers(
      [customer({ id: "a", email: "Ravi@Acme.Example" }), customer({ id: "b", email: "ravi@acme.example" })],
      SENDER,
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0]!.email).toBe("ravi@acme.example");
  });

  it("does not greet somebody by their honorific", () => {
    const r = recipientsFromCustomers([customer({ contact: "Mr Sharma" })], SENDER).recipients[0]!;
    expect(greetingLine(r.values)).toBe("Dear Mr Sharma,");
  });

  it("keeps the customer id, so the log can say who was written to", () => {
    const r = recipientsFromCustomers([customer({ id: "cust-7" })], SENDER).recipients[0]!;
    expect(r.customerId).toBe("cust-7");
  });
});

describe("thirty addresses out of the clipboard", () => {
  it("reads a column pasted from a spreadsheet", () => {
    const { recipients } = recipientsFromPaste(
      "ravi@acme.example\npriya@beta.example\nsunil@gamma.example", SENDER,
    );
    expect(recipients.map((r) => r.email))
      .toEqual(["ravi@acme.example", "priya@beta.example", "sunil@gamma.example"]);
  });

  it("reads an Outlook To: line, names and all", () => {
    const { recipients } = recipientsFromPaste(
      'Ravi Sharma <ravi@acme.example>; "Nair, Priya" <priya@beta.example>', SENDER,
    );
    expect(recipients).toHaveLength(2);
    expect(greetingLine(recipients[0]!.values)).toBe("Dear Ravi,");
    expect(greetingLine(recipients[1]!.values)).toBe("Dear Priya,");
  });

  it("will not send twice to somebody already on the list", () => {
    const { recipients, skipped } = recipientsFromPaste(
      "ravi@acme.example, new@delta.example", SENDER, ["ravi@acme.example"],
    );
    expect(recipients.map((r) => r.email)).toEqual(["new@delta.example"]);
    expect(skipped[0]!.reason).toBe("duplicate");
  });

  it("hands back what it could not read rather than swallowing it", () => {
    const { recipients, unreadable } = recipientsFromPaste(
      "ravi@acme.example\nask the front desk\n", SENDER,
    );
    expect(recipients).toHaveLength(1);
    expect(unreadable).toContain("ask the front desk");
  });

  it("does NOT greet a SHARED INBOX by the name in its address", () => {
    /* Found by sending to a real list: ops@kappa.example arrived as "Dear
       Ops," and mail@mu.example as "Dear Mu,". Both were failures of the
       guess, not of the idea — "ops" was simply missing from the role list
       and "mu" is two letters. A greeting with nothing in it is honest;
       one addressed to a department is not. */
    const { recipients } = recipientsFromPaste("ops@kappa.example\nmail@mu.example", SENDER);
    expect(greetingLine(recipients[0]!.values)).toBe("Hello,");
    expect(greetingLine(recipients[1]!.values)).toBe("Hello,");
    /* And nothing invented reaches the email itself. */
    const msg = messageFor(DRAFT, recipients[0]!);
    expect(msg.message).not.toMatch(/Dear Ops|Dear Kappa/i);
  });

  it("DOES greet a bare address when the address carries a real name", () => {
    /* The whole point of one message per person. A pasted list of bare
       addresses is the ordinary case, and "Hello," to every one of them
       throws away a name that is sitting right there. */
    const { recipients } = recipientsFromPaste(
      "shivdatta@giriinfotech.example\nravi.sharma@acme.example", SENDER,
    );
    expect(greetingLine(recipients[0]!.values)).toBe("Dear Shivdatta,");
    expect(greetingLine(recipients[1]!.values)).toBe("Dear Ravi,");
    expect(messageFor(DRAFT, recipients[0]!).message).toContain("Dear Shivdatta,");
  });

  it("keeps the guessed COMPANY out of the greeting", () => {
    /* A domain is a weaker signal than a local part: "Dear Giriinfotech,"
       is worse than the name the address already gave us, and worse than
       "Hello," when it gave us none. */
    const { recipients } = recipientsFromPaste("ops@giriinfotech.example", SENDER);
    expect(greetingLine(recipients[0]!.values)).toBe("Hello,");
  });

  it("still uses a name somebody actually typed", () => {
    const { recipients } = recipientsFromPaste("Lakshmi Menon <lakshmi@lambda.example>", SENDER);
    expect(greetingLine(recipients[0]!.values)).toBe("Dear Lakshmi,");
  });

  it("keeps a derived company as a label, where a guess is harmless", () => {
    /* On screen it only has to tell two rows apart. */
    const { recipients } = recipientsFromPaste("ops@kappa.example", SENDER);
    expect(recipients[0]!.label).toBe("Kappa");
  });

  it("handles a real thirty-address paste", () => {
    const list = Array.from({ length: 30 }, (_, i) => `buyer${i}@company${i}.example`).join(", ");
    const { recipients } = recipientsFromPaste(list, SENDER);
    expect(recipients).toHaveLength(30);
    expect(new Set(recipients.map((r) => r.email)).size).toBe(30);
  });
});

describe("sending a long list in pieces", () => {
  it("splits thirty into five requests of six", () => {
    const list = Array.from({ length: 30 }, (_, i) => i);
    const parts = chunk(list);
    expect(parts).toHaveLength(5);
    expect(parts.every((p) => p.length === CHUNK)).toBe(true);
    expect(parts.flat()).toEqual(list);
  });

  it("leaves a short last piece rather than padding it", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7]).map((p) => p.length)).toEqual([6, 1]);
    expect(chunk([])).toEqual([]);
  });

  it("builds one message per recipient and loses none of them", () => {
    const { recipients } = recipientsFromPaste(
      Array.from({ length: 30 }, (_, i) => `b${i}@c${i}.example`).join("\n"), SENDER,
    );
    const messages = messagesFor(DRAFT, recipients);
    expect(messages).toHaveLength(30);
    expect(new Set(messages.map((m) => m.email)).size).toBe(30);
    /* Each one addressed to exactly one person: the subject and body carry
       no other recipient's address. */
    for (const m of messages) {
      const others = messages.filter((o) => o.email !== m.email).map((o) => o.email);
      for (const other of others) expect(m.html).not.toContain(other);
    }
  });
});

describe("a customer record with no contact name", () => {
  /**
   * WHAT THE FEATURE IS FOR. A message addressed to a company is a
   * circular wearing a greeting, and the reader can tell. The address
   * usually knows the name the record is missing.
   */
  const only = (c: Record<string, unknown>) =>
    recipientsFromCustomers([{ id: "c1", ...c } as never], { name: "A", company: "T" }).recipients[0]!;

  it("takes the name from the address", () => {
    const r = only({ email: "shivdatta@giriinfotech.com", company: "Giri Infotech Pvt Ltd" });
    expect(greetingLine(r.values)).toBe("Dear Shivdatta,");
  });

  it("splits firstname.lastname", () => {
    expect(greetingLine(only({ email: "ravi.sharma@acme.co.in" }).values)).toBe("Dear Ravi,");
  });

  it("NEVER GREETS A SHARED INBOX BY NAME", () => {
    /* "Dear Sales," is worse than no name at all. These fall through to
       the company, exactly as before. */
    for (const email of ["sales@acme.co.in", "info@acme.co.in", "accounts@acme.co.in", "purchase@acme.co.in"]) {
      const r = only({ email, company: "Acme Industries" });
      expect(greetingLine(r.values), email).toBe("Dear Acme Industries,");
    }
  });

  it("refuses a guess that is not a name", () => {
    /* Digits, initials and vowel-less local parts are account numbers and
       abbreviations, not people. */
    for (const email of ["ap2024@acme.co.in", "k@acme.co.in", "mkt@acme.co.in"]) {
      const r = only({ email, company: "Acme Industries" });
      expect(greetingLine(r.values), email).toBe("Dear Acme Industries,");
    }
  });

  it("leaves a record that HAS a contact name alone", () => {
    const r = only({ email: "shivdatta@giriinfotech.com", contact: "Shiv Dutta", company: "Giri Infotech" });
    /* The record's own name wins, and the greeting uses the first name of
       it — which is what it has always done for a named contact. */
    expect(greetingLine(r.values)).toBe("Dear Shiv,");
  });

  it("still falls back to the company when the address offers nothing", () => {
    expect(greetingLine(only({ email: "sales@acme.co.in", company: "Acme Industries" }).values))
      .toBe("Dear Acme Industries,");
  });
});

