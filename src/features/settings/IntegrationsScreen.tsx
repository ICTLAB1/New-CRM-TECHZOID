import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Field, Input } from "../../components/primitives";
import { Confirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { diagnosticLines, isReady, nextAction, type Diagnostics } from "../../domain/integrations/diagnostics";
import { IntegrationError, type IntegrationsApi, type MailboxConnection } from "../../integrations/api";

/**
 * Settings → Integrations.
 *
 * Three connections, each with the same shape: what it does, whether it is
 * on, and — for whoever has to set it up — exactly what to do next. The
 * setup instructions are here rather than in a manual because the person
 * following them is already in this screen with the Azure portal in the
 * next tab.
 */

export interface IntegrationsScreenProps {
  api: IntegrationsApi;
  user: { id: string; name: string; role: string };
  settings: Record<string, unknown>;
  onSettingsChange: (next: Record<string, unknown>) => void;
}

const isAdmin = (role: string) => role === "Admin";

export function IntegrationsScreen({ api, user, settings, onSettingsChange }: IntegrationsScreenProps) {
  return (
    <main className="page">
      <PageHead
        title="Integrations"
        sub="Email, WhatsApp and the assistant. Each one is optional — nothing here blocks the CRM."
      />
      <div className="stack" style={{ maxWidth: 760 }}>
        <MailboxPanel api={api} user={user} />
        <WhatsAppPanel />
        <AssistantPanel />
        <InvoicingPanel settings={settings} onChange={onSettingsChange} canEdit={isAdmin(user.role)} />
      </div>
    </main>
  );
}

/* ── Microsoft 365 ─────────────────────────────────────────────────── */

function MailboxPanel({ api, user }: { api: IntegrationsApi; user: { role: string } }) {
  const toast = useToast();
  const [mailbox, setMailbox] = useState<MailboxConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMailbox(await api.mailbox());
    } catch {
      /* Not being able to read the connection is not worth an alarm: the
         panel simply shows "not connected", which is also the safe default. */
      setMailbox(null);
    }
    setLoading(false);
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    setError(""); setBusy(true);
    try {
      const url = await api.startMailboxConnection();
      /* A full redirect, not a popup. Popups are blocked often enough that
         the support cost outweighs keeping the page. */
      window.location.href = url;
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't start the connection.");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setConfirmDisconnect(false);
    setError(""); setBusy(true);
    try {
      await api.disconnectMailbox();
      setMailbox(null);
      toast("Microsoft 365 mailbox disconnected");
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't disconnect the mailbox.");
    }
    setBusy(false);
  };

  return (
    <Card
      title="Microsoft 365 mailbox"
      actions={loading ? null : mailbox ? <Chip tone="good">Connected</Chip> : <Chip tone="neutral">Not connected</Chip>}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Connect your own Microsoft 365 account and quotations, proformas and reminders go out from your
        address — customers reply straight to you, and a copy lands in your Sent Items. Everyone connects
        their own mailbox; this is not a shared setting.
      </p>

      <div className="notice notice-flat" style={{ marginTop: 12 }}>
        {loading ? (
          <span className="muted">Checking…</span>
        ) : mailbox ? (
          <div className="spread wrap" style={{ width: "100%", gap: 10 }}>
            <span>
              Sending as <strong>{mailbox.email || mailbox.displayName || "your Microsoft account"}</strong>
            </span>
            <Button size="sm" tone="quiet" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="spread wrap" style={{ width: "100%", gap: 10 }}>
            <span className="muted">Emails send from the shared company address.</span>
            <Button size="sm" tone="primary" disabled={busy} onClick={() => void connect()}>
              {busy ? "Opening Microsoft…" : "Connect Microsoft 365"}
            </Button>
          </div>
        )}
      </div>

      {error ? <div className="notice notice-bad" style={{ marginTop: 10 }}>{error}</div> : null}

      <p className="field-hint" style={{ marginTop: 12 }}>
        The CRM asks for permission to <strong>send</strong> mail as you, and nothing else. It cannot read
        your inbox — the consent screen will say the same.
      </p>

      {isAdmin(user.role) ? (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
          <Button size="sm" tone="default" onClick={() => setShowSetup((v) => !v)}>
            {showSetup ? "Hide the one-time setup" : "One-time setup for the company"}
          </Button>
          {showSetup ? <AzureSetup api={api} /> : null}
        </div>
      ) : null}

      <Confirm
        open={confirmDisconnect}
        title="Disconnect your mailbox?"
        body="Your quotations will go out from the shared company address instead. You can reconnect at any time."
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={() => void disconnect()}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </Card>
  );
}

/* ── the guided Azure registration ─────────────────────────────────── */

function useCopy() {
  const toast = useToast();
  return async (value: string, label = value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(label + " copied");
    } catch {
      /* Denied permission, or an insecure origin. Say what to do instead. */
      toast("Couldn't copy — select the text and copy it manually", "warn");
    }
  };
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const copyText = useCopy();
  const copy = () => void copyText(value, label);
  return (
    <div className="copy-row">
      <code>{value}</code>
      <Button size="sm" tone="quiet" onClick={copy} aria-label={"Copy " + label}>Copy</Button>
    </div>
  );
}

