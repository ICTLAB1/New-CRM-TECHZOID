import { getSupabase, isSupabaseConfigured } from "./supabase";
import type { FollowUp, FollowUpTone } from "../domain/followups/followups";

/**
 * Reading, arming and stopping automatic follow-up sequences.
 *
 * The one place in the app that touches the `follow_ups` table. Rows are
 * written whole — subject, message and rendered HTML included — because what
 * is queued must be exactly what the person arming it previewed. See
 * supabase/012_followups.sql for why that is the shape.
 *
 * DEGRADES HONESTLY. Automatic follow-ups need a workspace and a scheduler;
 * in demo mode there is neither, so the app says so rather than promising a
 * customer will be chased next Tuesday by a browser tab that closed.
 */

export class FollowUpError extends Error {}

interface FollowUpRow {
  id: string;
  owner_id: string;
  doc_type: string;
  doc_id: string;
  doc_number: string;
  customer_id: string | null;
  customer_name: string;
  step: number;
  steps: number;
  tone: string;
  due_on: string;
  state: string;
  send_to: string;
  cc: string;
  reply_to: string;
  subject: string;
  message: string;
  html: string | null;
  sent_at: string | null;
  error: string | null;
}

const toFollowUp = (r: FollowUpRow): FollowUp => ({
  id: r.id,
  ownerId: r.owner_id,
  docType: r.doc_type,
  docId: r.doc_id,
  docNumber: r.doc_number ?? "",
  customerId: r.customer_id ?? undefined,
  customerName: r.customer_name ?? "",
  step: Number(r.step) || 1,
  steps: Number(r.steps) || 1,
  tone: r.tone as FollowUpTone,
  dueOn: r.due_on,
  state: r.state as FollowUp["state"],
  to: r.send_to,
  cc: r.cc ?? "",
  replyTo: r.reply_to ?? "",
  subject: r.subject ?? "",
  message: r.message ?? "",
  html: r.html ?? undefined,
  sentAt: r.sent_at ?? undefined,
  error: r.error ?? undefined,
});

/** Whether a sequence can be armed at all. */
export const followUpsAvailable = (): boolean => isSupabaseConfigured();

/** Everything queued or already sent against one document, in order. */
export async function listFollowUps(docId: string): Promise<FollowUp[]> {
  const { data, error } = await getSupabase()
    .from("follow_ups")
    .select("*")
    .eq("doc_id", docId)
    .order("due_on", { ascending: true });
  if (error) throw new FollowUpError(error.message);
  return ((data as FollowUpRow[] | null) ?? []).map(toFollowUp);
}

export interface ArmedStep {
  step: number;
  steps: number;
  tone: FollowUpTone;
  dueOn: string;
  subject: string;
  message: string;
  html?: string;
}

/**
 * Arm a sequence against a document.
 *
 * Anything already scheduled for the same document is cancelled first.
 * Re-sending a quotation is the normal way a salesperson restarts a
 * conversation, and it would otherwise leave the old sequence running
 * alongside the new one — two chasers a week for the same document, from
 * two schedules nobody remembers arming.
 *
 * Cancelled rather than deleted: what was queued and called off is part of
 * the record of how a deal was handled.
 */
export async function armFollowUps(opts: {
  ownerId: string;
  docType: "quotation" | "proforma";
  docId: string;
  docNumber: string;
  customerId?: string;
  customerName?: string;
  to: string;
  cc?: string;
  replyTo?: string;
  steps: readonly ArmedStep[];
}): Promise<FollowUp[]> {
  const client = getSupabase();

  await cancelFollowUps(opts.docId);

  if (!opts.steps.length) return [];

  const rows = opts.steps.map((s) => ({
    owner_id: opts.ownerId,
    doc_type: opts.docType,
    doc_id: opts.docId,
    doc_number: opts.docNumber,
    customer_id: opts.customerId ?? null,
    customer_name: opts.customerName ?? "",
    step: s.step,
    steps: s.steps,
    tone: s.tone,
    due_on: s.dueOn,
    state: "scheduled",
    send_to: opts.to,
    cc: opts.cc ?? "",
    reply_to: opts.replyTo ?? "",
    subject: s.subject,
    message: s.message,
    html: s.html ?? null,
  }));

  const { data, error } = await client.from("follow_ups").insert(rows).select("*");
  if (error) throw new FollowUpError(error.message);
  return ((data as FollowUpRow[] | null) ?? []).map(toFollowUp);
}

/**
 * Stop what has not gone yet.
 *
 * Only touches scheduled rows: a sent follow-up cannot be recalled, and
 * rewriting its state to "cancelled" would say something untrue about an
 * email the customer has already read.
 */
export async function cancelFollowUps(docId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("follow_ups")
    .update({ state: "cancelled", updated_at: new Date().toISOString() })
    .eq("doc_id", docId)
    .eq("state", "scheduled");
  if (error) throw new FollowUpError(error.message);
}
