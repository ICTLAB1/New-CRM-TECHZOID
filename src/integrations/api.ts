import type { Diagnostics } from "../domain/integrations/diagnostics";

/**
 * Everything the browser asks the server to do on its behalf.
 *
 * One interface, because these calls all share a shape — a signed-in session,
 * a Netlify function, and an error that has to be readable by whoever is
 * standing at the screen. Screens take an implementation rather than reaching
 * for `fetch` themselves, so a panel can be rendered and tested without a
 * deployment behind it.
 */

export interface MailboxConnection {
  email: string;
  displayName: string;
  connectedAt?: string;
}

export interface EmailRequest {
  to: string;
  cc?: string;
  subject: string;
  message: string;
  attachment?: { base64: string; filename: string } | null;
}

export interface EmailResult {
  via: "microsoft" | "resend";
  from?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TeamMemberInput {
  email: string;
  password: string;
  name: string;
  role: string;
}

export interface CreatedMember {
  userId: string;
  emailSent: boolean;
  /** Present when the account was created but the welcome email wasn't sent.
   *  Not an error — the account is real either way. */
  emailError?: string | null;
  warning?: string | null;
}

export interface IntegrationsApi {
  mailbox(): Promise<MailboxConnection | null>;
  /** Returns the Microsoft consent URL to send the browser to. */
  startMailboxConnection(): Promise<string>;
  disconnectMailbox(): Promise<void>;
  diagnostics(): Promise<Diagnostics>;

  sendEmail(request: EmailRequest): Promise<EmailResult>;
  sendWhatsApp(to: string, message: string): Promise<void>;
  ask(system: string, messages: ChatMessage[]): Promise<string>;

  createTeamMember(input: TeamMemberInput): Promise<CreatedMember>;
  updateTeamMember(userId: string, patch: { name?: string; email?: string }): Promise<void>;
  resetTeamPassword(userId: string, newPassword: string): Promise<void>;
  deleteTeamMember(userId: string): Promise<void>;

  /** Kicks off delivery of one outbound webhook event. Fire-and-forget by
   *  design — the server decides whether webhooks are even configured, and
   *  a failure here must never surface as an app error, so callers should
   *  not let a rejection here interrupt anything the user is doing. */
  sendWebhookEvent(eventKind: string, payload: Record<string, unknown>): Promise<void>;
  /** Admin-only. Generates a brand-new signing secret and returns it in
   *  plaintext — the only moment it is ever readable again. */
  regenerateWebhookSecret(): Promise<string>;
}

/**
 * An error carrying a message meant for a person.
 *
 * The functions never return internals, so whatever arrives here is already
 * safe and already phrased as an instruction — show it as it is rather than
 * wrapping it in "Error: ".
 */
export class IntegrationError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "IntegrationError";
    this.status = status;
  }
}

const FN = "/.netlify/functions/";

async function authHeader(): Promise<Record<string, string>> {
  const { getSupabase } = await import("../data/supabase");
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new IntegrationError("Your session has ended. Sign in again.", 401);
  return { "Content-Type": "application/json", Authorization: "Bearer " + token };
}

async function call<T>(name: string, init: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(FN + name, init);
  } catch {
    /* A network failure, not a refusal. Say which, because "try again" is
       right for one and wrong for the other. */
    throw new IntegrationError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  const payload = await resp.json().catch(() => ({}) as Record<string, unknown>);
  if (!resp.ok) {
    const message = typeof payload.error === "string" ? payload.error : "That didn't work. Please try again.";
    throw new IntegrationError(message, resp.status);
  }
  return payload as T;
}

async function post<T>(name: string, body: unknown): Promise<T> {
  return call<T>(name, { method: "POST", headers: await authHeader(), body: JSON.stringify(body ?? {}) });
}

/** The real thing: Supabase for what row-level security already guards,
 *  Netlify functions for everything needing a secret. */