function AzureSetup({ api }: { api: IntegrationsApi }) {
  const copyText = useCopy();
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  /* The value Azure must be given, derived from where this page is actually
     running. The path is fixed: the deployed app registration points at it,
     and changing it breaks every existing connection. */
  const redirectUri =
    (typeof window === "undefined" ? "https://crm.ttpldelhi.com" : window.location.origin) +
    "/.netlify/functions/ms-oauth-callback";

  const check = useCallback(async () => {
    setError(""); setChecking(true);
    try {
      setDiag(await api.diagnostics());
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't run the check.");
      setDiag(null);
    }
    setChecking(false);
  }, [api]);

  useEffect(() => { void check(); }, [check]);

  const todo = diag ? nextAction(diag) : null;

  return (
    <div style={{ marginTop: 14 }}>
      <p className="muted" style={{ marginTop: 0 }}>
        Done once for the whole company, by someone with access to both the Microsoft 365 tenant and the
        Netlify site. After this, everyone else just presses Connect.
      </p>

      <ol className="steps" style={{ marginTop: 16 }}>
        <li className="step">
          <div className="step-body">
            <div className="step-title">Create the app registration</div>
            <div>
              Open <a href="https://portal.azure.com" target="_blank" rel="noopener noreferrer">portal.azure.com</a> →
              Microsoft Entra ID → App registrations → <strong>New registration</strong>. Name it anything.
              Under supported account types choose <strong>Accounts in this organizational directory only</strong>,
              which stops anyone outside the company connecting.
            </div>
          </div>
        </li>

        <li className="step">
          <div className="step-body">
            <div className="step-title">Set the redirect URI</div>
            <div>Platform <strong>Web</strong>, and this address exactly:</div>
            <CopyRow label="Redirect URI" value={redirectUri} />
            <div className="field-hint">
              Character for character. Microsoft compares the whole string and refuses on any difference.
            </div>
          </div>
        </li>

        <li className="step">
          <div className="step-body">
            <div className="step-title">Add the send permission</div>
            <div>
              API permissions → Add a permission → Microsoft Graph → <strong>Delegated permissions</strong>.
              Tick <code className="mono">Mail.Send</code>, <code className="mono">User.Read</code> and{" "}
              <code className="mono">offline_access</code>, then Add.
            </div>
            <div className="field-hint">
              Delegated, not Application. The CRM sends as the signed-in person, never as the whole tenant.
            </div>
          </div>
        </li>

        <li className="step">
          <div className="step-body">
            <div className="step-title">Create a client secret</div>
            <div>
              Certificates &amp; secrets → New client secret. Copy the <strong>Value</strong> immediately —
              it is shown once and never again.
            </div>
            <div className="field-hint">
              The Value, not the Secret ID. Pasting the ID is the single most common mistake here, and the
              check below will tell you if you have.
            </div>
          </div>
        </li>

        <li className="step">
          <div className="step-body">
            <div className="step-title">Add the variables in Netlify</div>
            <div>Site configuration → Environment variables:</div>
            <div className="stack" style={{ gap: 6 }}>
              {[
                ["MS_CLIENT_ID", "the Application (client) ID from the app's Overview page"],
                ["MS_TENANT_ID", "the Directory (tenant) ID from the same page"],
                ["MS_CLIENT_SECRET", "the secret Value from step 4"],
                ["MS_REDIRECT_URI", "the address from step 2"],
              ].map(([name, what]) => (
                <div className="copy-row compact" key={name}>
                  <code>{name}</code>
                  <span className="field-hint">= {what}</span>
                  <Button size="sm" tone="quiet" onClick={() => void copyText(name!)} aria-label={"Copy " + name}>Copy</Button>
                </div>
              ))}
            </div>
          </div>
        </li>

        <li className="step">
          <div className="step-body">
            <div className="step-title">Create the database table</div>
            <div>
              In Supabase → SQL Editor, run <code className="mono">supabase/003_ms_mail_accounts.sql</code>.
              It stores each person's connection, locked so nobody can read anyone else's.
            </div>
          </div>
        </li>

        <li className="step">
          <div className="step-body">
            <div className="step-title">Redeploy</div>
            <div>
              Netlify reads environment variables at build time, so trigger a fresh deploy — then re-check below.
            </div>
          </div>
        </li>
      </ol>

      <Card
        title="Setup status"
        className="stack"
        actions={<Button size="sm" tone="quiet" disabled={checking} onClick={() => void check()}>
          {checking ? "Checking…" : "Re-check"}
        </Button>}
      >
        {error ? <div className="notice notice-bad">{error}</div> : null}
        {!error && !diag ? <span className="muted">Checking…</span> : null}
        {diag ? (
          <>
            {diagnosticLines(diag).map((line) => (
              <div className="status-line" key={line.label}>
                <span className={"status-mark " + (line.ok ? "is-good" : "is-bad")} aria-hidden="true">
                  {line.ok ? "✓" : "✕"}
                </span>
                <span>
                  <span className="mono">{line.label}</span>
                  {line.detail ? <span className="status-detail"> — {line.detail}</span> : null}
                </span>
              </div>
            ))}

            {todo ? (
              <div className="notice" style={{ marginTop: 12 }}>
                <span><strong>Next:</strong> {todo}</span>
              </div>
            ) : null}

            {isReady(diag) ? (
              <div className="notice notice-good" style={{ marginTop: 12 }}>
                Setup complete — everyone can now press <strong>Connect Microsoft 365</strong>.
              </div>
            ) : null}
          </>
        ) : null}
      </Card>

      <p className="field-hint" style={{ marginTop: 12 }}>
        Welcome emails for brand-new team members still go through the shared sender: a new account has no
        mailbox connected yet.
      </p>
    </div>
  );
}

