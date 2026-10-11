import { useState } from "react";
import { Mail, MessageCircle, Pencil } from "lucide-react";
import { Modal } from "../../components/Modal";
import { Button, Chip, Field, Input, Select } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { fmtDate } from "../../domain/dates";
import { moneyList } from "../../domain/currency/format";
import { PAYMENT_METHODS } from "../../domain/payments/ledger";
import {
  daysBetween, dueDateFor, upcomingReminder, outstandingOf, standingOf, stepDueToday, stepKey, toneFor,
} from "../../domain/paymentTracker/schedule";
import {
  deleteBill, newPaymentId, previewEmail, sendNow, trackerLive,
  type PaymentBill, type ReminderLog, type TrackerSettings,
} from "../../data/paymentTracker";
import { StandingChip } from "./StandingChip";

const TONE_LABEL: Record<string, string> = {
  upcoming: "Friendly heads-up", due: "Due today", overdue: "Overdue reminder", firm: "Firm reminder", final: "Final reminder",
};

const stepLabel = (offset: number) =>
  offset < 0 ? `${-offset} days before due` : offset === 0 ? "On the due date" : `${offset} days overdue`;

/** One bill: what is owed, what was received, and every reminder. */
export function BillPanel({
  open, bill, logs, settings, today, ownerName, onClose, onEdit, onSave, onDeleted, onReminderSent,
}: {
  open: boolean;
  bill: PaymentBill;
  logs: ReminderLog[];
  settings: TrackerSettings;
  today: string;
  ownerName: string;
  onClose: () => void;
  onEdit: () => void;
  onSave: (bill: PaymentBill, message: string) => Promise<void>;
  onDeleted: () => void;
  onReminderSent: () => void;
}) {
  const toast = useToast();
  const balance = outstandingOf(bill);
  const days = daysBetween(bill.dueDate, today);
  const closed = bill.status !== "open" || balance <= 0;

  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState(String(balance));
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [reference, setReference] = useState("");
  const [pauseTo, setPauseTo] = useState(bill.pausedUntil ?? dueDateFor(today, 7));
  const [sending, setSending] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const recordPayment = async () => {
    const value = Number(amount.replace(/,/g, "")) || 0;
    if (value <= 0) return;
    const payments = [...bill.payments, { id: newPaymentId(), amount: value, date, method, reference: reference.trim() }];
    const paidNow = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const fully = paidNow >= bill.amount - 0.005;
    await onSave(
      { ...bill, payments, status: fully ? "paid" : bill.status },
      fully ? `${bill.invoiceNo} fully paid — reminders stopped` : `${moneyList(value, bill.currency)} recorded against ${bill.invoiceNo}`,
    );
    setPaying(false);
    setReference("");
  };

  const send = async (channel: "email" | "whatsapp") => {
    setSending(channel);
    try {
      const { results } = await sendNow(bill.id, [channel]);
      const r = results[channel];
      if (r?.state === "sent") toast(`Reminder sent by ${channel === "email" ? "email" : "WhatsApp"}`, "good");
      else toast(r?.error || "Not sent.", "bad");
      onReminderSent();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    } finally {
      setSending(null);
    }
  };

  const showPreview = async () => {
    try {
      const p = await previewEmail(bill.id);
      setPreview({ subject: p.subject, html: p.html });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    }
  };

  /* ── the reminder timeline: every step of the schedule, and what happened ── */
  const offsets = [...settings.schedule.offsets].sort((a, b) => a - b);
  const last = offsets[offsets.length - 1] ?? 0;
  const repeats: number[] = [];
  if (settings.schedule.repeatEvery > 0) {
    for (let o = last + settings.schedule.repeatEvery; o <= Math.max(days, last) + settings.schedule.repeatEvery && repeats.length < 6; o += settings.schedule.repeatEvery) repeats.push(o);
  }
  const allSteps = [...offsets, ...repeats];
  const next = !closed && settings.enabled ? upcomingReminder(bill, today, new Set(logs.map((l) => l.step)), settings.schedule) : null;
  const dueNow = stepDueToday(bill, today, settings.schedule);
  const manual = logs.filter((l) => l.step.startsWith("manual"));
  /* Past steps with nothing logged are noise once listed one by one; they are
     counted instead. The step owed today always shows. */
  const isQuietPast = (o: number) => {
    const key = stepKey(o);
    return dueDateFor(bill.dueDate, o) < today && !logs.some((l) => l.step === key) && dueNow?.key !== key;
  };
  const visibleSteps = allSteps.filter((o) => !isQuietPast(o));
  const skippedCount = allSteps.length - visibleSteps.length;

  const deleteIt = async () => {
    try {
      await deleteBill(bill.id);
      toast(`${bill.invoiceNo} deleted`, "good");
      onDeleted();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    }
  };

  return (
    <Modal
      open={open}
      side
      title={
        <span className="row-tight" style={{ gap: 8 }}>
          {bill.customerName}
        </span>
      }
      description={`Invoice ${bill.invoiceNo} · ${fmtDate(bill.invoiceDate)} · ${bill.creditDays} days credit${ownerName ? ` · ${ownerName}` : ""}`}
      onClose={onClose}
      footer={
        <>
          {confirmDelete ? (
            <>
              <span className="field-hint">Delete this bill and its reminder history?</span>
              <Button tone="quiet" onClick={() => setConfirmDelete(false)}>Keep</Button>
              <Button tone="danger" onClick={() => void deleteIt()}>Delete</Button>
            </>
          ) : (
            <>
              <Button tone="quiet" onClick={() => setConfirmDelete(true)}>Delete</Button>
              <span className="grow" />
              <Button onClick={onEdit}><Pencil size={14} /> Edit</Button>
              {!closed ? <Button tone="primary" onClick={() => setPaying(true)}>Record payment</Button> : null}
            </>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="row-tight wrap" style={{ gap: 8 }}>
          <StandingChip standing={standingOf(bill, today)} days={days} />
          {bill.pausedUntil && bill.pausedUntil >= today ? <Chip tone="warn">Paused till {fmtDate(bill.pausedUntil)}</Chip> : null}
          {!bill.remindersOn ? <Chip tone="neutral">Reminders off</Chip> : null}
        </div>

        <dl className="pt-kv">
          <dt>Due date</dt><dd>{fmtDate(bill.dueDate)}</dd>
          <dt>Invoice amount</dt><dd>{moneyList(bill.amount, bill.currency)}</dd>
          <dt>Received</dt><dd>{moneyList(bill.amountPaid, bill.currency)}</dd>
          <dt><strong>Balance</strong></dt><dd><strong>{moneyList(balance, bill.currency)}</strong></dd>
          <dt>Contact</dt><dd>{bill.contactName || "—"}</dd>
          <dt>Email</dt><dd>{bill.email || <span style={{ color: "var(--warn)" }}>none</span>}</dd>
          <dt>WhatsApp</dt><dd>{bill.phone || <span style={{ color: "var(--warn)" }}>none</span>}</dd>
        </dl>

        {paying ? (
          <div className="stack" style={{ border: "1px solid var(--accent-rule)", background: "var(--accent-weak)", borderRadius: "var(--radius)", padding: "var(--gap-wide)" }}>
            <div className="grid grid-2">
              <Field label="Amount received" hint={(Number(amount) || 0) > balance ? "More than the balance." : undefined}>
                <Input numeric value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
              </Field>
              <Field label="Date received">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-2">
              <Field label="Method">
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                </Select>
              </Field>
              <Field label="Reference" hint="UTR or cheque no.">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
            <div className="row-tight" style={{ justifyContent: "flex-end", gap: 8 }}>
              <Button tone="quiet" onClick={() => setPaying(false)}>Cancel</Button>
              <Button tone="primary" disabled={(Number(amount) || 0) <= 0} onClick={() => void recordPayment()}>Save payment</Button>
            </div>
          </div>
        ) : null}

        {bill.payments.length ? (
          <>
            <div className="pt-section-title">Payments received</div>
            <dl className="pt-kv">
              {bill.payments.map((p) => (
                <FragmentRow key={p.id} k={`${fmtDate(p.date)} · ${p.method}${p.reference ? ` · ${p.reference}` : ""}`} v={moneyList(p.amount, bill.currency)} />
              ))}
            </dl>
          </>
        ) : null}

        {!closed ? (
          <>
            <div className="pt-section-title">Send a reminder now</div>
            <div className="row-tight wrap" style={{ gap: 8 }}>
              <Button size="sm" disabled={!bill.email || !trackerLive()} loading={sending === "email"} onClick={() => void send("email")}>
                <Mail size={14} /> Email now
              </Button>
              <Button size="sm" disabled={!bill.phone || !trackerLive()} loading={sending === "whatsapp"} onClick={() => void send("whatsapp")}>
                <MessageCircle size={14} /> WhatsApp now
              </Button>
              <Button size="sm" tone="quiet" disabled={!trackerLive()} onClick={() => void showPreview()}>Preview email</Button>
            </div>
            <div className="field-hint">
              Uses the {TONE_LABEL[dueNow?.tone ?? (days < 0 ? "upcoming" : toneFor(days, settings.schedule))]?.toLowerCase()} wording.
            </div>

            <div className="pt-section-title">Hold reminders</div>
            <div className="row-tight wrap" style={{ gap: 8, alignItems: "flex-end" }}>
              <Field label="Customer promised to pay by">
                <Input type="date" value={pauseTo} onChange={(e) => setPauseTo(e.target.value)} />
              </Field>
              <Button size="sm" onClick={() => void onSave({ ...bill, pausedUntil: pauseTo }, `Reminders paused until ${fmtDate(pauseTo)}`)}>
                Pause until then
              </Button>
              {bill.pausedUntil ? (
                <Button size="sm" tone="quiet" onClick={() => void onSave({ ...bill, pausedUntil: null }, "Reminders resumed")}>Resume now</Button>
              ) : null}
            </div>
            <label className="pt-check">
              <input
                type="checkbox"
                checked={bill.remindersOn}
                onChange={(e) => void onSave({ ...bill, remindersOn: e.target.checked }, e.target.checked ? "Reminders on" : "Reminders off for this bill")}
              />
              Automatic reminders for this bill
            </label>
          </>
        ) : null}

        <div className="pt-section-title">Reminder timeline</div>
        {skippedCount > 0 ? (
          <div className="field-hint" style={{ marginBottom: "var(--gap)" }}>
            {skippedCount} earlier step(s) were passed before this bill was tracked (or while paused) — only the latest one due is ever sent, never a backlog.
          </div>
        ) : null}
        <ol className="pt-timeline">
          {visibleSteps.map((o) => {
            const key = stepKey(o);
            const hits = logs.filter((l) => l.step === key);
            const sent = hits.find((h) => h.state === "sent");
            const failed = hits.find((h) => h.state === "failed");
            const onDate = dueDateFor(bill.dueDate, o);
            const passed = onDate < today || (onDate === today && hits.length > 0);
            const isNext = next === today ? dueNow?.key === key : next === onDate;
            const cls = sent ? "is-sent" : failed ? "is-failed" : isNext ? "is-next" : passed ? "is-skipped" : "";
            return (
              <li key={key} className={"pt-step " + cls}>
                <span className="pt-dot" />
                <div className="pt-step-title">{stepLabel(o)} · {TONE_LABEL[toneFor(o, settings.schedule)]}</div>
                <div className="pt-step-meta">
                  {fmtDate(onDate)}
                  {hits.map((h) => (
                    <span key={h.id}> · {h.channel === "whatsapp" ? "WhatsApp" : "Email"} {h.state}{h.error ? ` — ${h.error}` : ""}</span>
                  ))}
                  {!hits.length && isNext ? (next === today ? " · goes out today at 9:30 am" : " · next") : ""}
                </div>
              </li>
            );
          })}
          {manual.map((h) => (
            <li key={h.id} className={"pt-step " + (h.state === "sent" ? "is-sent" : h.state === "failed" ? "is-failed" : "")}>
              <span className="pt-dot" />
              <div className="pt-step-title">Sent by hand · {h.channel === "whatsapp" ? "WhatsApp" : "Email"}</div>
              <div className="pt-step-meta">{fmtDate(h.sentOn)} · {h.state}{h.error ? ` — ${h.error}` : ""} · to {h.sendTo}</div>
            </li>
          ))}
        </ol>

        {!closed ? (
          <div className="row-tight wrap" style={{ gap: 8, marginTop: "var(--gap-wide)" }}>
            <Button size="sm" tone="quiet" onClick={() => void onSave({ ...bill, status: "paid" }, `${bill.invoiceNo} marked paid`)}>Mark as paid</Button>
            <Button size="sm" tone="quiet" onClick={() => void onSave({ ...bill, status: "written_off" }, `${bill.invoiceNo} written off — reminders stopped`)}>Write off</Button>
          </div>
        ) : (
          <Button size="sm" tone="quiet" onClick={() => void onSave({ ...bill, status: "open" }, `${bill.invoiceNo} reopened`)}>Reopen bill</Button>
        )}

        {bill.notes ? (
          <>
            <div className="pt-section-title">Notes</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{bill.notes}</div>
          </>
        ) : null}

        {preview ? (
          <>
            <div className="pt-section-title">Email preview — {preview.subject}</div>
            <iframe title="Email preview" className="pt-preview" sandbox="" srcDoc={preview.html} />
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (<><dt>{k}</dt><dd>{v}</dd></>);
}
