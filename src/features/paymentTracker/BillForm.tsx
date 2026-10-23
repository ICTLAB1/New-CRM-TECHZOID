import { useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, Field, Input, Select, Textarea } from "../../components/primitives";
import { MoreFields } from "../../components/MoreFields";
import { fmtDate } from "../../domain/dates";
import { moneyList } from "../../domain/currency/format";
import { dueDateFor, daysBetween } from "../../domain/paymentTracker/schedule";
import { phoneForStorage, saveBill, type PaymentBill } from "../../data/paymentTracker";

const TERMS = [0, 7, 15, 30, 45, 60, 90];
const CURRENCIES = ["INR", "USD", "AED", "EUR", "GBP", "NOK"];

/** Adding or editing one bill given on credit. */
export function BillForm({
  open, bill, customers, existing, onClose, onSaved, scan,
}: {
  open: boolean;
  bill: PaymentBill;
  customers: { id: string; company?: string; contact?: string; email?: string; phone?: string; gstin?: string }[];
  /** Set when this bill was read from a scanned/uploaded invoice. */
  scan?: { fileName: string; previewUrl: string; isPdf: boolean; matched: string | null; notes: string; remaining: number };
  existing: PaymentBill[];
  onClose: () => void;
  onSaved: (bill: PaymentBill) => void;
}) {
  const isNew = !bill.createdAt && !existing.some((b) => b.id === bill.id);
  const [b, setB] = useState<PaymentBill>(bill);
  const [phoneText, setPhoneText] = useState(bill.phone);
  const [amountText, setAmountText] = useState(bill.amount ? String(bill.amount) : "");
  /* Once someone types a due date by hand, credit days stop driving it. */
  const [dueByHand, setDueByHand] = useState(!isNew && bill.dueDate !== dueDateFor(bill.invoiceDate, bill.creditDays));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<PaymentBill>) => setB((cur) => {
    const next = { ...cur, ...patch };
    if (!dueByHand && ("invoiceDate" in patch || "creditDays" in patch)) {
      next.dueDate = dueDateFor(next.invoiceDate, next.creditDays);
    }
    return next;
  });

  const customerNames = useMemo(
    () => [...new Set(customers.map((c) => (c.company ?? "").trim()).filter(Boolean))].sort(),
    [customers],
  );

  /* Picking a CRM customer fills in who to remind. */
  const pickCustomer = (name: string) => {
    const match = customers.find((c) => (c.company ?? "").trim().toLowerCase() === name.trim().toLowerCase());
    if (!match) { set({ customerName: name }); return; }
    set({
      customerName: name,
      customerId: match.id,
      contactName: b.contactName || match.contact || "",
      email: b.email || match.email || "",
    });
    if (!phoneText && match.phone) setPhoneText(match.phone);
  };

  const amount = Number(amountText.replace(/,/g, "")) || 0;
  const phoneStored = phoneForStorage(phoneText);
  const phoneBad = !!phoneText.trim() && !phoneStored;
  const duplicate = existing.some((x) => x.id !== b.id && x.invoiceNo.trim().toLowerCase() === b.invoiceNo.trim().toLowerCase() && b.invoiceNo.trim());

  const problems = [
    !b.customerName.trim() && "Enter the customer.",
    !b.invoiceNo.trim() && "Enter the invoice number.",
    amount <= 0 && "Enter the invoice amount.",
    !b.invoiceDate && "Enter the invoice date.",
    b.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email.trim()) && "That email address does not look right.",
  ].filter(Boolean) as string[];

  const save = async () => {
    if (problems.length) { setError(problems[0] ?? null); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveBill({ ...b, amount, phone: phoneStored, invoiceNo: b.invoiceNo.trim() });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const noContact = !b.email.trim() && !phoneStored;
  const daysToDue = daysBetween(new Date().toISOString().slice(0, 10), b.dueDate);

  return (
    <Modal
      open={open}
      side
      title={isNew ? "Add a bill on credit" : `Edit ${bill.invoiceNo}`}
      description="The due date is worked out from the credit days. Reminders go to the email and WhatsApp number below."
      unsavedChanges
      onClose={onClose}
      onSubmit={() => void save()}
      canSubmit={!saving}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>{scan && scan.remaining > 0 ? "Skip this one" : "Cancel"}</Button>
          <Button tone="primary" loading={saving} onClick={() => void save()}>{isNew ? "Add bill" : "Save changes"}</Button>
        </>
      }
    >
      <div className="stack">
        {scan ? (
          <div className="pt-scan-note">
            <div className="row-tight" style={{ justifyContent: "space-between", gap: 8 }}>
              <strong>Read from {scan.fileName}</strong>
              <a href={scan.previewUrl} target="_blank" rel="noreferrer">View invoice</a>
            </div>
            <div>Check the amount, dates and customer before saving — nothing is saved until you press Add bill.</div>
            {scan.matched ? <div>Matched to CRM customer <strong>{scan.matched}</strong>; missing contact details were filled from there.</div> : null}
            {scan.notes ? <div>Note from the reader: {scan.notes}</div> : null}
            {scan.remaining > 0 ? <div>{scan.remaining} more invoice(s) waiting after this one.</div> : null}
            {!scan.isPdf ? <img src={scan.previewUrl} alt="Scanned invoice" className="pt-scan-thumb" /> : null}
          </div>
        ) : null}
        <Field label="Customer" hint="Start typing — picking a CRM customer fills in their contact details.">
          <Input
            list="pt-customers"
            value={b.customerName}
            autoFocus={isNew}
            onChange={(e) => pickCustomer(e.target.value)}
            placeholder="Company name"
          />
          <datalist id="pt-customers">
            {customerNames.map((n) => <option key={n} value={n} />)}
          </datalist>
        </Field>

        <div className="grid grid-2">
          <Field label="Invoice number" error={duplicate ? "Another bill already has this number." : undefined}>
            <Input value={b.invoiceNo} invalid={duplicate} onChange={(e) => set({ invoiceNo: e.target.value })} placeholder="TZ/26-27/0142" />
          </Field>
          <Field label="Invoice date">
            <Input type="date" value={b.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-2">
          <Field label="Amount (incl. GST)">
            <Input numeric inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Currency">
            <Select value={b.currency} onChange={(e) => set({ currency: e.target.value })}>
              {[...new Set([...CURRENCIES, b.currency])].map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Credit period">
          <div className="pt-terms">
            {TERMS.map((t) => (
              <button
                type="button"
                key={t}
                className={"pt-term" + (b.creditDays === t && !dueByHand ? " is-on" : "")}
                onClick={() => { setDueByHand(false); setB((cur) => ({ ...cur, creditDays: t, dueDate: dueDateFor(cur.invoiceDate, t) })); }}
              >
                {t === 0 ? "Immediate" : `${t} days`}
              </button>
            ))}
          </div>
        </Field>

        {/* The chips above already set both of these. They are here for the
            21-day term and the due date agreed on the phone, which is a
            minority of bills — and three controls for one concept read as
            three decisions to make. Opens itself on a bill that used
            them. */}
        <MoreFields
          label="an unusual credit period or an exact due date"
          filled={[dueByHand, !TERMS.includes(b.creditDays)]}
        >
        <div className="grid grid-2">
          <Field label="Credit days" hint="Any number — e.g. 21 or 120.">
            <Input
              numeric
              inputMode="numeric"
              value={String(b.creditDays)}
              onChange={(e) => { setDueByHand(false); const n = Math.max(0, Math.min(730, parseInt(e.target.value || "0", 10) || 0)); setB((cur) => ({ ...cur, creditDays: n, dueDate: dueDateFor(cur.invoiceDate, n) })); }}
            />
          </Field>
          <Field
            label="Due date"
            hint={dueByHand ? "Set by hand." : `${daysToDue >= 0 ? `In ${daysToDue} day(s)` : `${-daysToDue} day(s) ago`} — ${fmtDate(b.dueDate)}`}
          >
            <Input type="date" value={b.dueDate} onChange={(e) => { setDueByHand(true); setB((cur) => ({ ...cur, dueDate: e.target.value })); }} />
          </Field>
        </div>
        </MoreFields>

        <div className="pt-section-title">Who gets the reminders</div>
        <div className="grid grid-2">
          <Field label="Contact person">
            <Input value={b.contactName} onChange={(e) => set({ contactName: e.target.value })} placeholder="Mr. Sharma (Accounts)" />
          </Field>
          <Field label="WhatsApp number" error={phoneBad ? "Add the country code, e.g. +91 98100 12345." : undefined}>
            <Input value={phoneText} invalid={phoneBad} onChange={(e) => setPhoneText(e.target.value)} placeholder="+91 98100 12345" />
          </Field>
        </div>
        <Field label="Email">
          <Input type="email" value={b.email} onChange={(e) => set({ email: e.target.value })} placeholder="accounts@customer.com" />
        </Field>

        <label className="pt-check">
          <input type="checkbox" checked={b.remindersOn} onChange={(e) => set({ remindersOn: e.target.checked })} />
          Send automatic reminders for this bill
        </label>
        {noContact && b.remindersOn && b.customerName.trim() ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            No email or WhatsApp number — this bill will be tracked, but no reminder can be sent.
          </div>
        ) : null}

        <MoreFields label="a CC and internal notes" filled={[b.cc, b.notes]}>
          <Field label="CC" hint="Separate several addresses with commas — e.g. the purchase head.">
            <Input value={b.cc} onChange={(e) => set({ cc: e.target.value })} />
          </Field>
          <Field label="Notes (internal)">
            <Textarea rows={3} value={b.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="PO number, who approved the credit, anything useful…" />
          </Field>
        </MoreFields>

        {amount > 0 ? (
          <div className="field-hint">
            {moneyList(amount, b.currency)} due on {fmtDate(b.dueDate)}.
          </div>
        ) : null}
        {error ? <div className="field-msg">{error}</div> : null}
      </div>
    </Modal>
  );
}