/* ── WhatsApp ──────────────────────────────────────────────────────── */

function WhatsAppPanel() {
  return (
    <Card title="WhatsApp" actions={<Chip tone="neutral" dot={false}>Optional</Chip>}>
      <p className="muted" style={{ marginTop: 0 }}>
        With a provider connected, "Send now" delivers quotations, proformas and renewal reminders straight
        from the CRM. Without one, every WhatsApp dialog still offers <strong>Open in WhatsApp instead</strong>,
        which needs no setup and opens WhatsApp with the message already written. Nothing is ever blocked.
      </p>

      <div className="notice" style={{ marginTop: 12 }}>
        <span>
          There is no way to test this connection without sending a real message to a real person, so the CRM
          doesn't pretend to: the first "Send now" is the test.
        </span>
      </div>

      <div style={{ marginTop: 16 }}>
        <span className="eyebrow">One-time setup</span>
        <ol className="steps" style={{ marginTop: 10 }}>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Sign up with a QR-linked provider</div>
              <div>Use the phone number customers should see the message coming from.</div>
            </div>
          </li>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Link the number</div>
              <div>
                In the provider's dashboard, scan the QR code from WhatsApp on that phone
                (Settings → Linked Devices) — the same pairing as WhatsApp Web.
              </div>
            </div>
          </li>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Add the token in Netlify</div>
              <div>
                Site configuration → Environment variables → <code className="mono">WHATSAPP_API_TOKEN</code>,
                then redeploy. No code changes.
              </div>
            </div>
          </li>
        </ol>
      </div>

      <div className="notice" style={{ marginTop: 14 }}>
        <span>
          <strong>Worth knowing:</strong> QR-linked services are not WhatsApp's official business channel —
          they automate WhatsApp Web. They are cheaper and quicker to set up than the official Business API,
          at the risk of the number being logged out or restricted without warning.
        </span>
      </div>
    </Card>
  );
}

/* ── assistant ─────────────────────────────────────────────────────── */

function AssistantPanel() {
  return (
    <Card title="Assistant" actions={<Chip tone="neutral" dot={false}>Optional</Chip>}>
      <p className="muted" style={{ marginTop: 0 }}>
        Answers questions about what is in the CRM — overdue follow-ups, quotations awaiting a reply,
        renewals coming up. It is given a summary of your own records, never the records themselves, and it
        is told to say when it doesn't know rather than produce a number.
      </p>
      <div className="notice notice-flat" style={{ marginTop: 12 }}>
        <span>
          Add <code className="mono">ANTHROPIC_API_KEY</code> in Netlify → Site configuration → Environment
          variables, then redeploy. Each question is billed to that key, so the CRM only answers signed-in
          users and caps how many questions each person can ask per hour.
        </span>
      </div>
    </Card>
  );
}

/* ── invoicing addresses ───────────────────────────────────────────── */

function InvoicingPanel({
  settings, onChange, canEdit,
}: {
  settings: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [to, setTo] = useState(String(settings["invoicingEmail"] ?? ""));
  const [cc, setCc] = useState(String(settings["invoicingCc"] ?? ""));

  const save = () => {
    onChange({ ...settings, invoicingEmail: to.trim(), invoicingCc: cc.trim() });
    toast("Invoicing addresses saved");
  };

  const dirty = to.trim() !== String(settings["invoicingEmail"] ?? "") || cc.trim() !== String(settings["invoicingCc"] ?? "");

  return (
    <Card
      title="Send for invoicing"
      actions={dirty && canEdit ? <Button size="sm" tone="primary" onClick={save}>Save</Button> : null}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Where the "Send for invoicing" button on a quotation or proforma sends to. Everyone can use the
        button; only an admin sets the address.
      </p>
      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <Field label="Accounts address" hint="The tax invoice request goes here, with the PDF attached.">
          <Input type="email" value={to} disabled={!canEdit} onChange={(e) => setTo(e.target.value)}
            placeholder="accounts@example.com" />
        </Field>
        <Field label="Copy to" hint="Optional. Comma-separate more than one.">
          <Input value={cc} disabled={!canEdit} onChange={(e) => setCc(e.target.value)}
            placeholder="finance@example.com" />
        </Field>
      </div>
      {!to.trim() ? (
        <div className="notice" style={{ marginTop: 12 }}>
          <span>No address is set, so "Send for invoicing" will tell people to ask an admin rather than fail quietly.</span>
        </div>
      ) : null}
    </Card>
  );
}
