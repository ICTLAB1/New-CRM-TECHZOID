import { buildEmailHtml, buildEmailText, type EmailCompany, type EmailSender } from "../integrations/emailTemplate";
import { fill, valuesFor, type Values } from "./personalise";
import { enrichFromAddress, parsePastedList } from "./paste";

/**
 * Sending the company profile to a list of people, one message each.
 *
 * THE POINT OF THE WHOLE FEATURE is in one line of the sender
 * (netlify/functions/profile-send.mjs): every recipient gets their own
 * message with their own address alone in To. No cc, no bcc, no shared
 * thread. Thirty customers means thirty emails, each of which reads — and
 * is, in its headers — a mail written to that person. This module builds
 * those thirty messages.
 *
 * NOTHING HERE IS NEW MACHINERY. The variables and the "never send with a
 * hole in it" rule are personalise.ts, written for campaigns; the pasted
 * address parser is paste.ts; the markup is the transactional template the
 * quotation emails already use, so a customer who has had a quotation from
 * us gets the profile on the same letterhead rather than something that
 * looks like it came from a different company. What is new is the wording,
 * the recipient-by-recipient assembly, and the greeting rule below.
 *
 * WHY THE BROWSER RENDERS AND THE SERVER ONLY SENDS. Same reason
 * outreach-launch.mjs renders up front: what was sent to a given person has
 * to be a fact, not something re-derived later from a template somebody has
 * since edited. It also means the preview on screen is the message, not an
 * impression of it.
 */

/** The pre-written professional email. Editable on the screen before it
 *  goes; this is the starting point, not a constraint. */
export const PROFILE_SUBJECT = "{{sender_company}} — company profile";

/**
 * The body.
 *
 * Written to be what somebody would actually type: short, specific about
 * what is attached and what we do, and ending with a question that is easy
 * to ignore. No urgency, no claims about savings we cannot stand behind, no
 * "Dear Sir/Madam" — the same rules templates.ts sets out for cold mail,
 * which apply with more force to a customer who already knows us.
 *
 * The greeting line is NOT in here: greetingLine() builds it per recipient,
 * because the right answer depends on what we know about them.
 */
export const PROFILE_BODY = [
  "I thought it would be useful to have our company profile on file — it is attached.",
  "It covers what we supply and who we do it for: Microsoft, Adobe and Autodesk licensing, renewals and deployment, with the certifications and registration details your purchase team usually asks for.",
  "If you would like a quotation for anything in particular, or a renewal checked against your current terms, reply to this email and I will put it together.",
].join("\n\n");

export interface ProfileRecipient {
  /** The customer this goes to, when it is one of ours. Empty for a pasted
   *  address — which is how the profile reaches somebody not in the CRM. */
  customerId: string;
  email: string;
  /** Shown in the list on screen and stored on the log row. */
  label: string;
  values: Values;
}

/** Why an intended recipient cannot be sent to. Named, never a count: the
 *  screen lists who and why so the data can be fixed. */
export interface SkippedRecipient {
  label: string;
  reason: "no-email" | "duplicate";
}

const clean = (v: unknown): string => String(v ?? "").trim();

/**
 * The greeting, which is the line that decides whether this reads as a
 * personal email or as a mail merge.
 *
 * "Dear Ravi," when we know the person. "Dear Acme Industries," when we
 * only know the company — stilted, but true, and better than inventing a
 * name. "Hello," on its own when we know neither: a greeting with nothing
 * in it is still a greeting, where "Dear ," is a mistake the reader can see.
 *
 * NEVER "Dear Sir/Madam" and never "Dear Customer". Both announce that the
 * sender did not know who they were writing to.
 */
export function greetingLine(values: Values, fallbackName = ""): string {
  const person = clean(values.first_name) || clean(values.full_name);
  const company = clean(values.company_name);
  const name = person || company || clean(fallbackName);
  return name ? `Dear ${name},` : "Hello,";
}

/**
 * One finished message, ready for the transport.
 *
 * `message` is the plain-text alternative and `html` the designed version;
 * both are built from the same inputs so they cannot say different things.
 */
