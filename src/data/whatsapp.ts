import { getDb, hasBackend } from "./backend";
import { fnPath, fnToken } from "./functions";

/**
 * WhatsApp, from the browser's side.
 *
 * THE BROWSER NEVER SENDS A WHATSAPP MESSAGE. It says which template and
 * which record; the server reads the record, decides whether this customer
 * may be messaged at all, builds the words and sends. Everything a customer
 * reads is settled on the server — see netlify/lib/whatsappSender.mjs — so
 * a tampered page cannot send a customer an invented amount, and nothing
 * here ever sees the WhatsApp token.
 *
 * TWO WAYS IN, and the difference matters:
 *
 *   · `sendWhatsApp` is a person pressing a button. It reports what
 *     happened, including a refusal, because somebody is waiting.
 *   · `notifyWhatsApp` is the CRM reporting that something happened — a
 *     quotation was emailed, an order was marked delivered. It NEVER
 *     throws and never blocks: if WhatsApp is off, or the customer never
 *     consented, or Meta is down, the quotation is still saved and the
 *     order is still delivered. That is the rule the business asked for,
 *     and it is kept here rather than at each of the four call sites.
 */

export interface WhatsAppTarget {
  companyId: string;
  template: string;
  recordType?: string;
  recordId?: string;
  customerId?: string;
  /** The handful of facts a record cannot hold — where licence keys were
   *  emailed, what a payment was against. */
  extra?: { sentTo?: string; against?: string; amount?: number; today?: string };
  /** The quotation, rendered here, for the server to hand to WhatsApp.
   *
   *  THE SERVER CANNOT MAKE ONE. A quotation PDF is built by this app from
   *  the document on screen; there is no renderer on the server at all. So
   *  for the two quotation messages that carry the file, the browser sends
   *  it along and the server passes it to Meta.
   *
   *  Offering it does not promise it will be attached — the preview says
   *  whether it actually will be, because that depends on Meta having
   *  approved the version of the template that takes one. */
  pdf?: { base64: string } | null;
}

export interface WhatsAppPreview {
  ok: true;
  template: string;
  label: string;
  to: string;
  customerId: string;
  customerName: string;
  values: string[];
  /** Facts the record did not have, by their readable names. */
  missing: string[];
  /** The approved wording with the blanks filled, when Meta could be asked. */
  body: string;
  /** Why the wording could not be shown, or why the template will not work. */
  wordingProblem: string;
  /** The quotation PDF that will be attached, named as the customer sees
   *  it. Empty when nothing is attached. */
  documentName?: string;
  /** Why the PDF will not be attached, when one was offered. */
  documentNote?: string;
  /** Why this cannot be sent at all — no consent, no number. */
  blocked: string;
}

export interface WhatsAppSendResult {
  ok: boolean;
  id?: string | null;
  reason?: string;
  alreadySent?: boolean;
  switchedOff?: boolean;
}

export class WhatsAppError extends Error {}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const token = await fnToken();
  const resp = await fetch(fnPath("whatsapp-notify"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new WhatsAppError(String((result as { error?: string })?.error ?? "WhatsApp could not do that."));
  }
  return result as T;
}

/** What this message will say, before anybody confirms it. */
export const previewWhatsApp = (target: WhatsAppTarget): Promise<WhatsAppPreview> =>
  call<WhatsAppPreview>({ ...target, action: "preview" });

/** A person pressing Send. Reports a refusal rather than swallowing it. */
export const sendWhatsApp = (target: WhatsAppTarget): Promise<WhatsAppSendResult> =>
  call<WhatsAppSendResult>({ ...target, action: "send", manual: true });

/**
 * The CRM reporting that something happened.
 *
 * NEVER THROWS. The caller has just saved a quotation or marked an order
 * delivered, and whether a WhatsApp message went out is not allowed to
 * change whether that worked. The result is returned for anyone who wants
 * to show a quiet note; ignoring it entirely is correct too.
 */
export async function notifyWhatsApp(
  target: WhatsAppTarget & { trigger?: string },
): Promise<WhatsAppSendResult> {
  if (!hasBackend() || !target.companyId || !target.template) {
    return { ok: false, reason: "WhatsApp is not available here." };
  }
  try {
    return await call<WhatsAppSendResult>({ ...target, action: "send", manual: false });
  } catch (err) {
    /* Logged, not shown and not thrown. The thing the person actually did
       has already succeeded. */
    console.warn("WhatsApp notification not sent:", err instanceof Error ? err.message : err);
    return { ok: false, reason: err instanceof Error ? err.message : "WhatsApp message not sent." };
  }
}

/** Answer a customer in your own words, inside the 24-hour window. */
export const replyOnWhatsApp = (args: {
  companyId: string; customerId?: string; phone: string; body: string;
}): Promise<WhatsAppSendResult> => call<WhatsAppSendResult>({ ...args, action: "reply" });

/* ── reading the log ─────────────────────────────────────────────────── */

