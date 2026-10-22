import { fnPath, fnToken } from "./functions";

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

export interface MailFolder {
  id: string;
  name: string;
  unread: number;
  total: number;
}

export interface MailDraft {
  to: string;
  cc?: string;
  /** Blind copies. Sent, and deliberately never read back — Graph does not
   *  return them on a read, which is the point of them. */
  bcc?: string;
  subject: string;
  body: string;
}

export interface MailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

export interface MailResult<T> {
  data?: T;
  error?: string;
  /** The mailbox is not connected, or the grant lapsed. The screen offers
   *  the button rather than reporting a fault. */
  needsConsent?: boolean;
}

async function call<T>(body: Record<string, unknown>): Promise<MailResult<T>> {
  try {
    const token = await fnToken();
    const resp = await fetch(fnPath("mail-inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.status === 409) return { error: String(json.error ?? "Your mailbox isn't connected."), needsConsent: true };
    if (!resp.ok) return { error: String(json.error ?? `Could not reach the mailbox (${resp.status}).`) };
    return { data: json as T };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export const listFolders = () => call<{ folders: MailFolder[]; mailbox: string }>({ action: "folders" });

export const listMail = (opts: { folder?: string; skip?: number; search?: string } = {}) =>
  call<{ messages: MailMessage[]; mailbox: string }>({ action: "list", ...opts });

export const readMail = (id: string) => call<{ message: MailMessage; mailbox: string }>({ action: "read", id });

export const markMail = (id: string, markRead: boolean) => call<{ ok: boolean }>({ action: "markRead", id, markRead });

export const saveNewDraft = (draft: MailDraft) => call<{ id: string }>({ action: "draft", ...draft });

export const saveDraft = (id: string, draft: MailDraft) => call<{ id: string }>({ action: "saveDraft", id, ...draft });

export const sendDraft = (id: string) => call<{ ok: boolean }>({ action: "send", id });

export const sendNow = (draft: MailDraft) => call<{ ok: boolean }>({ action: "sendNew", ...draft });

export const deleteMail = (id: string) => call<{ ok: boolean }>({ action: "delete", id });

export const moveMail = (id: string, folderId: string) => call<{ ok: boolean }>({ action: "move", id, folderId });

export const listAttachments = (id: string) =>
  call<{ attachments: MailAttachment[] }>({ action: "attachments", id });

export const getAttachment = (id: string, attachmentId: string) =>
  call<{ attachment: { name: string; contentType: string; base64: string } }>(
    { action: "attachment", id, attachmentId });

export const attachToDraft = (id: string, file: { name: string; contentType: string; base64: string }) =>
  call<{ ok: boolean }>({ action: "attach", id, ...file });

/** Graph takes an attachment inline up to about 3 MB; past that it wants an
 *  upload session, which is a different protocol. Checked before anything is
 *  sent, so nobody writes an email and then loses it to a 413. */
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

/** A File as base64, without the data: prefix Graph will not accept. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result ?? "").replace(/^data:[^,]*,/, ""));
    reader.readAsDataURL(file);
  });
}
