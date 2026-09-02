import { getSupabase, isSupabaseConfigured } from "./supabase";
import type { MappedProspect } from "../domain/outreach/importMap";
import type { Schedule } from "../domain/outreach/sending";
import { DEFAULT_SCHEDULE } from "../domain/outreach/sending";

/**
 * Reading and writing the outreach tables.
 *
 * The tables are prefixed `outreach_` because this Supabase project is shared
 * with another application that already owns `prospects`, `campaigns` and
 * `suppressions` — see supabase/022_outreach_prospects.sql. Every name in this
 * file must carry the prefix; an unprefixed one would silently read the other
 * application's data, which is exactly the bug the prefix exists to prevent.
 *
 * WHAT THIS FILE MAY NOT DO. It cannot queue a send. `outreach_sends` is
 * granted SELECT only to signed-in users (027), so launching a campaign goes
 * through the server — see launchCampaign below. That is deliberate: a browser
 * that could write to the send queue could mail anyone.
 */

/* ── prospects ─────────────────────────────────────────────────────── */

export interface ProspectRow {
  id: string;
  ownerId: string;
  customerId: string | null;
  importId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string;
  company: string;
  companyDomain: string;
  phone: string;
  mobile: string;
  linkedin: string;
  industry: string;
  country: string;
  city: string;
  status: string;
  verificationStatus: string;
  verificationReason: string;
  quarantined: boolean;
  quarantineReason: string;
  source: string;
  lastContactedAt: string | null;
  createdAt: string;
}

const PROSPECT_COLUMNS =
  "id, owner_id, customer_id, import_id, email, first_name, last_name, full_name, job_title, " +
  "company, company_domain, phone, mobile, linkedin, industry, country, city, status, " +
  "verification_status, verification_reason, quarantined, quarantine_reason, source, " +
  "last_contacted_at, created_at";

const toProspect = (r: Record<string, unknown>): ProspectRow => ({
  id: String(r.id),
  ownerId: String(r.owner_id ?? ""),
  customerId: r.customer_id ? String(r.customer_id) : null,
  importId: r.import_id ? String(r.import_id) : null,
  email: String(r.email ?? ""),
  firstName: String(r.first_name ?? ""),
  lastName: String(r.last_name ?? ""),
  fullName: String(r.full_name ?? ""),
  jobTitle: String(r.job_title ?? ""),
  company: String(r.company ?? ""),
  companyDomain: String(r.company_domain ?? ""),
  phone: String(r.phone ?? ""),
  mobile: String(r.mobile ?? ""),
  linkedin: String(r.linkedin ?? ""),
  industry: String(r.industry ?? ""),
  country: String(r.country ?? ""),
  city: String(r.city ?? ""),
  status: String(r.status ?? "New"),
  verificationStatus: String(r.verification_status ?? "Unknown"),
  verificationReason: String(r.verification_reason ?? ""),
  quarantined: !!r.quarantined,
  quarantineReason: String(r.quarantine_reason ?? ""),
  source: String(r.source ?? "Import"),
  lastContactedAt: r.last_contacted_at ? String(r.last_contacted_at) : null,
  createdAt: String(r.created_at ?? ""),
});

export const outreachAvailable = (): boolean => isSupabaseConfigured();

/**
 * The prospect list.
 *
 * Paged rather than "select everything": a list somebody built from three
 * conference exports is tens of thousands of rows, and a screen that tries to
 * hold all of them is a screen that stops opening.
 */
export async function listProspects(opts: {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  includeQuarantined?: boolean;
} = {}): Promise<{ rows: ProspectRow[]; total: number }> {
  if (!isSupabaseConfigured()) return { rows: [], total: 0 };

  let q = getSupabase()
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100) - 1);

  if (!opts.includeQuarantined) q = q.eq("quarantined", false);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.search?.trim()) {
    const term = `%${opts.search.trim()}%`;
    q = q.or(`email.ilike.${term},company.ilike.${term},full_name.ilike.${term}`);
  }

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []).map((r) => toProspect(r as unknown as Record<string, unknown>)), total: count ?? 0 };
}

/** Every prospect a campaign could target. Used at launch, where the whole
 *  set genuinely is needed and the count is already known to be sane. */