export interface WhatsAppMessage {
  id: string;
  direction: "out" | "in";
  customerId: string | null;
  phone: string;
  contactName: string;
  template: string;
  body: string;
  status: string;
  error: string;
  trigger: string;
  /** The file that went with it, as the customer saw it named. */
  documentName: string;
  at: string;
}

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function toMessage(row: Record<string, unknown>): WhatsAppMessage {
  return {
    id: text(row.id),
    direction: row.direction === "in" ? "in" : "out",
    customerId: text(row.customer_id) || null,
    phone: text(row.phone),
    contactName: text(row.contact_name),
    template: text(row.template),
    body: text(row.body),
    status: text(row.status),
    error: text(row.error),
    trigger: text(row.trigger),
    documentName: text(row.document_name),
    at: text(row.created_at),
  };
}

/** One customer's WhatsApp history, newest first. */
export async function loadCustomerMessages(
  company: string,
  customerId: string,
  limit = 50,
): Promise<WhatsAppMessage[]> {
  if (!hasBackend() || !company || !customerId) return [];
  const { data, error } = await getDb()
    .from("whatsapp_messages")
    .select("*")
    .eq("company_id", company)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data as Record<string, unknown>[] | null) ?? []).map(toMessage);
}

/** Everything, newest first — the Inbox groups it into threads itself. */
export async function loadRecentMessages(company: string, limit = 400): Promise<WhatsAppMessage[]> {
  if (!hasBackend() || !company) return [];
  const { data, error } = await getDb()
    .from("whatsapp_messages")
    .select("*")
    .eq("company_id", company)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data as Record<string, unknown>[] | null) ?? []).map(toMessage);
}

export interface WhatsAppThread {
  phone: string;
  customerId: string | null;
  name: string;
  messages: WhatsAppMessage[];
  /** Their last message to us, which is what opens the 24-hour window. */
  lastInboundAt: string;
  lastAt: string;
  unanswered: boolean;
}

/** How long a customer's message leaves the door open for a free reply. */
export const WINDOW_HOURS = 24;

export function windowOpen(lastInboundAt: string, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  const then = new Date(lastInboundAt);
  if (Number.isNaN(then.getTime())) return false;
  return now.getTime() - then.getTime() < WINDOW_HOURS * 60 * 60 * 1000;
}

/**
 * One thread per number, newest first.
 *
 * BY NUMBER AND NOT BY CUSTOMER, because the 24-hour window belongs to the
 * number — and because a reply from a number nobody has on file is still a
 * conversation somebody has to answer.
 */
export function threadsFrom(messages: readonly WhatsAppMessage[]): WhatsAppThread[] {
  const byPhone = new Map<string, WhatsAppMessage[]>();
  for (const m of messages) {
    if (!m.phone) continue;
    const list = byPhone.get(m.phone) ?? [];
    list.push(m);
    byPhone.set(m.phone, list);
  }

  const threads: WhatsAppThread[] = [];
  for (const [phone, list] of byPhone) {
    const ordered = [...list].sort((a, b) => a.at.localeCompare(b.at));
    const lastInbound = [...ordered].reverse().find((m) => m.direction === "in");
    const last = ordered[ordered.length - 1];
    threads.push({
      phone,
      customerId: ordered.find((m) => m.customerId)?.customerId ?? null,
      name: ordered.find((m) => m.contactName)?.contactName ?? "",
      messages: ordered,
      lastInboundAt: lastInbound?.at ?? "",
      lastAt: last?.at ?? "",
      /* Their message is the last thing in the thread: nobody has answered. */
      unanswered: !!lastInbound && last?.direction === "in",
    });
  }

  return threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/**
 * The eight messages, named the way a person would say them, and which kind
 * of record each is sent about.
 *
 * A COPY, KEPT HONEST BY A TEST. The templates themselves live on the server
 * (netlify/lib/whatsappTemplates.mjs) because the server is what sends them;
 * a screen has to know their names before it can ask for a preview, so the
 * labels are repeated here and `whatsapp.labels.test.ts` fails if either side
 * is changed without the other.
 */
export const WHATSAPP_LABELS: Record<string, string> = {
  quotation_sent: "Quotation sent",
  quotation_followup: "Quotation follow-up",
  order_delivered: "Order delivered",
  licence_delivered: "Licence keys sent",
  payment_due_reminder: "Payment due in 3 days",
  payment_overdue_reminder: "Payment overdue",
  payment_received: "Payment received",
  renewal_reminder: "Renewal in 30 days",
};

/** Which messages can be sent about each kind of record. */
export const WHATSAPP_FOR: Record<string, readonly string[]> = {
  quote: ["quotation_sent", "quotation_followup"],
  order: ["order_delivered", "licence_delivered"],
  bill: ["payment_due_reminder", "payment_overdue_reminder", "payment_received"],
  subscription: ["renewal_reminder"],
};

/** The label, or the name tidied up, so an unknown template still reads. */
export const whatsappLabel = (template: string): string =>
  WHATSAPP_LABELS[template]
  ?? String(template ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
