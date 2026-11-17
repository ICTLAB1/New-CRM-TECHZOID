import {
  buildEmailHtml, buildEmailText,
  type EmailCompany, type EmailProductGroup, type EmailSender,
} from "../integrations/emailTemplate";
import { CERTIFICATION_NAMES } from "../integrations/emailIdentity";
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
/**
 * The band across the top of the profile email.
 *
 * WHY THIS MAIL GETS ONE AND NO OTHER DOES. The profile mail introduces the
 * company — often to somebody who has never bought from us. A quotation
 * email does the opposite: it answers a question the customer asked, and a
 * marketing headline above that would be the company talking over them.
 *
 * It says what we do, not how well we do it. No superlatives, no numbers we
 * would have to stand behind, nothing a purchase manager could quote back
 * at us a year later.
 */
export const PROFILE_HERO = {
  eyebrow: "Software licensing solutions",
  headline: "Genuine software licensing, procurement and renewals",
  line: "Enterprise subscriptions, perpetual licensing and professional design applications "
    + "from the software publishers your teams already use.",
};

/**
 * The ask.
 *
 * ONE ASK, AND IT IS THE EASY ONE. The button opens a reply to the person
 * who sent the message — not a form, not a portal login, not a calendar.
 * This is a personal email from a named human, so the shortest path to what
 * we want is the reader pressing reply; anything that takes them out of
 * their inbox loses most of them on the way.
 *
 * No address to reply to means NO BUTTON. A button that goes nowhere is
 * worse than no button — the same rule as the logo that is dropped rather
 * than written as a path no mail client can resolve.
 */
export function profileCallToAction(senderEmail: string): {
  heading: string; lines: string[]; label: string; href: string;
} {
  /* THE SUBJECT IS THE CUSTOMER'S, NOT OURS. The first version put our own
     company name in it — which lands in the customer's sent items as
     "Software requirement — TechZoid Technologies Private Limited", a
     subject line about us on a mail they wrote. Their own company is not
     ours to fill in here either: the button is built once per draft and
     the recipient is not known until the message is assembled. Plain is
     right. */
  const subject = encodeURIComponent("Software requirement");
  return {
    heading: "Do you have any upcoming software requirements?",
    lines: [
      "Whether it is Microsoft 365 subscriptions, Office perpetual licensing, an Autodesk "
      + "renewal or Adobe Creative Cloud, we would be glad to help.",
      "Send the product names, the quantities and the term you need, and we will come back "
      + "with a suitable option and a price.",
    ],
    label: "Send us your requirement",
    href: senderEmail.trim() ? `mailto:${senderEmail.trim()}?subject=${subject}` : "",
  };
}

export const PROFILE_BODY = [
  "I thought it would be useful to have our company profile on file — it is attached.",
  /* WHAT WE SELL IS NO LONGER IN THIS PARAGRAPH. It is printed under the
     body as its own block, by vendor, with each line named — see
     domain/integrations/productLines.ts. A sentence here listing the same
     three vendors read as a preamble to the block directly beneath it, and
     the two would have drifted apart the first time a vendor was added. */
  /* THE CERTIFICATIONS ARE NAMED, not alluded to. "the certifications your
     purchase team usually asks for" told the reader we have some and made
     them open the attachment to find out which — and a tender response is
     written by somebody checking a list. The three marks are at the foot
     of this email as artwork; these are the same three in words, which is
     what survives a client with pictures off. The names come from
     integrations/emailIdentity.ts, so there is one place to change if a
     certification lapses or is added. */
  `We are certified to ${CERTIFICATION_NAMES.join(", ")}, and the profile carries the `
  + "registration details your purchase team usually asks for. The lines we supply are "
  + "listed below.",
  /* AND THE ASK IS NOT IN HERE EITHER. It is its own block under the
     products — see profileCallToAction. A paragraph saying "reply to this
     email" immediately above a button that opens a reply is the same
     sentence twice, and a sender rewording one would leave the other
     saying something else. */
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
  /**
   * The lines we supply, printed under the body with each vendor's mark.
   *
   * ON THE DRAFT rather than built inside messageFor, for the same reason
   * everything else on this interface is: the screen previews the real
   * message, and the logo URLs need an origin that only the caller knows.
   */
  products?: readonly EmailProductGroup[] | null;
  /** The band across the top — see PROFILE_HERO. */
  hero?: { eyebrow?: string; headline: string; line?: string } | null;
  /** The ask — see profileCallToAction. */
  callToAction?: { heading: string; lines: readonly string[]; label: string; href: string } | null;
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
    products: draft.products ?? null,
    hero: draft.hero ?? null,
    callToAction: draft.callToAction ?? null,
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
