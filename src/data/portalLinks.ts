import { getSupabase, isSupabaseConfigured } from "./supabase";
import {
  DEFAULT_PORTAL_DAYS, hashPortalToken, newPortalToken, portalLink,
  type PortalTokenRow,
} from "../domain/portal/token";

/**
 * Issuing and withdrawing a customer's portal link.
 *
 * THE SECRET NEVER LEAVES THIS FUNCTION except as its return value. It is
 * generated in the browser, hashed here, and only the hash is written. There
 * is no request anywhere in this file that carries the plaintext, which means
 * there is no server log, proxy or error reporter that can end up holding a
 * working link. What comes back is shown once, and if the salesperson loses
 * it before pasting it, the answer is to issue another — not to look the old
 * one up, because nothing can.
 *
 * RLS decides who may do this (supabase/021_portal_tokens.sql): the customer's
 * owner, or an Admin/Manager. The client does not check, and must not — a
 * check in a browser is a courtesy, not a control.
 */

const fromRow = (r: Record<string, unknown>): PortalTokenRow => ({
  id: String(r.id),
  customerId: String(r.customer_id),
  label: String(r.label ?? ""),
  expiresAt: String(r.expires_at ?? ""),
  revokedAt: r.revoked_at ? String(r.revoked_at) : null,
  createdAt: String(r.created_at ?? ""),
  lastSeenAt: r.last_seen_at ? String(r.last_seen_at) : null,
  viewCount: Number(r.view_count ?? 0),
});

export const portalLinksAvailable = (): boolean => isSupabaseConfigured();

export async function listPortalLinks(customerId: string): Promise<PortalTokenRow[]> {
  if (!isSupabaseConfigured() || !customerId) return [];
  const { data, error } = await getSupabase()
    .from("portal_tokens")
    .select("id, customer_id, label, expires_at, revoked_at, created_at, last_seen_at, view_count")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

export interface IssuedLink {
  row: PortalTokenRow;
  /** The whole link, ready to paste. Available exactly once. */
  url: string;
}

export async function issuePortalLink(args: {
  customerId: string;
  createdBy: string;
  label?: string;
  days?: number;
  origin?: string;
}): Promise<IssuedLink> {
  if (!isSupabaseConfigured()) throw new Error("Portal links need the database.");

  const token = newPortalToken();
  const expiresAt = new Date(Date.now() + (args.days ?? DEFAULT_PORTAL_DAYS) * 86400000).toISOString();

  const { data, error } = await getSupabase()
    .from("portal_tokens")
    .insert({
      customer_id: args.customerId,
      token_hash: await hashPortalToken(token),
      label: (args.label ?? "").trim().slice(0, 120),
      expires_at: expiresAt,
      created_by: args.createdBy,
    })
    .select("id, customer_id, label, expires_at, revoked_at, created_at, last_seen_at, view_count")
    .single();

  if (error) throw new Error(error.message);
  return {
    row: fromRow(data as Record<string, unknown>),
    url: portalLink(args.origin ?? window.location.origin, token),
  };
}

/**
 * Withdraw a link.
 *
 * Revoked rather than deleted, deliberately: "this link was issued to Ravi on
 * the 3rd, opened twice, and withdrawn on the 20th" is a question somebody
 * will ask, and a deleted row cannot answer it. The migration's trigger means
 * a revoked row can never be brought back to life by editing — issuing a new
 * link is the only way forward, which is the right one.
 */
export async function revokePortalLink(id: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await getSupabase()
    .from("portal_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