export async function allSendableProspects(limit = 5000): Promise<ProspectRow[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabase()
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS)
    .eq("quarantined", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toProspect(r as unknown as Record<string, unknown>));
}

export interface ImportResult {
  importId: string;
  imported: number;
  skipped: number;
}

/**
 * Write an audited batch of prospects.
 *
 * `upsert` on the email index rather than `insert`, with ignoreDuplicates: a
 * re-import of an overlapping list is the normal case, not an error, and the
 * import must not fail half way and leave nobody able to say which half
 * arrived. The audit that produced these rows already told the salesperson
 * how many were duplicates before they pressed the button.
 */
export async function importProspects(args: {
  ownerId: string;
  fileName: string;
  rows: readonly { prospect: MappedProspect; verificationStatus: string; verificationReason: string }[];
  rowCount: number;
  skipped: number;
  summary?: Record<string, unknown>;
}): Promise<ImportResult> {
  if (!isSupabaseConfigured()) throw new Error("Importing prospects needs the database.");
  const db = getSupabase();

  const { data: imp, error: impErr } = await db
    .from("outreach_imports")
    .insert({
      imported_by: args.ownerId,
      file_name: args.fileName.slice(0, 200),
      row_count: args.rowCount,
      imported_count: args.rows.length,
      skipped_count: args.skipped,
      summary: args.summary ?? {},
    })
    .select("id")
    .single();
  if (impErr) throw new Error(impErr.message);

  const importId = String((imp as Record<string, unknown>).id);

  /* In chunks. One statement carrying ten thousand rows is a statement that
     times out, and PostgREST has its own body limit well below that. */
  const CHUNK = 500;
  let imported = 0;

  for (let i = 0; i < args.rows.length; i += CHUNK) {
    const slice = args.rows.slice(i, i + CHUNK).map(({ prospect: p, verificationStatus, verificationReason }) => ({
      owner_id: args.ownerId,
      import_id: importId,
      email: p.email,
      first_name: p.firstName,
      last_name: p.lastName,
      full_name: p.fullName,
      job_title: p.jobTitle,
      company: p.company,
      company_domain: p.companyDomain,
      phone: p.phone,
      mobile: p.mobile,
      linkedin: p.linkedin,
      industry: p.industry,
      country: p.country,
      city: p.city,
      verification_status: verificationStatus,
      verification_reason: verificationReason,
      verified_at: new Date().toISOString(),
      source: "Import",
      data: p.extra ?? {},
    }));

    const { data, error } = await db
      .from("outreach_prospects")
      .upsert(slice, { onConflict: "email", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    imported += (data ?? []).length;
  }

  /* The real number, after the database has had its say about duplicates.
     The optimistic count written a moment ago would otherwise be the one a
     salesperson reads back weeks later. */
  if (imported !== args.rows.length) {
    await db.from("outreach_imports")
      .update({ imported_count: imported, skipped_count: args.rowCount - imported })
      .eq("id", importId);
  }

  return { importId, imported, skipped: args.rowCount - imported };
}

/** Clear a quarantine flag after a person has looked at the row. */
export async function releaseProspect(id: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await getSupabase()
    .from("outreach_prospects")
    .update({ quarantined: false, quarantine_reason: "", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ── the suppression list ──────────────────────────────────────────── */

export interface SuppressionRow {
  id: string;
  email: string;
  reason: string;
  note: string;
  createdAt: string;
}

export async function listSuppressions(limit = 1000): Promise<SuppressionRow[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabase()
    .from("outreach_suppressions")
    .select("id, email, reason, note, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    email: String(r.email ?? ""),
    reason: String(r.reason ?? ""),
    note: String(r.note ?? ""),
    createdAt: String(r.created_at ?? ""),
  }));
}

/** Just the addresses, lower-cased, for buildAudience. */
export async function suppressedAddresses(): Promise<Set<string>> {
  const rows = await listSuppressions(10000);
  return new Set(rows.map((r) => r.email.trim().toLowerCase()));
}

/**
 * Add somebody to the suppression list.
 *
 * There is no matching remove. 022 grants insert and select and nothing else,
 * so taking a person off the list cannot be done from a screen at all — that
 * is a decision with a person behind it, not a button.
 */
export async function suppress(args: {
  email: string;
  reason: string;
  note?: string;
  addedBy?: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error("The suppression list needs the database.");
  const { error } = await getSupabase()
    .from("outreach_suppressions")
    .upsert(
      {
        email: args.email.trim().toLowerCase(),
        reason: args.reason,
        note: (args.note ?? "").slice(0, 500),
        added_by: args.addedBy ?? null,
        source: "crm",
      },
      { onConflict: "email", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}

/* ── campaigns ─────────────────────────────────────────────────────── */

export type CampaignStatus = "draft" | "sending" | "paused" | "done" | "cancelled";

export interface CampaignRow {
  id: string;
  ownerId: string;
  name: string;
  fromAccountId: string | null;
  subject: string;
  body: string;
  html: string;
  templateId: string;
  replyTo: string;
  status: CampaignStatus;
  schedule: Schedule;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

const CAMPAIGN_COLUMNS =
  "id, owner_id, name, from_account_id, subject, body, html, template_id, reply_to, status, " +
  "daily_cap, min_gap_seconds, send_from_hour, send_to_hour, send_days, timezone, " +
  "started_at, finished_at, created_at";

const toCampaign = (r: Record<string, unknown>): CampaignRow => ({
  id: String(r.id),
  ownerId: String(r.owner_id ?? ""),
  name: String(r.name ?? ""),
  fromAccountId: r.from_account_id ? String(r.from_account_id) : null,
  subject: String(r.subject ?? ""),
  body: String(r.body ?? ""),
  html: String(r.html ?? ""),
  templateId: String(r.template_id ?? ""),
  replyTo: String(r.reply_to ?? ""),
  status: String(r.status ?? "draft") as CampaignStatus,
  schedule: {
    dailyCap: Number(r.daily_cap ?? DEFAULT_SCHEDULE.dailyCap),
    minGapSeconds: Number(r.min_gap_seconds ?? DEFAULT_SCHEDULE.minGapSeconds),
    sendFromHour: Number(r.send_from_hour ?? DEFAULT_SCHEDULE.sendFromHour),
    sendToHour: Number(r.send_to_hour ?? DEFAULT_SCHEDULE.sendToHour),
    sendDays: Array.isArray(r.send_days) ? (r.send_days as number[]) : [...DEFAULT_SCHEDULE.sendDays],
    timezone: String(r.timezone ?? DEFAULT_SCHEDULE.timezone),
  },
  startedAt: r.started_at ? String(r.started_at) : null,
  finishedAt: r.finished_at ? String(r.finished_at) : null,
  createdAt: String(r.created_at ?? ""),
});

export async function listCampaigns(limit = 100): Promise<CampaignRow[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabase()
    .from("outreach_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toCampaign(r as unknown as Record<string, unknown>));
}

export async function saveCampaign(args: {
  id?: string;
  ownerId: string;
  name: string;
  fromAccountId: string | null;
  subject: string;
  body: string;
  html: string;
  templateId: string;
  replyTo: string;
  schedule: Schedule;
}): Promise<CampaignRow> {
  if (!isSupabaseConfigured()) throw new Error("Campaigns need the database.");

  const row = {
    owner_id: args.ownerId,
    name: args.name.slice(0, 200),
    from_account_id: args.fromAccountId,
    subject: args.subject,
    body: args.body,
    html: args.html,
    template_id: args.templateId,
    reply_to: args.replyTo,
    daily_cap: args.schedule.dailyCap,
    min_gap_seconds: args.schedule.minGapSeconds,
    send_from_hour: args.schedule.sendFromHour,
    send_to_hour: args.schedule.sendToHour,
    send_days: args.schedule.sendDays,
    timezone: args.schedule.timezone,
    updated_at: new Date().toISOString(),
  };

  const db = getSupabase();
  const { data, error } = args.id
    ? await db.from("outreach_campaigns").update(row).eq("id", args.id).select(CAMPAIGN_COLUMNS).single()
    : await db.from("outreach_campaigns").insert(row).select(CAMPAIGN_COLUMNS).single();

  if (error) throw new Error(error.message);
  return toCampaign(data as unknown as Record<string, unknown>);
}

/** Pause or resume. Cancelling is separate and one-way — see cancelCampaign. */
export async function setCampaignStatus(id: string, status: "sending" | "paused"): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await getSupabase()
    .from("outreach_campaigns")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Stop a campaign for good.
 *
 * What has been sent stays sent — there is no unsending an email, and a
 * screen that implied otherwise would be lying. The queued rows simply never
 * leave the queue.
 */
export async function cancelCampaign(id: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await getSupabase()
    .from("outreach_campaigns")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ── progress ──────────────────────────────────────────────────────── */

export interface SendRow {
  id: string;
  prospectId: string;
  sendTo: string;
  subject: string;
  state: "queued" | "sending" | "sent" | "failed" | "skipped";
  note: string;
  sentAt: string | null;
}

export interface CampaignProgress {
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
}

export async function campaignProgress(campaignId: string): Promise<CampaignProgress> {
  const empty = { queued: 0, sent: 0, failed: 0, skipped: 0, total: 0 };
  if (!isSupabaseConfigured()) return empty;

  const { data, error } = await getSupabase()
    .from("outreach_sends")
    .select("state")
    .eq("campaign_id", campaignId);
  if (error) throw new Error(error.message);

  const tally = { ...empty };
  for (const r of data ?? []) {
    const state = String((r as unknown as Record<string, unknown>).state);
    /* 'sending' counts as queued: it is a row a run has claimed but not yet
       finished, and showing it in its own column would only ever confuse. */
    if (state === "sent") tally.sent += 1;
    else if (state === "failed") tally.failed += 1;
    else if (state === "skipped") tally.skipped += 1;
    else tally.queued += 1;
    tally.total += 1;
  }
  return tally;
}

/** The rows themselves, for "what happened to Ravi at Acme?". */
export async function listSends(campaignId: string, limit = 500): Promise<SendRow[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabase()
    .from("outreach_sends")
    .select("id, prospect_id, send_to, subject, state, note, sent_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    prospectId: String(r.prospect_id ?? ""),
    sendTo: String(r.send_to ?? ""),
    subject: String(r.subject ?? ""),
    state: String(r.state ?? "queued") as SendRow["state"],
    note: String(r.note ?? ""),
    sentAt: r.sent_at ? String(r.sent_at) : null,
  }));
}

/**
 * Launch: build the queue and start sending.
 *
 * Goes to the server, because the browser cannot write to `outreach_sends` —
 * 027 revokes insert from `authenticated` precisely so that this path is the
 * only one. The function re-runs the audience rules with the suppression list
 * as it stands at that moment, which is the list that matters rather than the
 * one the screen loaded some minutes ago.
 */
export async function launchCampaign(args: {
  campaignId: string;
  prospectIds: readonly string[];
  allowMissing?: boolean;
  accessToken: string;
}): Promise<{ queued: number; excluded: number }> {
  const res = await fetch("/.netlify/functions/outreach-launch", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${args.accessToken}` },
    body: JSON.stringify({
      campaignId: args.campaignId,
      prospectIds: args.prospectIds,
      allowMissing: !!args.allowMissing,
    }),
  });

  const text = await res.text();
  let payload: Record<string, unknown> = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* a proxy error page, not JSON */ }

  if (!res.ok) throw new Error(String(payload.error ?? text ?? "The campaign could not be launched."));
  return { queued: Number(payload.queued ?? 0), excluded: Number(payload.excluded ?? 0) };
}

/* ── mailboxes a campaign may send from ────────────────────────────── */

export interface SendingAccount {
  id: string;
  email: string;
  displayName: string;
  isDefault: boolean;
}

/**
 * The mailboxes this person may send from.
 *
 * Reads `my_sending_accounts()` — the function 024 added, which returns the
 * mailboxes somebody owns PLUS the shared ones they were granted. Never
 * `email_accounts` directly: that table holds the refresh tokens, and the
 * token-free view exists precisely so a screen never has to touch them.
 */
export async function mySendingAccounts(): Promise<SendingAccount[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabase().rpc("my_sending_accounts");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    email: String(r.email ?? ""),
    displayName: String(r.display_name ?? ""),
    isDefault: !!r.is_default,
  }));
}
