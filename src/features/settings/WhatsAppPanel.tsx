import { useEffect, useState } from "react";
import { Card, Chip, Field, Input } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { fnUrl } from "../../data/functions";
import {
  whatsappStatus, type WhatsAppStatus, type WhatsAppTemplateStatus,
} from "../../data/whatsappStatus";

/**
 * WhatsApp: what goes out by itself, and whether any of it can.
 *
 * EVERY SWITCH STARTS OFF, and that is the point of the screen. Eight
 * automatic messages were asked for and eight ways to annoy every customer
 * at once came with them, so nothing sends until somebody turns it on —
 * one at a time, after testing each with the Send button on a real record.
 * A switch nobody has touched is off; there is no "default on" anywhere in
 * the chain.
 *
 * WHAT IT CHECKS FOR YOU. The three things that go wrong with WhatsApp all
 * look identical from the CRM — the message simply never arrives:
 *
 *   · the access token has expired (a temporary one lasts a day)
 *   · a template is still in review at Meta
 *   · a template's wording was edited and now takes a different number of
 *     blanks than the CRM fills
 *
 * So the panel asks Meta directly and says which, rather than leaving
 * somebody to discover it from a customer.
 */

const SETTINGS_KEY = "whatsapp";

interface WhatsAppSettings {
  auto?: Record<string, boolean>;
  alertEmail?: string;
}

