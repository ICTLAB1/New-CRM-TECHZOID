import { getSupabase, isSupabaseConfigured } from "./supabase";

/**
 * Which company you are working in.
 *
 * ONE CRM, MORE THAN ONE BUSINESS. Every record carries a company, every
 * policy in the database checks it (migration 033), and this is the browser's
 * side of that: which one is currently on screen, and how to move between
 * them.
 *
 * THE ACTIVE COMPANY IS A PREFERENCE, NOT A PERMISSION. It is remembered in
 * this browser and nothing more. Choosing a company here cannot grant access
 * to it — the database refuses a read or a write for any company you are not
 * a member of, whatever this says. That is deliberate: a value in
 * localStorage is something the person can edit, so it must never be the
 * thing that decides what they may see.
 */

export interface Company {
  id: string;
  name: string;
  /** The role this person holds in THIS company, which may differ from the
   *  one they hold in another. */
  role: string;
}

const ACTIVE_KEY = "crm.activeCompany";

/** Every company this person belongs to, with the role they hold in each. */
export async function myCompanies(): Promise<Company[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabase()
    .from("company_members")
    .select("role, companies!inner(id, name)")
    .order("created_at", { ascending: true });
  if (error) throw error;

  type Row = { role: string; companies: { id: string; name: string } | { id: string; name: string }[] };
  return ((data as Row[] | null) ?? []).flatMap((row) => {
    /* PostgREST returns the joined row as an object or an array depending on
       how it infers the relationship; both shapes are handled rather than
       one being assumed and the list silently coming back empty. */
    const list = Array.isArray(row.companies) ? row.companies : [row.companies];
    return list.filter(Boolean).map((c) => ({ id: c.id, name: c.name, role: row.role }));
  });
}

/**
 * Start a company: the company, its settings and its first member at once.
 *
 * One call, because the three cannot be separated — a company with no
 * members is invisible to everybody including the person who just made it.
 * See create_company in migration 033.
 */
export async function createCompany(name: string): Promise<string> {
  const clean = name.trim();
  if (!clean) throw new Error("A company needs a name.");
  const { data, error } = await getSupabase().rpc("create_company", { p_name: clean });
  if (error) throw new Error(readableCompanyError(error.message));
  return String(data);
}

export function readableCompanyError(message: string): string {
  const m = String(message ?? "").toLowerCase();
  if (m.includes("only an admin")) return "Only an admin can add a company.";
  if (m.includes("needs a name")) return "Give the company a name first.";
  if (m.includes("too long")) return "That name is too long.";
  if (m.includes("not signed in")) return "You're signed out. Sign in again and retry.";
  return "Couldn't add that company. Try again in a moment.";
}

/* ── which one is on screen ────────────────────────────────────────── */

export function readActiveCompany(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY) || null;
  } catch {
    /* Private browsing, or storage blocked. Not being able to REMEMBER the
       choice is a nuisance; not being able to make one would be a fault, so
       the caller falls back to the first company either way. */
    return null;
  }
}

export function writeActiveCompany(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* See above. */
  }
}

/**
 * The company to open with.
 *
 * The remembered one, but only if it is still one of theirs — somebody
 * removed from a company must not be left pointing at it, seeing an empty
 * workspace and no explanation. Otherwise the first, which for the great
 * majority of people is their only one.
 */
export function resolveActiveCompany(companies: Company[], remembered: string | null): string | null {
  if (!companies.length) return null;
  if (remembered && companies.some((c) => c.id === remembered)) return remembered;
  return companies[0]!.id;
}

/** What this person may do in the company they are looking at. Not the role
 *  on their profile: a director of one business can be a salesperson in
 *  another, and the CRM has to believe the company, not the person. */
export const roleIn = (companies: Company[], companyId: string | null): string =>
  companies.find((c) => c.id === companyId)?.role ?? "Sales";
