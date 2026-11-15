import { getDb, hasBackend } from "./backend";

/**
 * The company profile PDF, as the browser manages it.
 *
 * STORED ONCE, SENT MANY TIMES. The sending function reads the file itself
 * (netlify/functions/profile-send.mjs) so that a thirty-recipient send
 * uploads nothing — see supabase/059_company_profile.sql for why it is a
 * table rather than a bucket.
 *
 * WHO MAY REPLACE IT is row-level security's answer, not this module's: the
 * policies admit an Admin or a Manager, so a salesperson's write is refused
 * by the database. The screen hides the button as a courtesy; the refusal is
 * what actually holds.
 */

/** What a screen needs to describe the file without downloading it. */
export interface ProfileInfo {
  fileName: string;
  mime: string;
  bytes: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * The limit, and it comes from Microsoft rather than from us.
 *
 * Graph refuses a sendMail request over about 4 MB when the attachment rides
 * inside the message, and base64 inflates a file by a third. 3 MB of PDF is
 * 4 MB on the wire, which is already at the edge — so 3 MB is the cap, and
 * the error says why rather than just saying no.
 */
export const MAX_PROFILE_BYTES = 3 * 1024 * 1024;

export class ProfileError extends Error {}

const row = (data: unknown): Record<string, unknown> | null =>
  data && typeof data === "object" ? (data as Record<string, unknown>) : null;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/**
 * What is on file, without its contents.
 *
 * The `content` column is deliberately not selected: it is megabytes, every
 * screen that shows the profile wants only its name and size, and a list
 * that quietly downloads a PDF on every render is a list that is slow on a
 * phone for no reason.
 */
export async function loadProfileInfo(company: string): Promise<ProfileInfo | null> {
  if (!hasBackend() || !company) return null;
  const { data, error } = await getDb()
    .from("company_profiles")
    .select("file_name, mime, bytes, updated_at, updated_by")
    .eq("company_id", company)
    .maybeSingle();
  if (error || !data) return null;
  const r = row(data)!;
  return {
    fileName: text(r.file_name),
    mime: text(r.mime) || "application/pdf",
    bytes: num(r.bytes),
    updatedAt: text(r.updated_at) || null,
    updatedBy: text(r.updated_by) || null,
  };
}

/** The file itself, for the person who wants to check what is going out. */
export async function loadProfileFile(
  company: string,
): Promise<{ fileName: string; mime: string; base64: string } | null> {
  if (!hasBackend() || !company) return null;
  const { data, error } = await getDb()
    .from("company_profiles")
    .select("file_name, mime, content")
    .eq("company_id", company)
    .maybeSingle();
  if (error || !data) return null;
  const r = row(data)!;
  const base64 = text(r.content);
  if (!base64) return null;
  return { fileName: text(r.file_name), mime: text(r.mime) || "application/pdf", base64 };
}

/** A file's bytes as base64, without the `data:` prefix a FileReader adds. */
export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ProfileError("That file could not be read."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Put a new profile on file, replacing whatever was there.
 *
 * ONE ROW PER COMPANY, so this is an upsert and the previous file is gone. A
 * version history for a marketing PDF is a megabyte a month forever and a
 * feature nobody asked for; what matters is that what goes out today is what
 * somebody chose today.
 */
export async function saveProfile(
  company: string,
  file: File,
  userId: string,
): Promise<ProfileInfo> {
  if (!hasBackend()) throw new ProfileError("This preview has no server behind it.");
  if (!company) throw new ProfileError("Choose a company first.");

  const name = file.name.trim() || "company-profile.pdf";
  /* PDF ONLY, and not because of what the database can hold. This file is
     attached to mail going to customers: a .docx shows its tracked changes
     and its comments to whoever opens it, and a .pptx opens in edit mode.
     A PDF is the one format that looks the same to everybody. */
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
  if (!isPdf) throw new ProfileError("The company profile has to be a PDF.");

  if (file.size > MAX_PROFILE_BYTES) {
    throw new ProfileError(
      `That file is ${(file.size / 1048576).toFixed(1)} MB. Microsoft refuses an email much over 4 MB, `
      + `and base64 adds a third — so the profile has to be under ${MAX_PROFILE_BYTES / 1048576} MB. `
      + `Compressing the images in it usually does it.`,
    );
  }
  if (file.size === 0) throw new ProfileError("That file is empty.");

  const base64 = await readAsBase64(file);
  if (!base64) throw new ProfileError("That file could not be read.");

  const { error } = await getDb().from("company_profiles").upsert({
    company_id: company,
    file_name: name,
    mime: "application/pdf",
    bytes: file.size,
    content: base64,
    updated_at: new Date().toISOString(),
    updated_by: userId || null,
  }, { onConflict: "company_id" });

  if (error) {
    /* The policy refusing an unprivileged write is the expected failure, and
       the database's own words for it are not words for a salesperson. */
    throw new ProfileError(
      /row-level security|permission denied/i.test(error.message ?? "")
        ? "Only an admin or a manager can replace the company profile."
        : error.message || "The company profile could not be saved.",
    );
  }

  return {
    fileName: name,
    mime: "application/pdf",
    bytes: file.size,
    updatedAt: new Date().toISOString(),
    updatedBy: userId || null,
  };
}

/** Who has already been sent the profile, newest first. Used to warn before
 *  somebody is sent it a second time in a fortnight. */
export async function loadRecentSends(
  company: string,
  limit = 400,
): Promise<Array<{ email: string; customerId: string | null; at: string; status: string }>> {
  if (!hasBackend() || !company) return [];
  const { data, error } = await getDb()
    .from("profile_sends")
    .select("email, customer_id, created_at, status")
    .eq("company_id", company)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    email: text(r.email).toLowerCase(),
    customerId: text(r.customer_id) || null,
    at: text(r.created_at),
    status: text(r.status),
  }));
}