export interface ProfileMessage {
  customerId: string;
  email: string;
  label: string;
  subject: string;
  message: string;
  html: string;
  /** Variables the wording asked for and this recipient did not have. The
   *  screen shows these before anything is sent; a message with one is
   *  still sendable, because the token is left visible rather than silently
   *  blanked, and a person can see it in the preview. */
  missing: string[];
}

export interface ProfileDraft {
  subject: string;
  body: string;
  sender: EmailSender;
  company: EmailCompany;
  /** What the customer sees the attachment called. Named in the closing
   *  line of the template, so it must match what actually attaches. */
  attachmentName: string;
  /** Used in the greeting when we know neither a person nor a company.
   *  Empty by default, which gives a bare "Hello,". */
  greetingFallback?: string;
}

/** Build the message for one recipient. Exported for its own test, and for
 *  the preview — the screen previews a real message rather than a mock-up. */
export function messageFor(draft: ProfileDraft, recipient: ProfileRecipient): ProfileMessage {
  const subject = fill(draft.subject, recipient.values);
  const body = fill(draft.body, recipient.values);

  /* The greeting is prepended rather than being part of the editable body,
     so that somebody rewording the email cannot accidentally delete the one
     line that makes it personal. */
  const content = {
    body: `${greetingLine(recipient.values, draft.greetingFallback)}\n\n${body.text.trim()}`,
    sender: draft.sender,
    company: draft.company,
    attachmentName: draft.attachmentName || null,
    quotation: null,
    /* DELIBERATELY NOT MARKED AUTOMATED. A person chose these recipients
       and pressed Send; the line that says a machine sent it would be
       untrue here, and it is the opposite of what this feature is for. */
  };

  return {
    customerId: recipient.customerId,
    email: recipient.email,
    label: recipient.label,
    subject: subject.text,
    message: buildEmailText(content),
    html: buildEmailHtml(content),
    missing: [...new Set([...subject.missing, ...body.missing])],
  };
}

/** Every message for a list, in the order the list was given. */
export const messagesFor = (
  draft: ProfileDraft,
  recipients: readonly ProfileRecipient[],
): ProfileMessage[] => recipients.map((r) => messageFor(draft, r));

/* ── who it goes to ──────────────────────────────────────────────────── */

export interface CustomerLike {
  id: string;
  company?: string;
  contact?: string;
  designation?: string;
  email?: string;
  city?: string;
  country?: string;
}

export interface SenderFields {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  designation?: string;
}

/** A person's first and last name out of one written name. Kept here rather
 *  than reaching into paste.ts's splitName for a customer record: a CRM
 *  contact is "Ravi Sharma", not "Sharma, Ravi" <...>, and the paste parser
 *  is built for the harder problem. */
function nameParts(contact: string): { first: string; last: string; full: string } {
  const full = clean(contact).replace(/\s+/g, " ");
  if (!full) return { first: "", last: "", full: "" };
  const bits = full.split(" ");
  /* An honorific is not a first name. "Mr Sharma" greeted as "Dear Mr" is
     worse than "Dear Mr Sharma". */
  const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "shri", "smt", "sri"]);
  const lead = (bits[0] ?? "").replace(/\./g, "").toLowerCase();
  const first = HONORIFICS.has(lead) && bits.length > 1 ? bits.slice(0, 2).join(" ") : bits[0] ?? "";
  return { first, last: bits.length > 1 ? bits[bits.length - 1]! : "", full };
}

/**
 * Turn chosen customers into recipients.
 *
 * A customer with no email address is NOT silently dropped: they come back
 * under `skipped`, by name, so the screen can say "four of these have no
 * email on file" and let somebody go and add them. Silently sending to 26
 * of 30 is the failure mode this exists to prevent.
 *
 * The same address twice — two customer records for one buyer, which every
 * CRM accumulates — is sent to ONCE. Receiving the same profile twice in a
 * minute from the same person is the clearest possible sign of a mail merge.
 */
