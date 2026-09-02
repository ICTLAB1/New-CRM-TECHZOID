import { ROLE_LOCAL_PARTS, classifyLocally, type Verdict } from "./verify";

/**
 * Turning a pasted blob of addresses into people.
 *
 * The realistic input is not a tidy list. It is whatever came out of the
 * clipboard: a column dragged from Excel, the To: line of an Outlook message,
 * a WhatsApp forward, a signature block somebody copied by accident. So this
 * accepts all of it and reports what it could not read rather than silently
 * dropping it — a paste that quietly loses four addresses out of forty is a
 * campaign that quietly misses four companies.
 *
 * WHAT IT UNDERSTANDS
 *
 *   ravi@acme.example
 *   Ravi Sharma <ravi@acme.example>          ← Outlook, Gmail, most clients
 *   "Sharma, Ravi" <ravi@acme.example>       ← Outlook with a quoted comma
 *   ravi@acme.example, priya@beta.example    ← comma or semicolon separated
 *   ravi@acme.example; Priya <priya@b.ex>    ← mixed, in any order
 *
 * Separators are newline, comma, semicolon, tab and pipe — EXCEPT inside
 * angle brackets or quotes, because "Sharma, Ravi" <ravi@acme.example> is one
 * person and splitting it on the comma makes two, one of them nonsense.
 *
 * A NAME IS TAKEN WHERE ONE IS OFFERED. "Ravi Sharma <ravi@acme.example>"
 * carries a first name, and the templates need one — without it that person
 * is held back for missing data, which would make pasting from Outlook feel
 * broken for no reason.
 */

export interface PastedPerson {
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  /** Derived from the domain by enrichFromAddress; empty until then. */
  company?: string;
  verdict: Verdict;
}

export interface PasteResult {
  people: PastedPerson[];
  /** Fragments that held no address. Shown, never swallowed. */
  unreadable: string[];
  /** Addresses that appeared more than once. Counted, not repeated. */
  duplicates: string[];
}

/* Deliberately loose: this decides what LOOKS like an address, and
   classifyLocally then decides whether it is one worth writing to. Two
   checks with two jobs — a stricter pattern here would silently drop a real
   address before anything could explain why. */
