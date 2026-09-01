import { classifyLocally, type Verdict } from "./verify";

/**
 * Turning somebody's spreadsheet into prospects — and saying what is wrong
 * with it before anything is written.
 *
 * THE RULE THIS FILE EXISTS FOR: nothing imports until a person has seen the
 * counts. Not because the parsing is unreliable, but because the interesting
 * number is never "1,000 rows found" — it is "29 of these were already
 * suppressed and 41 are duplicates of each other", and that is a fact about
 * the list somebody needs to see before it becomes a campaign.
 *
 * Column matching is generous, in the same spirit as the product-catalog
 * importer: matched case-insensitively with punctuation stripped, so
 * "Work Email", "work_email" and "E-mail Address" all land on the same field.
 * When it guesses wrongly the user remaps by hand — the guess is a
 * convenience, never the only way through.
 */

export const PROSPECT_FIELDS = [
  "email", "firstName", "lastName", "fullName", "jobTitle", "company",
  "companyDomain", "phone", "mobile", "linkedin", "industry", "country", "city",
] as const;
export type ProspectField = (typeof PROSPECT_FIELDS)[number];

export const FIELD_LABELS: Readonly<Record<ProspectField, string>> = {
  email: "Work email", firstName: "First name", lastName: "Last name",
  fullName: "Full name", jobTitle: "Job title", company: "Company",
  companyDomain: "Company domain", phone: "Phone", mobile: "Mobile",
  linkedin: "LinkedIn", industry: "Industry", country: "Country", city: "City",
};

/** Header spellings seen in the wild, in the order they are tried. */
const ALIASES: Readonly<Record<ProspectField, readonly string[]>> = {
  email: ["email", "workemail", "emailaddress", "businessemail", "officialemail", "mail", "emailid", "primaryemail"],
  firstName: ["firstname", "fname", "givenname", "first"],
  lastName: ["lastname", "lname", "surname", "familyname", "last"],
  fullName: ["fullname", "name", "contactname", "personname", "contact"],
  jobTitle: ["jobtitle", "title", "designation", "role", "position"],
  company: ["company", "companyname", "organisation", "organization", "account", "accountname", "firm"],
  companyDomain: ["companydomain", "domain", "website", "companywebsite", "url", "site"],
  phone: ["phone", "phonenumber", "telephone", "landline", "officephone", "contactnumber"],
  mobile: ["mobile", "mobilenumber", "cell", "cellphone", "whatsapp"],
  linkedin: ["linkedin", "linkedinurl", "linkedinprofile", "li"],
  industry: ["industry", "sector", "vertical", "businesstype"],
  country: ["country", "countryname", "region"],
  city: ["city", "town", "location"],
};

/** Squash a header down to something comparable: lowercase, letters and
 *  digits only. "E-mail Address " and "email_address" become the same key. */
export const normaliseHeader = (h: unknown): string =>
  String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Guess which column is which.
 *
 * Exact alias match first across every field, and only then prefix matching —
 * otherwise a sheet with both "Email" and "Email Verified" can bind the
 * wrong one, and a "Company" column can lose to "Company Domain" purely
 * because of header order.
 */
export function inferMapping(headers: readonly string[]): Partial<Record<ProspectField, string>> {
  const mapping: Partial<Record<ProspectField, string>> = {};
  const taken = new Set<string>();
  const keyed = headers.map((h) => ({ raw: h, key: normaliseHeader(h) }));

  for (const field of PROSPECT_FIELDS) {
    const hit = keyed.find((h) => !taken.has(h.raw) && ALIASES[field].includes(h.key));
    if (hit) { mapping[field] = hit.raw; taken.add(hit.raw); }
  }
  for (const field of PROSPECT_FIELDS) {
    if (mapping[field]) continue;
    const hit = keyed.find((h) => !taken.has(h.raw) && ALIASES[field].some((a) => h.key.startsWith(a)));
    if (hit) { mapping[field] = hit.raw; taken.add(hit.raw); }
  }
  return mapping;
}

export interface RawRow { [header: string]: unknown }

export interface MappedProspect {
  email: string;
  firstName: string; lastName: string; fullName: string;
  jobTitle: string; company: string; companyDomain: string;
  phone: string; mobile: string; linkedin: string;
  industry: string; country: string; city: string;
  /** Columns the mapping did not claim. Kept rather than discarded. */
  extra: Record<string, string>;
}

const text = (v: unknown): string => String(v ?? "").trim();