export function WhatsAppPanel({
  settings, canEdit, companyId, onChange,
}: {
  settings: Record<string, unknown>;
  canEdit: boolean;
  companyId: string | null;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const stored = (settings[SETTINGS_KEY] ?? {}) as WhatsAppSettings;
  const auto = stored.auto ?? {};

  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [alertEmail, setAlertEmail] = useState(stored.alertEmail ?? "");

  useEffect(() => {
    let live = true;
    setChecking(true);
    void whatsappStatus(companyId)
      .then((s) => { if (live) setStatus(s); })
      .catch(() => { if (live) setStatus(null); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [companyId]);

  const save = (next: WhatsAppSettings) => {
    onChange({ ...settings, [SETTINGS_KEY]: { ...stored, ...next } });
  };

  const toggle = (key: string, on: boolean) => {
    save({ auto: { ...auto, [key]: on } });
  };

  const webhookUrl = fnUrl("whatsapp-webhook");
  const anyOn = Object.values(auto).some((v) => v === true);

  return (
    <div className="stack-wide">
      {/* ── is it working at all ─────────────────────────────────── */}
      <Card title="Connection">
        {checking ? (
          <div className="muted">Checking with Meta…</div>
        ) : !status ? (
          <div className="notice notice-warn">
            Could not check the WhatsApp connection. The switches below still work; the messages will start
            going out as soon as the connection is sound.
          </div>
        ) : (
          <div className="stack">
            <div className="row-tight wrap">
              <Chip tone={status.configured ? "good" : "bad"}>
                {status.configured ? "Connected to Meta" : "Not connected"}
              </Chip>
              <Chip tone={status.verifyTokenSet ? "good" : "warn"}>
                {status.verifyTokenSet ? "Replies can be received" : "Replies not set up"}
              </Chip>
              {status.signatureChecked ? <Chip tone="good">Payloads signature-checked</Chip> : null}
            </div>
            {status.error ? <div className="notice notice-warn">{status.error}</div> : null}
            {!status.verifyTokenSet ? (
              <div className="notice">
                <span>
                  <strong>To receive replies</strong>, an admin adds <code>WHATSAPP_VERIFY_TOKEN</code> in Azure
                  (any phrase you invent), then enters this address and the same phrase in Meta → WhatsApp →
                  Configuration → Webhook:
                  <div style={{ marginTop: 8 }}><code>{webhookUrl}</code></div>
                </span>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* ── the eight switches ───────────────────────────────────── */}
      <Card
        title="Automatic messages"
        actions={anyOn ? <Chip tone="good">{Object.values(auto).filter(Boolean).length} on</Chip> : <Chip>all off</Chip>}
      >
        <div className="stack">
          {/* ONE CHILD. `.notice` is a flex row, so every element inside it
              becomes a column — a sentence with two bold phrases in it came
              out as three columns of broken text. The span keeps it a
              paragraph. */}
          <div className="notice">
            <span>
              Each of these sends by itself, to customers who have ticked <strong>WhatsApp updates allowed</strong> on
              their record. Everything starts off. Turn one on, watch it for a day, then turn on the next.
              The <strong>Send WhatsApp</strong> button on a quotation, order or invoice always works whatever is
              set here — these switches only decide what happens with nobody watching.
            </span>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>On</th>
                  <th>Message</th>
                  <th>When it goes</th>
                  <th>Approved by Meta</th>
                </tr>
              </thead>
              <tbody>
                {(status?.templates ?? FALLBACK_ROWS).map((t) => (
                  <tr key={t.name}>
                    <td>
                      <input
                        type="checkbox"
                        checked={auto[t.autoKey] === true}
                        disabled={!canEdit}
                        onChange={(e) => toggle(t.autoKey, e.target.checked)}
                        aria-label={`Send “${t.label}” automatically`}
                      />
                    </td>
                    <td>
                      <div><strong>{t.label}</strong></div>
                      {/* WHICH NAME IS ACTUALLY GOING OUT. The templates were
                          resubmitted to Meta as "_v2" and each is sent under
                          that name as soon as Meta has it, falling back to
                          the old one until then — with nothing for anybody
                          to switch over. This line is how that is visible. */}
                      <div className="field-hint">
                        {t.approved
                          ? <>Sending as <code>{t.metaName}</code>{t.carriesPdf ? ", with the quotation PDF attached" : ""}.</>
                          : t.legacyApproved
                            ? <><code>{t.metaName}</code> is not approved yet — sending <code>{t.legacyName}</code> for now{t.carriesPdf ? ", without the PDF" : ""}.</>
                            : <>Neither <code>{t.metaName}</code> nor <code>{t.legacyName}</code> is ready at Meta.</>}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>{t.name}</div>
                    </td>
                    <td className="muted">{t.when}</td>
                    <td>
                      {!status ? <span className="muted">—</span>
                        : t.approved ? <Chip tone="good">ready</Chip>
                          : <span><Chip tone="warn">not ready</Chip> <span className="muted">{t.problem}</span></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {status && status.templates.some((t) => !t.approved) ? (
            <div className="notice notice-warn">
              A message that is not ready will not be sent, whatever its switch says — it would be refused by
              WhatsApp. Nothing else stops working because of it.
            </div>
          ) : null}
        </div>
      </Card>

      {/* ── replies ──────────────────────────────────────────────── */}
      <Card title="When a customer replies">
        <div className="stack">
          <div className="notice">
            <span>
              The WhatsApp number answers through this CRM, not on a phone — replies appear in
              <strong> WhatsApp Inbox</strong>, and an email goes out so nobody has to watch the screen.
            </span>
          </div>
          <Field
            label="Email the alert to"
            hint="Leave empty to use abhinav.jain@techzoidtechnologies.com."
          >
            <Input
              type="email"
              value={alertEmail}
              disabled={!canEdit}
              placeholder="abhinav.jain@techzoidtechnologies.com"
              onChange={(e) => setAlertEmail(e.target.value)}
              onBlur={() => {
                const clean = alertEmail.trim();
                if (clean === (stored.alertEmail ?? "")) return;
                save({ alertEmail: clean });
                toast(clean ? `Reply alerts will go to ${clean}` : "Reply alerts will go to the default address", "good");
              }}
            />
          </Field>
          <Field label="The address Meta calls" hint="Enter this in Meta → WhatsApp → Configuration → Webhook.">
            <Input value={webhookUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
          </Field>
        </div>
      </Card>
    </div>
  );
}

/* Shown before the check comes back, so the switches are usable even when
   Meta cannot be reached — somebody setting this up offline can still
   decide what they want on. */
const FALLBACK_ROWS: WhatsAppTemplateStatus[] = [
  { name: "quotation_sent", label: "Quotation sent", when: "A quotation is emailed to the customer", autoKey: "quotationSent", blanks: 4, approved: false, problem: "" },
  { name: "quotation_followup", label: "Quotation follow-up", when: "A quotation has had no answer for three days", autoKey: "quotationFollowup", blanks: 4, approved: false, problem: "" },
  { name: "order_delivered", label: "Order delivered", when: "An order is marked delivered", autoKey: "orderDelivered", blanks: 4, approved: false, problem: "" },
  { name: "licence_delivered", label: "Licence keys sent", when: "Licence keys are marked as sent", autoKey: "licenceDelivered", blanks: 4, approved: false, problem: "" },
  { name: "payment_due_reminder", label: "Payment due in 3 days", when: "Three days before an invoice falls due", autoKey: "paymentDue", blanks: 4, approved: false, problem: "" },
  { name: "payment_overdue_reminder", label: "Payment overdue", when: "The day after the due date, then every seven days", autoKey: "paymentOverdue", blanks: 5, approved: false, problem: "" },
  { name: "payment_received", label: "Payment received", when: "A payment is recorded", autoKey: "paymentReceived", blanks: 3, approved: false, problem: "" },
  { name: "renewal_reminder", label: "Renewal in 30 days", when: "Thirty days before a subscription renews", autoKey: "renewalReminder", blanks: 3, approved: false, problem: "" },
];
