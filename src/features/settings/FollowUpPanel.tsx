import { useState } from "react";
import { Button, Card, Field, Input, Select } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { FollowUpDoctor } from "./FollowUpDoctor";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";
import {
  DEFAULT_FOLLOWUP_STEPS, MAX_STEP_DAYS, MAX_STEPS, MIN_STEP_DAYS, readSteps, TONE_LABELS,
  type FollowUpStep, type FollowUpTone,
} from "../../domain/followups/followups";
import { DEFAULT_TEMPLATE_NAMES, TEMPLATE_SETTING } from "../../domain/integrations/interakt";

/**
 * When a sent quotation gets chased, and how the chaser reads.
 *
 * Every row here is an email that will leave this company with nobody
 * watching, so the panel is written to be read by somebody deciding whether
 * to let that happen — what goes out, on which day, and what stops it —
 * rather than as a form with a Save button.
 */
export function FollowUpPanel({
  settings, canEdit, api, onChange,
}: {
  settings: Record<string, unknown>;
  canEdit: boolean;
  api?: IntegrationsApi;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const [callbackKey, setCallbackKey] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState("");

  const origin = typeof window === "undefined" ? "https://crm.ttpldelhi.com" : window.location.origin;

  const makeKey = async () => {
    if (!api) return;
    setKeyError(""); setKeyBusy(true);
    try {
      setCallbackKey(await api.regenerateWebhookSecret("whatsapp"));
    } catch (err) {
      setKeyError(err instanceof IntegrationError ? err.message : "Couldn't generate a callback URL.");
    }
    setKeyBusy(false);
  };
  const on = settings["autoFollowUps"] !== false;
  const steps = readSteps(settings["followUpSteps"]);

  const write = (patch: Record<string, unknown>) => onChange({ ...settings, ...patch });

  const setAt = (i: number, patch: Partial<FollowUpStep>) =>
    write({ followUpSteps: steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="stack">
      <Card title="Automatic follow-ups">
        <p className="field-hint" style={{ marginTop: 0 }}>
          When a quotation or proforma is emailed from this CRM, the send dialog offers to schedule
          these. They go out on their own, from the salesperson's own mailbox where one is connected.
        </p>

        <label className="row-tight" style={{ cursor: canEdit ? "pointer" : "default" }}>
          <input
            type="checkbox"
            checked={on}
            disabled={!canEdit}
            onChange={(e) => write({ autoFollowUps: e.target.checked })}
          />
          <span>Offer to follow up automatically when a quotation is sent</span>
        </label>

        {/* Said here rather than left to be discovered, because it is the one
            thing about this feature that can embarrass somebody in front of a
            customer. */}
        <div className="notice">
          <span>
            <strong>What stops a sequence.</strong> Marking the quotation Accepted, Rejected or
            Expired stops it, and so does its validity date passing. Anyone looking at the document
            can stop it from there. <strong>A customer replying does not stop it</strong> — this CRM
            can send email but cannot read your mailbox, so a reply is invisible to it. Mark the
            quotation, or press Stop, when a customer comes back to you.
          </span>
        </div>
      </Card>

      <Card title="WhatsApp">
        <p className="field-hint" style={{ marginTop: 0 }}>
          Follow-ups can go by WhatsApp as well as by email, through Interakt. A chaser arrives days
          after the last message, which is outside the 24-hour window where WhatsApp allows free text —
          so each one is sent as a <strong>template approved by Meta in advance</strong>. The wording lives
          in Interakt, not here; what goes below is the name each template was approved under.
        </p>

        <div className="notice">
          <span>
            <strong>Every template takes the same three placeholders, in this order:</strong>{" "}
            <code>{"{{1}}"}</code> who it is addressed to, <code>{"{{2}}"}</code> the quotation number,{" "}
            <code>{"{{3}}"}</code> a date — the validity date on the last one, the quotation date on the
            others. Register them in Interakt with exactly three variables, or the send is refused.
          </span>
        </div>

        <div className="stack" style={{ marginTop: 12 }}>
          {(Object.keys(TONE_LABELS) as FollowUpTone[]).map((tone) => (
            <Field
              key={tone}
              label={`Template for "${TONE_LABELS[tone].name}"`}
              hint={`${TONE_LABELS[tone].what} Blank uses "${DEFAULT_TEMPLATE_NAMES[tone]}".`}
            >
              <Input
                className="mono"
                value={String(settings[TEMPLATE_SETTING[tone]] ?? "")}
                disabled={!canEdit}
                placeholder={DEFAULT_TEMPLATE_NAMES[tone]}
                onChange={(e) => write({ [TEMPLATE_SETTING[tone]]: e.target.value })}
              />
            </Field>
          ))}
        </div>

        {/* ── delivery status back from Interakt ── */}
        <div style={{ marginTop: 18, borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
          <span className="eyebrow">Delivery status</span>
          <p className="field-hint" style={{ marginTop: 4 }}>
            Interakt answers the moment it has <em>accepted</em> a message, not when WhatsApp delivered it.
            Give Interakt this callback URL and each follow-up will show Delivered, Read, or why it failed,
            instead of only "Sent".
          </p>

          {callbackKey ? (
            <div className="notice notice-good" style={{ marginTop: 10 }}>
              <span>
                <strong>Copy this now — it is shown once.</strong> Paste it into Interakt as the webhook URL:
                <br />
                <code className="mono" style={{ wordBreak: "break-all" }}>
                  {`${origin}/.netlify/functions/whatsapp-status?k=${callbackKey}`}
                </code>
                <br />
                The key in that address is what proves a caller is Interakt — Interakt does not sign its
                webhooks, so the URL itself is the credential. Treat it like a password, and generate
                another if it is ever pasted somewhere it should not be.
              </span>
            </div>
          ) : null}

          {canEdit ? (
            <Button
              size="sm"
              tone={callbackKey ? "quiet" : "default"}
              disabled={keyBusy || !api}
              onClick={() => void makeKey()}
            >
              {keyBusy ? "Generating…" : callbackKey ? "Generate another" : "Generate the callback URL"}
            </Button>
          ) : (
            <p className="field-hint">An admin can generate this.</p>
          )}

          {keyError ? <div className="notice notice-bad" style={{ marginTop: 8 }}><span>{keyError}</span></div> : null}
        </div>

        <p className="field-hint" style={{ marginBottom: 0, marginTop: 14 }}>
          A customer is only messaged where they have agreed to it — the tick on their record, or on the
          registration form. Without it the WhatsApp option is switched off for that customer, whatever is
          set here.
        </p>
      </Card>

      <Card
        title="The sequence"
        actions={
          canEdit ? (
            <span className="row-tight">
              <Button
                size="sm"
                tone="quiet"
                onClick={() => { write({ followUpSteps: [...DEFAULT_FOLLOWUP_STEPS] }); toast("Sequence reset.", "good"); }}
              >
                Reset
              </Button>
              <Button
                size="sm"
                tone="default"
                disabled={steps.length >= MAX_STEPS}
                onClick={() => write({
                  followUpSteps: [...steps, { afterDays: Math.min((steps[steps.length - 1]?.afterDays ?? 0) + 7, MAX_STEP_DAYS), tone: "check" }],
                })}
              >
                Add a step
              </Button>
            </span>
          ) : null
        }
      >
        <p className="field-hint" style={{ marginTop: 0 }}>
          Days are counted from the day the quotation is emailed. A step that would land after the
          quotation's last valid day is dropped rather than moved — a chaser arriving after validity
          asks the customer to accept something that has expired.
        </p>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th style={{ width: 140 }}>Days after</th><th>Reads as</th><th /></tr>
            </thead>
            <tbody>
              {steps.map((step, i) => (
                <tr key={i}>
                  <td data-head>
                    <Field label="">
                      <Input
                        numeric
                        value={String(step.afterDays)}
                        disabled={!canEdit}
                        onChange={(e) => setAt(i, { afterDays: Number(e.target.value) || MIN_STEP_DAYS })}
                      />
                    </Field>
                  </td>
                  <td data-label="Reads as">
                    <Field label="" hint={TONE_LABELS[step.tone].what}>
                      <Select
                        value={step.tone}
                        disabled={!canEdit}
                        onChange={(e) => setAt(i, { tone: e.target.value as FollowUpTone })}
                      >
                        {(Object.keys(TONE_LABELS) as FollowUpTone[]).map((t) => (
                          <option key={t} value={t}>{TONE_LABELS[t].name}</option>
                        ))}
                      </Select>
                    </Field>
                  </td>
                  <td data-actions>
                    {canEdit ? (
                      <Button
                        size="sm"
                        tone="danger"
                        onClick={() => write({ followUpSteps: steps.filter((_, j) => j !== i) })}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="field-hint" style={{ marginBottom: 0 }}>
          Up to {MAX_STEPS} steps, between {MIN_STEP_DAYS} and {MAX_STEP_DAYS} days. Two steps on the
          same day would send one customer two emails in a morning, so only the first is kept.
        </p>
            <FollowUpDoctor />
</Card>
    </div>
  );
}
