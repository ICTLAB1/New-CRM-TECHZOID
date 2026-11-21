import {
  buildEmailHtml, buildEmailText,
  type EmailCompany, type EmailProductGroup, type EmailSender,
} from "../integrations/emailTemplate";
import { CERTIFICATION_NAMES } from "../integrations/emailIdentity";
import { fill, valuesFor, type Values } from "./personalise";
import { enrichFromAddress, firstNameFromEmail, parsePastedList } from "./paste";

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
 *
 * AND IT HAS TO COVER EVERY LINE THE EMAIL GOES ON TO LIST. This band said
 * "software licensing" and nothing else, because it was written when that
 * was all the email listed. A hardware line was added below it and the band
 * was not changed, so the first thing a reader saw announced a software
 * company and the panels underneath then offered them laptops, firewalls
 * and accessories. A reader deciding in two seconds whether we sell what
 * they are about to buy reads the band, not the panels — see the test in
 * productLines.test.ts that now holds the two together.
 *
 * WHAT IT DELIBERATELY DOES NOT DO is repeat the specifics. The panels name
 * the manufacturers and the products; the band names the lines. One place
 * to correct when a line changes, rather than two that can disagree.
 */
export const PROFILE_HERO = {
  eyebrow: "Software licensing & IT hardware",
  headline: "Genuine software licensing and business IT hardware",
  line: "Enterprise subscriptions, perpetual licensing and professional design applications "
    + "from the software publishers your teams already use — and the hardware, network "
    + "security and accessories to run them on.",
};

/**
 * Which number goes under the sender's name, and whose it is.
 *
 * REPORTED: the agent's mobile was wanted in the signature on a company
 * profile. It was already printed — when the agent had one on file. When
 * they did not, the signature had NO number at all: name, company, email,
 * and nothing to ring. A cold introduction to a buyer who has never heard
 * of this company, carrying no phone number, is a leaflet.
 *
 * THE COMPANY NUMBER IS THE FALLBACK, and not a silent substitution. This
 * is what the campaign signature has done since 031 — see signatureFrom
 * in signature.ts, whose comment is worth reading: the switchboard is
 * "still a real number, just not a personal one". The profile mailshot
 * was the one path with no fallback, so the two signatures disagreed
 * about the same person on the same day.
 *
 * `whose` is returned so the SCREEN can say which of the two it is before
 * anything goes out. Falling back silently is how the switchboard ended
 * up under everybody's name in the first place, and "the number under my
 * name is not mine" is not something to work out from a received email.
 */
export interface SenderNumber {
  /** What will be printed, or "" when there is nothing to print. */
  number: string;
  whose: "mine" | "company" | "none";
}

export function senderNumber(myPhone: unknown, companyPhone: unknown): SenderNumber {
  const mine = clean(myPhone);
  if (mine) return { number: mine, whose: "mine" };
  const company = clean(companyPhone);
  if (company) return { number: company, whose: "company" };
  return { number: "", whose: "none" };
}

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
  /* THE COMPANY'S OWN WORDS, supplied verbatim. What changed is the name:
     {{sender_company}} rather than the name typed out. It renders exactly
     the same, and it cannot go stale when the name changes or print one
     company's name on another's mail — the mistake the header tagline was
     making until this week. The subject line already works this way. */
  "Greetings from {{sender_company}}!",
  /* "OURSELVES", NOT THE NAME AGAIN. The line above has just said the
     company's name; saying it a second time in the next sentence is the
     repetition that got this reported. The supplied wording named the
     company twice because the second mention was the short form — and
     {{sender_company}} is the registered name, so both came out in full. */
  "We are pleased to introduce ourselves as a trusted IT solutions and technology partner, "
  + "offering a comprehensive range of IT products, software licensing, enterprise solutions "
  + "and technology services.",
  /* ONE REGISTER THROUGHOUT. This used to open "I thought it would be
     useful to have our company profile on file", which is a personal note
     — and reads oddly under a formal introduction. The opening sets the
     tone and the rest follows it. */
  "Our company profile is attached.",
  /* THE CERTIFICATIONS ARE NAMED, not alluded to: "the certifications your
     purchase team asks for" told the reader we hold some and made them
     open the attachment to find out which, and a tender response is
     written by somebody checking a list. The names come from
     integrations/emailIdentity.ts, so there is one place to change if a
     certification lapses — and the signature is built from that same list. */
  `We are an ${CERTIFICATION_NAMES.slice(0, -1).join(", ")} and `
  + `${CERTIFICATION_NAMES[CERTIFICATION_NAMES.length - 1]} certified company.`,
  /* WHAT WE SELL IS NOT IN HERE. It is its own block under the body, by
     vendor, with every product named — see productLines.ts. The block
     announces itself; this does not need to announce the block. */
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

    /* THE NAME, AND WHERE IT COMES FROM WHEN THE RECORD HAS NONE.
     *
     * A customer row with no contact name used to fall straight through to
     * the company name — "Dear Giri Infotech Pvt Ltd," — or to a bare
     * "Hello," when there was not even that. Both are the opposite of what
     * this feature is for: a message addressed to a company is a circular
     * wearing a greeting, and the reader can tell.
     *
     * The address usually knows. shivdatta@… is Shivdatta, and the guess
     * is the same one the pasted-list path has always made, with the same
     * restraint: a shared inbox (sales@, info@, accounts@) gets nothing,
     * because "Dear Sales," is worse than no name at all, and so do
     * local parts with digits, initials, or no vowel. No guess, no harm —
     * it falls through to the company name exactly as before. */
    const given = nameParts(clean(c.contact));
    const parts = given.first
      ? given
      : (() => {
        const guess = firstNameFromEmail(email);
        return guess ? { first: guess, last: "", full: guess } : given;
      })();

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

    /* A GUESS IS NOT A GREETING — but a good guess is a name.
       This refused every name taken from an address, on the strength of
       two examples: "Dear Ops," for ops@kappa.example and "Dear Mu," for
       mail@mu.example. Both were right, and both were failures of the
       GUESS rather than of the idea. mail@ was already refused; ops@ was
       not, because "ops" was missing from the role list. It is there now,
       with the rest of the shared-inbox words an Indian reseller actually
       meets — query@, service@, stores@, dispatch@, md@.

       With the guess made honest, refusing it wholesale costs more than it
       saves: it is the difference between "Dear Shivdatta," and "Hello," on
       a message whose entire purpose is being addressed to one person.
       firstNameFromEmail now returns nothing for a shared inbox, nothing
       for digits or initials, nothing without a vowel — and when it
       returns nothing, the greeting still falls through to the company and
       then to "Hello,".

       The COMPANY guess is still kept out of the greeting: a domain is a
       weaker signal than a local part, and "Dear Giriinfotech," reads worse
       than the alternative. It stays on the label, where it tells two rows
       apart on screen. */
    const guessedCompany = person.derived.includes("company");

    recipients.push({
      customerId: "",
      email,
      /* A typed name, else the one the address implies, else the company
         the domain implies, else the address itself. */
      label: person.fullName || person.company || email,
      values: valuesFor(
        {
          firstName: person.firstName,
          lastName: person.lastName,
          fullName: person.fullName,
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
