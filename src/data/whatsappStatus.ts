import { hasBackend } from "./backend";
import { fnPath, fnToken } from "./functions";

/**
 * What the WhatsApp setup actually looks like, asked of Meta.
 *
 * Separate from data/whatsapp.ts because nothing here sends anything: the
 * settings screen asks this on every visit, and it must be a read that
 * cannot possibly message a customer.
 */

export interface WhatsAppTemplateStatus {
  name: string;
  label: string;
  when: string;
  autoKey: string;
  blanks: number;
  approved: boolean;
  problem: string;
}

export interface WhatsAppStatus {
  configured: boolean;
  wabaConfigured: boolean;
  verifyTokenSet: boolean;
  signatureChecked: boolean;
  error: string;
  templates: WhatsAppTemplateStatus[];
}

export async function whatsappStatus(companyId: string | null): Promise<WhatsAppStatus | null> {
  if (!hasBackend() || !companyId) return null;

  const token = await fnToken();
  const resp = await fetch(fnPath("whatsapp-notify"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: "status", companyId }),
  });

  if (!resp.ok) return null;
  const result = (await resp.json().catch(() => null)) as WhatsAppStatus | null;
  return result && Array.isArray(result.templates) ? result : null;
}