export function netlifyApi(): IntegrationsApi {
  const adminCall = <T>(action: string, body: Record<string, unknown> = {}) =>
    post<T>("admin-users", { action, ...body });

  return {
    async mailbox() {
      const { getSupabase } = await import("../data/supabase");
      const supabase = getSupabase();
      const { data: session } = await supabase.auth.getUser();
      const id = session.user?.id;
      if (!id) return null;
      /* Read directly: the row is the user's own, and the policy on
         ms_mail_accounts is what makes that safe. The refresh token column
         is never selected — the browser has no use for it. */
      const { data } = await supabase
        .from("ms_mail_accounts")
        .select("ms_email, ms_display_name, updated_at")
        .eq("user_id", id)
        .maybeSingle();
      if (!data) return null;
      return {
        email: data.ms_email ?? "",
        displayName: data.ms_display_name ?? "",
        connectedAt: data.updated_at ?? undefined,
      };
    },

    async startMailboxConnection() {
      const { url } = await post<{ url: string }>("ms-oauth-start", {});
      return url;
    },

    async disconnectMailbox() {
      const { getSupabase } = await import("../data/supabase");
      const supabase = getSupabase();
      const { data: session } = await supabase.auth.getUser();
      const id = session.user?.id;
      if (!id) throw new IntegrationError("Your session has ended. Sign in again.", 401);
      const { error } = await supabase.from("ms_mail_accounts").delete().eq("user_id", id);
      if (error) throw new IntegrationError("Couldn't disconnect the mailbox. Try again in a moment.", 500);
    },

    async diagnostics() {
      return call<Diagnostics>("ms-diagnostics", { method: "GET", headers: await authHeader() });
    },

    async sendEmail(request) {
      return post<EmailResult>("email-send", {
        to: request.to,
        cc: request.cc,
        subject: request.subject,
        message: request.message,
        attachmentBase64: request.attachment?.base64,
        attachmentName: request.attachment?.filename,
      });
    },

    async sendWhatsApp(to, message) {
      await post("whatsapp-send", { to, message });
    },

    async ask(system, messages) {
      const { text } = await post<{ text: string }>("ai-proxy", { system, messages });
      return text;
    },

    createTeamMember: (input) => adminCall<CreatedMember>("create_user", { ...input }),
    updateTeamMember: async (userId, patch) => { await adminCall("update_user", { userId, ...patch }); },
    resetTeamPassword: async (userId, newPassword) => { await adminCall("reset_password", { userId, newPassword }); },
    deleteTeamMember: async (userId) => { await adminCall("delete_user", { userId }); },

    async sendWebhookEvent(eventKind, payload) {
      await post("webhook-deliver-background", { eventKind, payload });
    },

    async regenerateWebhookSecret() {
      const { getSupabase } = await import("../data/supabase");
      const { data, error } = await getSupabase().rpc("regenerate_webhook_secret");
      if (error) throw new IntegrationError(error.message || "Couldn't generate a new secret.", 400);
      return String(data ?? "");
    },
  };
}

/**
 * The implementation the demo build runs on.
 *
 * It refuses, and says why. A preview that pretends to send a real email to a
 * real customer is worse than one that admits it cannot: the first teaches
 * someone the button works.
 */
export function demoApi(): IntegrationsApi {
  const refuse = (what: string): never => {
    throw new IntegrationError(`${what} needs a deployed site — this preview has no server behind it.`, 501);
  };
  return {
    mailbox: async () => null,
    startMailboxConnection: async () => refuse("Connecting a mailbox"),
    disconnectMailbox: async () => refuse("Disconnecting a mailbox"),
    diagnostics: async () => refuse("The setup check"),
    sendEmail: async () => refuse("Sending email"),
    sendWhatsApp: async () => refuse("Sending WhatsApp messages"),
    ask: async () => refuse("The assistant"),
    createTeamMember: async () => refuse("Creating an account"),
    updateTeamMember: async () => refuse("Editing an account"),
    resetTeamPassword: async () => refuse("Resetting a password"),
    deleteTeamMember: async () => refuse("Removing an account"),

    /* Nothing leaves this browser in preview — the banner says so. A silent
       no-op is correct here (unlike `refuse`): this fires from background
       pipeline activity nobody is watching a button for, not a deliberate
       action whose failure needs explaining. */
    sendWebhookEvent: async () => {},
    regenerateWebhookSecret: async () => refuse("Generating a webhook signing secret"),
  };
}
