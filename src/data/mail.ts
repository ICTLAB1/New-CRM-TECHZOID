import { fnPath, fnToken } from "./functions";

/** One message as the screen shows it. */
export interface MailMessage {
  id: string;
  conversationId: string;
  subject: string;
  preview: string;
  from: { name: string; address: string };
  to: string[];
  cc?: string[];
  receivedAt: string;
  unread: boolean;
  hasAttachments: boolean;
  contentType?: string;
  content?: string;
}

export interface MailResult<T> {
  data?: T;
  error?: string;
  /** The inbox has not been connected, or the grant has lapsed. The screen
   *  offers the button rather than reporting a fault. */
  needsConsent?: boolean;
}

async function call<T>(body: unknown): Promise<MailResult<T>> {
  try {
    const token = await fnToken();
    const resp = await fetch(fnPath("mail-inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.status === 409) return { error: String(json.error ?? "Your inbox isn't connected."), needsConsent: true };
    if (!resp.ok) return { error: String(json.error ?? `Could not read the mailbox (${resp.status}).`) };
    return { data: json as T };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export const listMail = (opts: { folder?: string; skip?: number; search?: string } = {}) =>
  call<{ messages: MailMessage[]; mailbox: string }>(opts);

export const readMail = (id: string) =>
  call<{ message: MailMessage; mailbox: string }>({ id });

export const markMail = (id: string, markRead: boolean) =>
  call<{ ok: boolean }>({ id, markRead });
