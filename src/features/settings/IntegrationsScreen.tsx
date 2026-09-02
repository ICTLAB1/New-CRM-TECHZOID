import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Field, Input, Select } from "../../components/primitives";
import { Confirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { diagnosticLines, isReady, nextAction, type Diagnostics } from "../../domain/integrations/diagnostics";
import { IntegrationError, type IntegrationsApi, type MailboxConnection } from "../../integrations/api";
import { integrationStatus, testVerificationConnection, type IntegrationStatus } from "../../data/verification";

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
  /** The team, for choosing who owns a lead the website creates. */
  users: { id: string; name: string; role?: string }[];
  settings: Record<string, unknown>;
  onSettingsChange: (next: Record<string, unknown>) => void;
}

const isAdmin = (role: string) => role === "Admin";

export function IntegrationsScreen({ api, user, users, settings, onSettingsChange }: IntegrationsScreenProps) {
  /* Which keys are set, asked once when the screen opens. Null while it is
     still being asked, and null for good when it cannot be — a panel
     showing nothing beats one claiming "not connected" because it could not
     reach the server to find out. */
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  useEffect(() => { void integrationStatus().then(setStatus); }, []);

  return (
    <main className="page">
      <PageHead
        title="Integrations"
        sub="Email, WhatsApp and the assistant. Each one is optional — nothing here blocks the CRM."
      />
      <div className="stack" style={{ maxWidth: 760 }}>
        <MailboxPanel api={api} user={user} />
        <WhatsAppPanel status={status} />
        <VerificationPanel status={status} />
        <AssistantPanel />
        <InvoicingPanel settings={settings} onChange={onSettingsChange} canEdit={isAdmin(user.role)} />
        <WebhooksPanel
          api={api}
          settings={settings}
          users={users}
          onChange={onSettingsChange}
          canEdit={isAdmin(user.role) || user.role === "Manager"}
          isAdmin={isAdmin(user.role)}
        />
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
            <Button loading={busy} loadingLabel="Opening Microsoft…" size="sm" tone="primary" disabled={busy} onClick={() => void connect()}>
              Connect Microsoft 365
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
          <AdminConsent />
          <div style={{ marginTop: 14 }}>
            <Button size="sm" tone="default" onClick={() => setShowSetup((v) => !v)}>
              {showSetup ? "Hide the one-time setup" : "One-time setup for the company"}
            </Button>
          </div>
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
            <div className="field-hint">
              <strong>Not Mail.Read.</strong> It was on this list and has been taken off. Reply
              detection — noticing when a prospect answers, so a sequence stops chasing them — is not
              built yet, so asking for it now would be a permission granted and never used. Worse,
              every change to this list sends everybody back to “Need admin approval”, including
              people an administrator had already approved. It will be asked for at the point that
              feature is switched on, by the person switching it on.
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

function WhatsAppPanel({ status }: { status: IntegrationStatus | null }) {
  return (
    <Card title="WhatsApp" actions={<Chip tone="neutral" dot={false}>Optional</Chip>}>
      <p className="muted" style={{ marginTop: 0 }}>
        There are <strong>two</strong> WhatsApp channels here and they are set up separately, because they do
        different jobs and WhatsApp treats them differently. Connecting one does not connect the other.
        Neither is required: every WhatsApp dialog always offers <strong>Open in WhatsApp instead</strong>,
        which needs no setup at all.
      </p>

      <div style={{ marginTop: 18 }}>
        <div className="row-tight">
          <span className="eyebrow">1 · Send now — free text, by hand</span>
          {status ? (
            <Chip tone={status.whatsappDirect ? "good" : "neutral"}>
              {status.whatsappDirect ? "Connected" : "Not connected"}
            </Chip>
          ) : null}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          The <strong>Send now</strong> button on a quotation, proforma or renewal reminder. Whatever is typed,
          sent immediately, from a number you link by scanning a QR code — the same pairing as WhatsApp Web.
        </p>
        <ol className="steps" style={{ marginTop: 10 }}>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Sign up with a QR-linked provider and link the number</div>
              <div>
                Use the number customers should see the message coming from. In the provider&rsquo;s dashboard,
                scan the QR code from WhatsApp on that phone (Settings → Linked Devices).
              </div>
            </div>
          </li>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Add the token in Netlify</div>
              <div>
                Site configuration → Environment variables → <code className="mono">WHATSAPP_API_TOKEN</code>,
                then redeploy.
              </div>
            </div>
          </li>
        </ol>
        <div className="notice" style={{ marginTop: 12 }}>
          <span>
            <strong>Worth knowing:</strong> QR-linked services are not WhatsApp&rsquo;s official business channel —
            they automate WhatsApp Web. Cheaper and quicker to set up than the official Business API, at the risk
            of the number being logged out or restricted without warning.
          </span>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div className="row-tight">
          <span className="eyebrow">2 · Automatic follow-ups — approved templates</span>
          {status ? (
            <Chip tone={status.whatsappTemplates ? "good" : "neutral"}>
              {status.whatsappTemplates ? "Connected" : "Not connected"}
            </Chip>
          ) : null}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          The chasers that go out on their own days after a quotation was sent. These land long after the last
          message, which puts them outside Meta&rsquo;s 24-hour window — and out there <strong>only templates
          approved in advance may be sent</strong>. That is Meta&rsquo;s rule, not this CRM&rsquo;s, and it is why this
          channel is a different provider and a different key from the one above.
        </p>
        <ol className="steps" style={{ marginTop: 10 }}>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Get three templates approved</div>
              <div>
                In Interakt. Meta&rsquo;s review usually takes a day or two, so start here. Each template must take
                exactly three variables, in this order: <code className="mono">{"{{1}}"}</code> who it is addressed
                to, <code className="mono">{"{{2}}"}</code> the quotation number, <code className="mono">{"{{3}}"}</code> a date.
              </div>
            </div>
          </li>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Add the key in Netlify</div>
              <div>
                Site configuration → Environment variables → <code className="mono">INTERAKT_API_KEY</code> — the
                Secret Key from Interakt — then redeploy.
              </div>
            </div>
          </li>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Name the templates in Settings → Follow-ups</div>
              <div>
                The key alone sends nothing: the follow-up needs to know which approved template to use. Delivery
                status — sent, delivered, read — is set up on that same panel.
              </div>
            </div>
          </li>
        </ol>
        <div className="notice" style={{ marginTop: 12 }}>
          <span>
            A customer only ever receives these if <strong>they have agreed to be contacted on WhatsApp</strong> is
            ticked on their record. An unticked box is not consent, and neither is a record that predates the question.
          </span>
        </div>
      </div>

      <div className="notice" style={{ marginTop: 18 }}>
        <span>
          Neither channel can be tested without sending a real message to a real person, so the CRM doesn&rsquo;t
          pretend to: the first send is the test. <strong>Connected</strong> above means the key is set — not that
          WhatsApp has accepted it.
        </span>
      </div>
    </Card>
  );
}

/* ── tax & KYC verification ────────────────────────────────────────── */

function VerificationPanel({ status }: { status: IntegrationStatus | null }) {
  const [state, setState] = useState<{ testing: boolean; result: { ok: boolean; message: string } | null }>(
    { testing: false, result: null },
  );

  const test = async () => {
    setState({ testing: true, result: null });
    const result = await testVerificationConnection();
    setState({ testing: false, result });
  };

  return (
    <Card
      title="GSTIN &amp; PAN verification"
      actions={status
        ? <Chip tone={status.verification ? "good" : "neutral"}>{status.verification ? "Connected" : "Not connected"}</Chip>
        : <Chip tone="neutral" dot={false}>Optional</Chip>}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Checks a customer's GSTIN and PAN against the government register, from the customer sheet. The
        checksum shown beside the GSTIN field only says the number is well formed — a cancelled registration
        passes it perfectly, and an invoice raised against one comes back after the goods have shipped. This
        says whether the registration exists, whether it is active, and whose name it is in.
      </p>

      <div className="notice" style={{ marginTop: 12 }}>
        <span>
          Each check is billed by the provider, so it happens when somebody presses <strong>Verify</strong> —
          never automatically, and never on a screen that merely shows a customer.
        </span>
      </div>

      <div style={{ marginTop: 16 }}>
        <span className="eyebrow">One-time setup</span>
        <ol className="steps" style={{ marginTop: 10 }}>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Take the API key and secret from the provider's console</div>
              <div>Sandbox (sandbox.co.in) → the live key pair, not the test one.</div>
            </div>
          </li>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Add both in Netlify</div>
              <div>
                Site configuration → Environment variables → <code className="mono">SANDBOX_API_KEY</code> and{" "}
                <code className="mono">SANDBOX_API_SECRET</code>, then redeploy.
                {" "}<strong>Not</strong> prefixed <code className="mono">VITE_</code> — anything with that prefix is
                compiled into the JavaScript every visitor downloads, and a paid verification key published on the
                internet is somebody else&rsquo;s free key.
              </div>
            </div>
          </li>
          <li className="step">
            <div className="step-body">
              <div className="step-title">Press Test connection</div>
              <div>It asks the provider for a token and nothing else, so it costs no verification.</div>
            </div>
          </li>
        </ol>
      </div>

      <div className="row-tight" style={{ marginTop: 16 }}>
        <Button size="sm" onClick={() => void test()} loading={state.testing} loadingLabel="Asking…">
          Test connection
        </Button>
        {state.result ? (
          <Chip tone={state.result.ok ? "good" : "bad"}>{state.result.message}</Chip>
        ) : null}
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
  const [quoteCc, setQuoteCc] = useState(
    String(settings["quoteCcEmail"] ?? "abhinav.jain@techzoidtechnologies.com"),
  );

  const save = () => {
    onChange({
      ...settings,
      invoicingEmail: to.trim(),
      invoicingCc: cc.trim(),
      quoteCcEmail: quoteCc.trim(),
    });
    toast("Email addresses saved");
  };

  const dirty =
    to.trim() !== String(settings["invoicingEmail"] ?? "") ||
    cc.trim() !== String(settings["invoicingCc"] ?? "") ||
    quoteCc.trim() !== String(settings["quoteCcEmail"] ?? "abhinav.jain@techzoidtechnologies.com");

  return (
    <Card
      title="Outgoing email"
      actions={dirty && canEdit ? <Button size="sm" tone="primary" onClick={save}>Save</Button> : null}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Who gets copied on what leaves the CRM. Everyone can use the buttons; only an admin sets the
        addresses.
      </p>

      <div style={{ marginTop: 14 }}>
        <span className="eyebrow">Quotations and proformas</span>
        <div className="grid grid-2" style={{ marginTop: 8 }}>
          <Field
            label="Always copy"
            hint="Filled in on every quotation sent to a customer. The sender can still clear it before sending."
          >
            <Input type="email" value={quoteCc} disabled={!canEdit} onChange={(e) => setQuoteCc(e.target.value)}
              placeholder="manager@example.com" />
          </Field>
        </div>
      </div>

      <div style={{ marginTop: 18, borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
        <span className="eyebrow">Send for invoicing</span>
        <div className="grid grid-2" style={{ marginTop: 8 }}>
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
      </div>
    </Card>
  );
}

/* ── two-way website sync ─────────────────────────────────────────── */

interface WebhookSettings {
  endpointUrl?: string;
  enabled?: boolean;
  inboundOwnerId?: string;
}

const EVENT_KINDS = "deal.created, deal.stage_changed, deal.won, deal.lost, activity.logged";

/** A generated secret, shown once and never again. */
function SecretOnce({ secret }: { secret: string }) {
  return (
    <div className="notice notice-good" style={{ marginTop: 10 }}>
      <div className="stack" style={{ gap: 8, width: "100%" }}>
        <span><strong>Copy this now — it won't be shown again:</strong></span>
        <CopyRow label="Signing secret" value={secret} />
      </div>
    </div>
  );
}

function WebhooksPanel({
  api, settings, users, onChange, canEdit, isAdmin,
}: {
  api: IntegrationsApi;
  settings: Record<string, unknown>;
  users: { id: string; name: string; role?: string }[];
  onChange: (next: Record<string, unknown>) => void;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const toast = useToast();
  const webhook = (settings["webhook"] ?? {}) as WebhookSettings;
  const [endpointUrl, setEndpointUrl] = useState(webhook.endpointUrl ?? "");
  const [enabled, setEnabled] = useState(webhook.enabled === true);
  const [ownerId, setOwnerId] = useState(webhook.inboundOwnerId ?? "");
  const [busy, setBusy] = useState<"outbound" | "inbound" | null>(null);
  const [outSecret, setOutSecret] = useState<string | null>(null);
  const [inSecret, setInSecret] = useState<string | null>(null);
  const [error, setError] = useState("");

  const dirty =
    endpointUrl.trim() !== (webhook.endpointUrl ?? "") ||
    enabled !== (webhook.enabled === true) ||
    ownerId !== (webhook.inboundOwnerId ?? "");

  const save = () => {
    onChange({
      ...settings,
      webhook: { endpointUrl: endpointUrl.trim(), enabled, inboundOwnerId: ownerId },
    });
    toast("Website sync settings saved");
  };

  const generate = async (kind: "outbound" | "inbound") => {
    setError(""); setBusy(kind);
    try {
      const secret = await api.regenerateWebhookSecret(kind);
      if (kind === "outbound") setOutSecret(secret);
      else setInSecret(secret);
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't generate a new secret.");
    }
    setBusy(null);
  };

  /* Where the website should POST to, derived from where this page is
     actually running rather than hardcoded — a preview deploy and the live
     site need different values and both are legitimate. */
  const receiveUrl =
    (typeof window === "undefined" ? "https://crm.ttpldelhi.com" : window.location.origin) +
    "/.netlify/functions/webhook-receive";

  return (
    <Card
      title="Website sync"
      actions={dirty && canEdit ? <Button size="sm" tone="primary" onClick={save}>Save</Button> : null}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Keeps this CRM and your website in step, both ways. Every delivery in either direction is signed, so
        each side can tell a real event from anyone who guessed the address, and is retried automatically if
        the far end doesn't answer.
      </p>

      {error ? <div className="notice notice-bad" style={{ marginTop: 12 }}>{error}</div> : null}

      {/* ── CRM → website ── */}
      <div style={{ marginTop: 16, borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
        <span className="eyebrow">This CRM → your website</span>
        <p className="field-hint" style={{ marginTop: 4 }}>
          When someone here creates a deal, moves it along, wins or loses it, or logs an activity, your
          website is told.
        </p>

        <div className="stack" style={{ marginTop: 12 }}>
          <Field label="Your website's endpoint URL" hint="Must be HTTPS. Leave blank to send nothing.">
            <Input
              value={endpointUrl}
              disabled={!canEdit}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://www.ttpldelhi.com/hooks/crm"
            />
          </Field>

          <label className="row-tight" style={{ cursor: canEdit ? "pointer" : "default" }}>
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Send events</span>
          </label>
        </div>

        {outSecret ? <SecretOnce secret={outSecret} /> : null}

        {isAdmin ? (
          <Button
            size="sm"
            tone={outSecret ? "quiet" : "default"}
            disabled={busy !== null}
            onClick={() => void generate("outbound")}
            style={{ marginTop: 10 }}
          >
            {busy === "outbound" ? "Generating…" : outSecret ? "Generate another" : "Generate sending secret"}
          </Button>
        ) : null}
        <p className="field-hint" style={{ marginTop: 8 }}>
          Paste that secret into your website so it can verify what this CRM sends it.
        </p>
      </div>

      {/* ── website → CRM ── */}
      <div style={{ marginTop: 18, borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
        <span className="eyebrow">Your website → this CRM</span>
        <p className="field-hint" style={{ marginTop: 4 }}>
          A new enquiry on your website becomes a real lead here, and changes made there keep it up to date.
          Give your website these two values.
        </p>

        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          <div>
            <span className="field-hint">Endpoint URL — the address your website should send to:</span>
            <CopyRow label="Receiving URL" value={receiveUrl} />
          </div>

          {inSecret ? <SecretOnce secret={inSecret} /> : null}

          {isAdmin ? (
            <div>
              <Button
                size="sm"
                tone={inSecret ? "quiet" : "default"}
                disabled={busy !== null}
                onClick={() => void generate("inbound")}
              >
                {busy === "inbound" ? "Generating…" : inSecret ? "Generate another" : "Generate receiving secret"}
              </Button>
              <p className="field-hint" style={{ marginTop: 8 }}>
                Paste this into your website's <strong>Signing secret</strong> box. It is a different secret
                from the sending one above, on purpose — changing one never silently breaks the other
                direction.
              </p>
            </div>
          ) : (
            <p className="field-hint">Only an Admin can generate or rotate a signing secret.</p>
          )}

          <Field
            label="Website leads belong to"
            hint="Who owns a customer record created from your website. They can always reassign it afterwards."
          >
            <Select value={ownerId} disabled={!canEdit} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">— first Admin —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}{u.role ? ` (${u.role})` : ""}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <div className="notice" style={{ marginTop: 16 }}>
        <span>
          Event kinds, both directions: <code className="mono">{EVENT_KINDS}</code>. Run{" "}
          <code className="mono">supabase/005_webhooks.sql</code> and then{" "}
          <code className="mono">supabase/006_webhooks_inbound.sql</code> once each in Supabase → SQL Editor
          before turning this on.
        </span>
      </div>
    </Card>
  );
}

/**
 * Approving the CRM for the whole organisation, in one click.
 *
 * WHY THIS IS A BUTTON AND NOT A PARAGRAPH. The paragraph existed — open
 * Entra, find App registrations, find TechZoid CRM, API permissions, Grant
 * admin consent — and it sent an administrator to a blade where the app was
 * not listed, because an app registered in one tenant does not appear under
 * App registrations in another. They looked, found nothing, and concluded
 * the app did not exist, while colleagues kept hitting "Need admin
 * approval".
 *
 * Microsoft's /adminconsent endpoint has none of that problem: it takes the
 * client id and grants for the whole tenant, wherever the registration
 * lives. The server builds the link, because only the server knows the
 * client id.
 */
function AdminConsent() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const res = await fetch("/.netlify/functions/ms-admin-consent", { credentials: "include" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.url) {
        throw new Error(String(payload?.error ?? "Could not build the approval link."));
      }
      /* A new tab, so nothing half-filled on this screen is lost, and so the
         admin can come back and read the rest. */
      window.open(String(payload.url), "_blank", "noopener,noreferrer");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not build the approval link.", "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button size="sm" tone="primary" loading={busy} onClick={() => void open()}>
        Approve for the whole organisation
      </Button>
      <p className="field-hint" style={{ marginTop: 8 }}>
        Opens Microsoft's approval screen. Sign in there as a Global Administrator and accept once —
        after that nobody here sees <strong>“Need admin approval”</strong> again, and everyone can
        connect their own mailbox.
      </p>
      <p className="field-hint">
        You are approving the same three things a single person would approve for themselves: send
        mail as themselves, read their own name and address, and stay signed in. Nothing reads
        anybody else's mailbox, and nothing is tenant-wide.
      </p>
      <p className="field-hint">
        Needed because this app is not a Microsoft-verified publisher, and most tenants only let
        people approve verified apps for themselves. It is one screen, and it does not need repeating
        unless the permissions change.
      </p>
    </div>
  );
}