export function recipientsFromCustomers(
  customers: readonly CustomerLike[],
  sender: SenderFields,
): { recipients: ProfileRecipient[]; skipped: SkippedRecipient[] } {
  const recipients: ProfileRecipient[] = [];
  const skipped: SkippedRecipient[] = [];
  const seen = new Set<string>();

  for (const c of customers) {
    const label = clean(c.company) || clean(c.contact) || clean(c.email) || "Unnamed customer";
    const email = clean(c.email).toLowerCase();
    if (!email) {
      skipped.push({ label, reason: "no-email" });
      continue;
    }
    if (seen.has(email)) {
      skipped.push({ label, reason: "duplicate" });
      continue;
    }
    seen.add(email);

    const parts = nameParts(clean(c.contact));
    recipients.push({
      customerId: c.id,
      email,
      label,
      values: valuesFor(
        {
          firstName: parts.first,
          lastName: parts.last,
          fullName: parts.full,
          jobTitle: clean(c.designation),
          company: clean(c.company),
          city: clean(c.city),
          country: clean(c.country),
        },
        sender,
      ),
    });
  }

  return { recipients, skipped };
}

/**
 * Turn a pasted blob of addresses into recipients.
 *
 * "even if I add 30 email ids at once" — this is that. It takes whatever
 * came out of the clipboard (see paste.ts for the shapes it reads) and adds
 * them alongside the chosen customers. `already` is every address already on
 * the list, so pasting a column that overlaps the customers picked above
 * does not send twice.
 */
export function recipientsFromPaste(
  text: string,
  sender: SenderFields,
  already: readonly string[] = [],
): { recipients: ProfileRecipient[]; skipped: SkippedRecipient[]; unreadable: string[] } {
  const parsed = parsePastedList(text);
  const seen = new Set(already.map((e) => clean(e).toLowerCase()));
  const recipients: ProfileRecipient[] = [];
  const skipped: SkippedRecipient[] = [];

  for (const raw of parsed.people) {
    const person = enrichFromAddress(raw);
    const email = clean(person.email).toLowerCase();
    if (!email) continue;
    if (seen.has(email)) {
      skipped.push({ label: person.fullName || email, reason: "duplicate" });
      continue;
    }
    seen.add(email);

    /* A GUESS IS NOT A GREETING, and this is the line that taught me so.
       enrichFromAddress fills in a first name and a company from the
       address itself, which is right for a campaign — those templates
       cannot run without them, and the screen discloses what was inferred.
       Here it reaches the customer as "Dear Ops," for ops@kappa.example and
       "Dear Mu," for mail@mu.example. Both are worse than "Hello,", which
       is what a greeting with nothing in it should be.

       So the greeting uses only what the PASTE itself carried — the name in
       "Lakshmi Menon <lakshmi@lambda.example>" is a real name somebody
       typed. `derived` says which fields were inferred, so this is exact
       rather than a heuristic about heuristics. The derived company is
       still good enough to tell two rows apart on screen, so the label
       keeps it. */
    const guessedName = person.derived.includes("first name");
    const guessedCompany = person.derived.includes("company");

    recipients.push({
      customerId: "",
      email,
      /* A typed name, else the company the domain implies, else the
         address. Never the name guessed from the local part: "Ops" looks
         like a person on screen and is not one. */
      label: (guessedName ? "" : person.fullName) || person.company || email,
      values: valuesFor(
        {
          firstName: guessedName ? "" : person.firstName,
          lastName: person.lastName,
          fullName: guessedName ? "" : person.fullName,
          company: guessedCompany ? "" : person.company ?? "",
        },
        sender,
      ),
    });
  }

  return { recipients, skipped, unreadable: parsed.unreadable };
}

/* ── sending it in pieces ────────────────────────────────────────────── */

/**
 * How many messages go in one request to the server.
 *
 * Each one is a round trip to Microsoft Graph, which takes the better part
 * of a second, and a function host will cut off a request that runs too
 * long — mid-list, with no way for the browser to know which of the last
 * few were sent. Six is comfortably inside every budget involved, and a
 * list of thirty is five requests with the count on screen moving after
 * each.
 */
export const CHUNK = 6;

export function chunk<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
