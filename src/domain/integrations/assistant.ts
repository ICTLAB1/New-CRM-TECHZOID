import { kpis, needsAttention, scopeWorkspace, teamPerformance, type DashboardUser, type Workspace } from "../analytics/dashboard";
import { effectiveStatus } from "../documents/create";
import { daysLeft, type Subscription } from "../subscriptions/expiry";
import { isOpenStage } from "../pipeline/stages";
import { inrShort } from "../currency/format";
import type { Customer } from "../customers/customer";

/**
 * What the assistant is told about the CRM.
 *
 * Built by summarising, never by dumping records: a snapshot that fits in a
 * few hundred lines answers "which deals are stuck" as well as the raw table
 * would, costs a fraction as much, and — the part that matters — means the
 * whole customer list never leaves the browser.
 *
 * SCOPED FIRST. The snapshot is built from `scopeWorkspace`, so a Sales user's
 * assistant can only summarise that user's own deals. Row-level security
 * already narrows what their browser holds; this makes the narrowing explicit
 * rather than depending on it.
 */

export interface AssistantUser extends DashboardUser {
  name: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
}

const money = (n: number): string => inrShort(n);

const list = (names: (string | undefined)[], max = 5): string =>
  names.slice(0, max).join(", ") + (names.length > max ? `, and ${names.length - max} more` : "");

export function buildCrmContext(
  full: Workspace,
  user: AssistantUser,
  team: TeamMember[],
  sellerState: string,
  companyName: string,
  now: Date = new Date(),
): string {
  const ws = scopeWorkspace(full, user);
  const today = now.toISOString().slice(0, 10);
  const k = kpis(ws, sellerState, now);

  const open = ws.customers.filter((c) => isOpenStage(c.stage));
  const won = ws.customers.filter((c) => c.stage === "won");
  const lost = ws.customers.filter((c) => c.stage === "lost");
  const overdue = open.filter((c) => c.nextFollowUp && c.nextFollowUp <= today);
  const top = [...won].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)).slice(0, 5);

  const expiring = ws.subscriptions.filter((s) => {
    const d = daysLeft(s, now);
    return d >= 0 && d <= 30 && s.status !== "Renewed" && s.status !== "Cancelled";
  });
  const expired = ws.subscriptions.filter(
    (s) => daysLeft(s, now) < 0 && s.status !== "Renewed" && s.status !== "Cancelled",
  );

  const attention = needsAttention(ws, sellerState, now).slice(0, 8);
  const perTeam = teamPerformance(ws, team, now);

  const recent = ws.customers
    .flatMap((c: Customer) => (c.notes ?? []).map((n) => ({ ...n, company: c.company })))
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    .slice(0, 10);

  const sections = [
    `You are the assistant inside ${companyName}'s sales CRM.`,
    `You are speaking to ${user.name} (${user.role}). Today is ${today}.`,
    "",
    "Answer only from the snapshot below. If it doesn't contain the answer, say so and name the screen that would — never guess a figure.",
    "Amounts are already formatted; repeat them as written rather than recalculating.",
    "",
    "=== SNAPSHOT ===",
    "",
    "PIPELINE",
    `- Open: ${k.openDeals} deals worth ${money(k.openPipeline)}`,
    `- Won this month: ${k.wonThisMonthCount} worth ${money(k.wonThisMonth)}`,
    `- Won overall: ${won.length}; lost: ${lost.length}`,
    `- Follow-ups overdue: ${overdue.length}${overdue.length ? ` (${list(overdue.map((c) => c.company))})` : ""}`,
    "",
    "QUOTATIONS AND PAYMENTS",
    `- Awaiting a reply: ${k.quotesPending}`,
    `- Sent but past their validity date: ${k.quotesStale}`,
    `- Proforma payments outstanding: ${money(k.paymentsDue)} across ${ws.proformas.filter((p) => effectiveStatus(p, today) !== "Draft").length} documents, ${k.paymentsOverdue} overdue`,
    "",
    "RENEWALS",
    `- Due within 30 days: ${expiring.length} worth ${money(k.renewalsValue)}`,
    `- Already expired and not renewed: ${expired.length}`,
    `- Active subscriptions: ${ws.subscriptions.filter((s: Subscription) => s.status === "Active").length}`,
    "",
    "NEEDS ATTENTION (most urgent first)",
    attention.length
      ? attention.map((a) => `- ${a.title}: ${a.detail}`).join("\n")
      : "- Nothing outstanding.",
    "",
    "TOP CUSTOMERS BY VALUE",
    top.length ? top.map((c, i) => `${i + 1}. ${c.company} — ${money(Number(c.value) || 0)} (${c.stage})`).join("\n") : "- None yet.",
    "",
    "RECENT ACTIVITY",
    recent.length
      ? recent.map((n) => `- ${n.company}: [${n.type || "Note"}] ${String(n.text ?? "").slice(0, 80)}`).join("\n")
      : "- Nothing logged.",
    "",
    "TEAM",
    perTeam.length
      ? perTeam.map((t) => `- ${t.name}: ${t.openDeals} open worth ${money(t.openValue)}, ${money(t.wonValue)} won, ${t.quotations} quotations`).join("\n")
      : "- Just you.",
  ];

  return sections.join("\n");
}

/** Openers. Each one is answerable from the snapshot above — a suggested
 *  question the assistant cannot answer teaches people not to trust it. */
export const SUGGESTED_QUESTIONS: readonly string[] = [
  "Which customers need a follow-up today?",
  "What does my open pipeline look like?",
  "Which quotations are still waiting for a reply?",
  "Which subscriptions expire in the next month?",
  "Who are my largest customers by value?",
  "Which deals have gone quiet?",
];