export function mapRow(row: RawRow, mapping: Partial<Record<ProspectField, string>>): MappedProspect {
  const get = (f: ProspectField): string => (mapping[f] ? text(row[mapping[f] as string]) : "");
  const claimed = new Set(Object.values(mapping));
  const extra: Record<string, string> = {};
  for (const [header, value] of Object.entries(row)) {
    if (claimed.has(header)) continue;
    const v = text(value);
    if (v) extra[header] = v.slice(0, 500);
  }

  const first = get("firstName");
  const last = get("lastName");
  const full = get("fullName");
  /* A sheet gives either the halves or the whole, rarely both. Derive
     whichever is missing so a template's {{first_name}} has something to
     use — a greeting that renders "Hello ," is worse than no campaign. */
  const derivedFull = full || [first, last].filter(Boolean).join(" ");
  const parts = full.split(/\s+/).filter(Boolean);

  return {
    email: get("email").toLowerCase(),
    firstName: first || (parts.length ? parts[0]! : ""),
    lastName: last || (parts.length > 1 ? parts.slice(1).join(" ") : ""),
    fullName: derivedFull,
    jobTitle: get("jobTitle"),
    company: get("company"),
    companyDomain: get("companyDomain").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase(),
    phone: get("phone"), mobile: get("mobile"), linkedin: get("linkedin"),
    industry: get("industry"), country: get("country"), city: get("city"),
    extra,
  };
}

/* ── the audit ──────────────────────────────────────────────────────── */

export type RowProblem =
  | "no-email" | "invalid-email" | "duplicate-in-file" | "already-imported"
  | "suppressed" | "no-name" | "no-company";

export interface AuditedRow {
  rowNumber: number;
  prospect: MappedProspect;
  verdict: Verdict;
  problems: RowProblem[];
  /** Whether this row is offered for import by default. */
  importable: boolean;
}

export interface ImportAudit {
  rows: AuditedRow[];
  total: number;
  importable: number;
  counts: Record<RowProblem, number>;
}

export interface KnownAddresses {
  /** Addresses already in the CRM as prospects. */
  existing?: ReadonlySet<string>;
  /** The global suppression list. */
  suppressed?: ReadonlySet<string>;
}

export const PROBLEM_LABELS: Readonly<Record<RowProblem, string>> = {
  "no-email": "No email address",
  "invalid-email": "Email failed verification",
  "duplicate-in-file": "Appears more than once in this file",
  "already-imported": "Already in the CRM",
  suppressed: "On the suppression list",
  "no-name": "No name",
  "no-company": "No company",
};

/**
 * Look at every row and say what is wrong with it. Writes nothing.
 *
 * A row can carry several problems at once and they are all reported — a
 * screen that says only the first reason sends somebody round the loop
 * fixing one thing at a time.
 */
export function auditRows(
  rows: readonly RawRow[],
  mapping: Partial<Record<ProspectField, string>>,
  known: KnownAddresses = {},
): ImportAudit {
  const existing = known.existing ?? new Set<string>();
  const suppressed = known.suppressed ?? new Set<string>();
  const seenInFile = new Set<string>();

  const counts: Record<RowProblem, number> = {
    "no-email": 0, "invalid-email": 0, "duplicate-in-file": 0,
    "already-imported": 0, suppressed: 0, "no-name": 0, "no-company": 0,
  };

  const audited = rows.map((row, i) => {
    const prospect = mapRow(row, mapping);
    const email = prospect.email.toLowerCase();
    const verdict = classifyLocally(email);
    const problems: RowProblem[] = [];

    if (!email) problems.push("no-email");
    else {
      if (!verdict.eligible) problems.push("invalid-email");
      if (seenInFile.has(email)) problems.push("duplicate-in-file");
      if (existing.has(email)) problems.push("already-imported");
      if (suppressed.has(email)) problems.push("suppressed");
      seenInFile.add(email);
    }
    /* Missing a name or a company does not stop an import — plenty of good
       lists have gaps — but a template that needs {{first_name}} cannot go
       to this row, so it is counted and shown. */
    if (!prospect.firstName && !prospect.fullName) problems.push("no-name");
    if (!prospect.company) problems.push("no-company");

    for (const p of problems) counts[p]++;

    const blocking = problems.some((p) =>
      p === "no-email" || p === "invalid-email" || p === "duplicate-in-file"
      || p === "already-imported" || p === "suppressed");

    return { rowNumber: i + 1, prospect, verdict, problems, importable: !blocking };
  });

  return {
    rows: audited,
    total: audited.length,
    importable: audited.filter((r) => r.importable).length,
    counts,
  };
}