const EMAIL_RE = /[^\s<>(),;:"'\\[\]]+@[^\s<>(),;:"'\\[\]]+\.[a-z]{2,}/i;

/**
 * Split a blob into fragments, one per person.
 *
 * Angle brackets and quotes suspend the separators, so `"Sharma, Ravi"
 * <ravi@acme.example>` survives as one fragment rather than becoming two.
 */
export function splitFragments(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inAngle = false;
  let inQuote = false;

  for (const ch of String(text ?? "")) {
    if (ch === '"') { inQuote = !inQuote; buf += ch; continue; }
    if (ch === "<") { inAngle = true; buf += ch; continue; }
    if (ch === ">") { inAngle = false; buf += ch; continue; }

    const separates = ch === "\n" || ch === "\r" || ch === "," || ch === ";" || ch === "\t" || ch === "|";
    if (separates && !inAngle && !inQuote) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Pull the address and any name out of one fragment. */
export function readFragment(fragment: string): { email: string; name: string } | null {
  const raw = String(fragment ?? "").trim();
  if (!raw) return null;

  const found = EMAIL_RE.exec(raw);
  if (!found) return null;

  const email = found[0].replace(/^[.<]+|[.>,;]+$/g, "");

  /* Whatever is left once the address and its brackets are removed. A name
     in quotes loses them; a stray "mailto:" or a bullet loses itself. */
  const name = raw
    .replace(found[0], "")
    .replace(/mailto:/gi, "")
    .replace(/[<>"']/g, "")
    .replace(/^[\s\-–—*•\d.)]+/, "")
    .replace(/[\s,;:]+$/, "")
    .trim();

  return { email, name };
}

/**
 * A name written "Sharma, Ravi" is surname first — Outlook's default in a lot
 * of corporate directories. Getting this backwards produces "Hello Sharma,"
 * which reads as a mail merge that nobody checked.
 */
export function splitName(name: string): { firstName: string; lastName: string; fullName: string } {
  const clean = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return { firstName: "", lastName: "", fullName: "" };

  if (clean.includes(",")) {
    const [last = "", first = ""] = clean.split(",", 2).map((s) => s.trim());
    return {
      firstName: first,
      lastName: last,
      fullName: [first, last].filter(Boolean).join(" "),
    };
  }

  const parts = clean.split(" ");
  const firstName = parts[0] ?? "";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return { firstName, lastName, fullName: clean };
}

/**
 * Read a pasted list.
 *
 * Duplicates are collapsed to the FIRST occurrence and reported, because the
 * first is usually the one with a name attached — a list pasted from two
 * places tends to have the tidy copy first and a bare address later.
 */
export function parsePastedList(text: string): PasteResult {
  const people: PastedPerson[] = [];
  const unreadable: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const fragment of splitFragments(text)) {
    const read = readFragment(fragment);
    if (!read) {
      /* Only worth reporting if somebody actually typed something. A stray
         bullet or a lone dash is noise, not a lost address. */
      if (/[a-z0-9]/i.test(fragment)) unreadable.push(fragment.slice(0, 120));
      continue;
    }

    const key = read.email.toLowerCase();
    if (seen.has(key)) { duplicates.push(read.email); continue; }
    seen.add(key);

    const name = splitName(read.name);
    people.push({
      email: read.email,
      ...name,
      verdict: classifyLocally(read.email),
    });
  }

  return { people, unreadable, duplicates };
}

/** For the count under the box, before anybody presses anything. */
export function pasteSummary(result: PasteResult): {
  total: number;
  usable: number;
  rejected: number;
  named: number;
} {
  const usable = result.people.filter((p) => p.verdict.eligible).length;
  return {
    total: result.people.length,
    usable,
    rejected: result.people.length - usable,
    named: result.people.filter((p) => p.firstName.trim()).length,
  };
}

/* ── what a bare address still tells you ───────────────────────────── */

/**
 * Free-mail providers. An address at one of these says nothing about where
 * the person works, so nothing is derived from it — "Hello Ravi at Gmail" is
 * the sort of thing that gets a sender reported.
 */
export const FREE_MAIL: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "rediffmail.com", "rediff.com", "aol.com", "icloud.com", "me.com",
  "protonmail.com", "proton.me", "zoho.com", "gmx.com", "mail.com",
  "yandex.com", "inbox.com", "ymail.com",
]);

/**
 * The company, from the domain.
 *
 * This is not a guess: ravi@acme.example works at acme.example, and for a
 * business address the second-level name IS the company as anybody would
 * write it. It is the single most reliable thing a bare address carries, and
 * without it a pasted list cannot use any template that mentions the
 * recipient's company — which is most of them.
 *
 * Returns "" for free-mail and for anything too short to be a name, rather
 * than producing something that would read as careless.
 */
export function companyFromEmail(email: string): string {
  const domain = String(email ?? "").trim().toLowerCase().split("@")[1] ?? "";
  if (!domain || FREE_MAIL.has(domain)) return "";

  /* Strip the public suffix. Two labels for .co.in, .co.uk, .com.au and the
     rest; one otherwise. Not a full public-suffix list — it does not need to
     be, because the worst case is a company named "co" which reads as odd
     rather than as wrong, and the UI shows what was derived. */
  const labels = domain.split(".").filter(Boolean);
  const second = labels[labels.length - 2] ?? "";
  const name = (second === "co" || second === "com" || second === "net" || second === "org" || second === "gov" || second === "ac")
    ? labels[labels.length - 3] ?? ""
    : second;

  if (name.length < 2) return "";
  /* Hyphens and underscores are word breaks in a domain. */
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * A first name, from the local part.
 *
 * THIS ONE IS A GUESS, and it is treated as one: it is offered, the UI says
 * the names were read from the addresses, and a role address gets nothing
 * because "Hello Procurement," is worse than no greeting at all.
 *
 * The failure mode is mild and the alternative is worse — a pasted list where
 * every recipient is held back for a missing first name is a feature nobody
 * can use.
 */
export function firstNameFromEmail(email: string): string {
  const local = String(email ?? "").trim().toLowerCase().split("@")[0] ?? "";
  if (!local) return "";

  /* A role address is a shared inbox, not a person. */
  if (ROLE_LOCAL_PARTS.has(local)) return "";

  /* firstname.lastname, firstname_lastname, firstname-lastname. */
  const first = local.split(/[._-]/).filter(Boolean)[0] ?? "";

  /* Digits mean an account number or a disambiguator, not a name. A single
     letter is an initial. Anything with no vowel is almost never a name. */
  if (first.length < 3 || /\d/.test(first)) return "";
  if (!/[aeiouy]/.test(first)) return "";
  if (ROLE_LOCAL_PARTS.has(first)) return "";

  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * Fill in what a bare address implies, leaving anything already known alone.
 *
 * `derived` names which fields were inferred rather than given, so a screen
 * can say so — the whole point is that this is disclosed, not silent.
 */
export function enrichFromAddress(person: PastedPerson): PastedPerson & { derived: string[] } {
  const derived: string[] = [];
  let firstName = person.firstName;
  let lastName = person.lastName;
  let fullName = person.fullName;

  if (!firstName.trim()) {
    const guess = firstNameFromEmail(person.email);
    if (guess) { firstName = guess; fullName = fullName || guess; derived.push("first name"); }
  }

  const company = companyFromEmail(person.email);
  if (company) derived.push("company");

  return { ...person, firstName, lastName, fullName, company, derived };
}
