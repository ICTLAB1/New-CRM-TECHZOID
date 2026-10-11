import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, Field, Input, Select, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import {
  runMorningNow, saveSettings, sendTest, serverStatus, trackerLive, type TrackerSettings,
} from "../../data/paymentTracker";

const describeOffset = (o: number) => (o < 0 ? `${-o} before` : o === 0 ? "on the day" : `${o} after`);

/** Who sends, when, on which channels — for the whole company. */
export function TrackerSettingsPanel({
  open, settings, users, currentUser, companyId, canEdit, onClose, onSaved, onRan,
}: {
  open: boolean;
  settings: TrackerSettings;
  users: { id: string; name: string; email?: string }[];
  currentUser: { id: string; name: string; email?: string };
  companyId: string | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (s: TrackerSettings) => void;
  onRan: () => void;
}) {
  const toast = useToast();
  const [s, setS] = useState<TrackerSettings>(() => ({
    ...settings,
    sendFromUserId: settings.sendFromUserId || currentUser.id,
    digestTo: settings.digestTo || currentUser.email || "",
  }));
  const [offsetsText, setOffsetsText] = useState(settings.schedule.offsets.join(", "));
  const [testTo, setTestTo] = useState(currentUser.email ?? "");
  const [status, setStatus] = useState<{ whatsappKey: boolean; resendKey: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!trackerLive()) return;
    serverStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const set = (patch: Partial<TrackerSettings>) => setS((cur) => ({ ...cur, ...patch }));

  const offsets = [...new Set(offsetsText.split(/[,\s]+/).map((x) => x.replace("−", "-")).filter(Boolean).map(Number))]
    .filter((n) => Number.isInteger(n) && n >= -60 && n <= 365)
    .sort((a, b) => a - b);
  const offsetsBad = offsets.length === 0;

  const save = async () => {
    if (offsetsBad) return;
    const next = { ...s, schedule: { ...s.schedule, offsets } };
    setBusy("save");
    try {
      await saveSettings(companyId, next);
      onSaved(next);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const r = await sendTest(companyId, testTo);
      toast(`Test email sent${r.from ? ` from ${r.from}` : ""} — check ${testTo}`, "good");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setBusy("run");
    try {
      const r = await runMorningNow();
      const t = r.tally ?? {};
      toast(`Done — ${t.sent ?? 0} sent, ${t.failed ?? 0} failed, ${t.already ?? 0} already sent earlier`, (t.failed ?? 0) > 0 ? "warn" : "good");
      onRan();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    } finally {
      setBusy(null);
    }
  };

  const ro = !canEdit;

  return (
    <Modal
      open={open}
      side
      title="Reminder settings"
      description={ro ? "Only an admin or manager can change these." : "Applies to every bill in the Payment Tracker. Reminders go out every morning at 9:30 am."}
      onClose={onClose}
      onSubmit={() => void save()}
      canSubmit={!ro && !offsetsBad && busy === null}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Close</Button>
          {!ro ? <Button tone="primary" loading={busy === "save"} disabled={offsetsBad} onClick={() => void save()}>Save settings</Button> : null}
        </>
      }
    >
      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <label className="pt-check" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Automatic reminders to customers are ON
        </label>
        <div className="field-hint">Untick to stop every customer reminder at once (the team summary still goes out).</div>

        <div className="pt-section-title">Schedule</div>
        <Field
          label="Days relative to the due date"
          hint={offsetsBad ? undefined : `Reminds ${offsets.map(describeOffset).join(", ")}. Negative = before the due date.`}
          error={offsetsBad ? "Enter numbers separated by commas, e.g. -7, 0, 3, 7, 15, 30" : undefined}
        >
          <Input value={offsetsText} onChange={(e) => setOffsetsText(e.target.value)} />
        </Field>
        <Field label="After the last one, keep reminding every" hint="Until the bill is paid. 0 = stop after the last step.">
          <Select value={String(s.schedule.repeatEvery)} onChange={(e) => set({ schedule: { ...s.schedule, repeatEvery: Number(e.target.value) } })}>
            {[0, 7, 10, 15, 30].map((n) => <option key={n} value={n}>{n === 0 ? "Don't repeat" : `${n} days`}</option>)}
          </Select>
        </Field>

        <div className="pt-section-title">Email</div>
        <label className="pt-check">
          <input type="checkbox" checked={s.emailOn} onChange={(e) => set({ emailOn: e.target.checked })} />
          Send reminders by email
        </label>
        <Field label="Send from" hint="Goes out from this person's connected Microsoft 365 mailbox, so a copy lands in their Sent Items.">
          <Select value={s.sendFromUserId} onChange={(e) => set({ sendFromUserId: e.target.value })}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.email ? ` — ${u.email}` : ""}</option>)}
          </Select>
        </Field>
        <div className="grid grid-2">
          <Field label="Always CC" hint="Comma-separated.">
            <Input value={s.ccEmails} onChange={(e) => set({ ccEmails: e.target.value })} placeholder="accounts@techzoidtechnologies.com" />
          </Field>
          <Field label="Reply-to">
            <Input value={s.replyTo} onChange={(e) => set({ replyTo: e.target.value })} placeholder="accounts@techzoidtechnologies.com" />
          </Field>
        </div>
        <Field label="Contact line in the email">
          <Input value={s.contactLine} onChange={(e) => set({ contactLine: e.target.value })} />
        </Field>
        <Field label="Sign-off">
          <Textarea rows={2} value={s.signOff} onChange={(e) => set({ signOff: e.target.value })} />
        </Field>

        <div className="pt-section-title">Bank details printed on reminders</div>
        <div className="grid grid-2">
          <Field label="Bank"><Input value={s.bank.bankName} onChange={(e) => set({ bank: { ...s.bank, bankName: e.target.value } })} /></Field>
          <Field label="Account name"><Input value={s.bank.accountName} onChange={(e) => set({ bank: { ...s.bank, accountName: e.target.value } })} /></Field>
          <Field label="Account number"><Input value={s.bank.accountNumber} onChange={(e) => set({ bank: { ...s.bank, accountNumber: e.target.value } })} /></Field>
          <Field label="IFSC"><Input value={s.bank.ifsc} onChange={(e) => set({ bank: { ...s.bank, ifsc: e.target.value } })} /></Field>
          <Field label="UPI ID (optional)"><Input value={s.bank.upi} onChange={(e) => set({ bank: { ...s.bank, upi: e.target.value } })} /></Field>
        </div>

        <div className="pt-section-title">WhatsApp</div>
        <label className="pt-check">
          <input type="checkbox" checked={s.whatsappOn} onChange={(e) => set({ whatsappOn: e.target.checked })} />
          Send reminders on WhatsApp too
        </label>
        {status && !status.whatsappKey ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            WhatsApp is not connected on the server yet (the Interakt key is missing). Email reminders still work.
          </div>
        ) : null}
        <div className="field-hint">
          WhatsApp only allows pre-approved templates for reminders. Create these in Interakt with four variables:
          {" {{1}}"} name, {"{{2}}"} invoice no., {"{{3}}"} amount due, {"{{4}}"} due date — and enter their exact names here.
        </div>
        <div className="grid grid-2">
          <Field label="Before / on due date"><Input value={s.waTemplates.upcoming} onChange={(e) => set({ waTemplates: { ...s.waTemplates, upcoming: e.target.value, due: e.target.value } })} /></Field>
          <Field label="Overdue"><Input value={s.waTemplates.overdue} onChange={(e) => set({ waTemplates: { ...s.waTemplates, overdue: e.target.value, firm: e.target.value } })} /></Field>
          <Field label="Final (30+ days)"><Input value={s.waTemplates.final} onChange={(e) => set({ waTemplates: { ...s.waTemplates, final: e.target.value } })} /></Field>
        </div>

        <div className="pt-section-title">Morning summary for the team</div>
        <label className="pt-check">
          <input type="checkbox" checked={s.digestOn} onChange={(e) => set({ digestOn: e.target.checked })} />
          Email a daily list of overdue, due-today and due-this-week bills
        </label>
        <Field label="Send the summary to" hint="Comma-separated, e.g. you and accounts.">
          <Input value={s.digestTo} onChange={(e) => set({ digestTo: e.target.value })} />
        </Field>
      </fieldset>

      <div className="pt-section-title">Try it</div>
      <div className="row-tight wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <Field label="Send a sample reminder to">
          <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        </Field>
        <Button size="sm" disabled={!trackerLive() || !testTo.includes("@")} loading={busy === "test"} onClick={() => void test()}>Send test email</Button>
      </div>
      {canEdit ? (
        <div className="row-tight wrap" style={{ gap: 8, marginTop: "var(--gap)" }}>
          <Button size="sm" tone="quiet" disabled={!trackerLive()} loading={busy === "run"} onClick={() => void run()}>
            Run today's reminders now
          </Button>
          <span className="field-hint">Sends whatever is due today, if it has not gone already. Safe to press twice.</span>
        </div>
      ) : null}
    </Modal>
  );
}
