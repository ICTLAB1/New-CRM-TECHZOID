import { useState } from "react";
import { Modal } from "../../components/Modal";
import { AttachmentsPanel } from "../attachments/AttachmentsPanel";
import { askBeforeSave, useConfirmedAction } from "../../components/useConfirmedAction";
import { Button, Chip, Field, Input, Select, Textarea } from "../../components/primitives";
import { applyCountry, applyGstin, customerLabel, type Customer } from "../../domain/customers/customer";
import { gstinMessage, validateGSTIN } from "../../domain/gstin/validate";
import { COUNTRIES } from "../../domain/geo/countries";
import { STATE_NAMES } from "../../domain/geo/states";
import { SEGMENTS, SOURCES, STAGES } from "../../domain/pipeline/stages";
import { CURRENCIES } from "../../domain/currency/currencies";
import { TAX_TYPES } from "../../domain/tax/types";

/** Live feedback on the GSTIN field. Stays quiet while someone is still
 *  typing — an error under a half-entered field is just noise. */
function GstinStatus({ gstin }: { gstin: string }) {
  const result = validateGSTIN(gstin);
  if (result.valid) {
    return <div className="field-hint" style={{ color: "var(--good)" }}>{gstinMessage(result)}</div>;
  }
  if (result.reason === "empty" || result.reason === "incomplete") {
    return <div className="field-hint">{gstin ? `${result.clean.length} of 15 characters` : "Optional — leave blank if unregistered."}</div>;
  }
  return <div className="field-msg">{gstinMessage(result)}</div>;
}

export interface CustomerSheetProps {
  customer: Customer;
  users: { id: string; name: string }[];
  customFields: { id: string; label: string }[];
  canReassign: boolean;
  /** Who is looking. Their id is what a file they attach is uploaded as,
   *  and their role is what lets an Admin or Manager remove anybody's. */
  currentUser?: { id: string; name: string; role?: string };
  /** Read for `confirmBeforeSave`. Optional so the sheet still renders
   *  without a settings row — it simply asks, which is the default. */
  settings?: Record<string, unknown>;
  onSave: (customer: Customer) => void;
  onClose: () => void;
}

export function CustomerSheet({ customer, users, customFields, canReassign, currentUser, settings = {}, onSave, onClose }: CustomerSheetProps) {
  const [f, setF] = useState<Customer>({ ...customer, notes: customer.notes ?? [], customFields: customer.customFields ?? {} });
  const set = <K extends keyof Customer>(k: K) => (e: { target: { value: string } }) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  const isIndia = !f.country || f.country === "India";

  /* Compared against what was opened, not tracked with a flag: a field
     typed into and then typed back out of is not an unsaved change, and
     asking about it would train people to dismiss the question. */
  const unsaved = JSON.stringify(f) !== JSON.stringify({
    ...customer, notes: customer.notes ?? [], customFields: customer.customFields ?? {},
  });

  const commit = () => onSave({ ...f, updatedAt: Date.now() });

  const save = useConfirmedAction({
    title: "Save this customer?",
    body: `${customerLabel(f)} will be updated for everyone.`,
    confirmLabel: "Save customer",
    onConfirm: commit,
    enabled: askBeforeSave(settings),
  });

  return (
    <Modal
      open
      side
      title={customerLabel(f)}
      description={customer.company ? "Editing an existing account." : "New account."}
      unsavedChanges={unsaved}
      onClose={onClose}
      /* Ctrl/Cmd+S and Ctrl/Cmd+Enter reach the same confirmation the
         button does — a shortcut that skipped the question would make the
         question meaningless. */
      onSubmit={save.ask}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Cancel</Button>
          <Button tone="primary" onClick={save.ask}>Save customer</Button>
        </>
      }
    >
      {save.dialog}
      <div className="stack-wide">
        <div className="stack">
          <Field label="Company name">
            <Input value={f.company ?? ""} onChange={set("company")} placeholder="Acme Industries Pvt Ltd" />
          </Field>
          <div className="grid grid-2">
            <Field label="Contact person"><Input value={f.contact ?? ""} onChange={set("contact")} placeholder="Rahul Sharma" /></Field>
            <Field label="Designation"><Input value={f.designation ?? ""} onChange={set("designation")} placeholder="IT Head" /></Field>
            <Field label="Email"><Input type="email" value={f.email ?? ""} onChange={set("email")} /></Field>
            <Field label="Phone"><Input value={f.phone ?? ""} onChange={set("phone")} /></Field>
          </div>
        </div>

        <div className="stack">
          <div className="eyebrow">Registration</div>
          <div className="grid grid-2">
            <Field label="GSTIN">
              {/* A valid GSTIN fills in the state and the PAN. It never
                  overwrites a PAN already typed. */}
              <Input
                value={f.gstin ?? ""}
                onChange={(e) => setF(applyGstin(f, e.target.value.toUpperCase()))}
                invalid={["format", "checksum"].includes((validateGSTIN(f.gstin ?? "") as { reason?: string }).reason ?? "")}
                placeholder="27AAPFU0939F1ZV"
              />
              <GstinStatus gstin={f.gstin ?? ""} />
            </Field>
            <Field label="PAN" hint="Filled from a valid GSTIN unless you have typed one.">
              <Input value={f.pan ?? ""} onChange={set("pan")} placeholder="AAPFU0939F" />
            </Field>
          </div>
        </div>

        <div className="stack">
          <div className="eyebrow">Address</div>
          <Field label="Street address"><Textarea rows={2} value={f.address ?? ""} onChange={set("address")} /></Field>
          <div className="grid grid-2">
            <Field label="Country">
              {/* Changing country clears the state: leaving "Delhi" on a UAE
                  customer put an Indian state onto export documents and made
                  the tax engine treat the sale as intra-state. */}
              <Select value={f.country ?? "India"} onChange={(e) => setF(applyCountry(f, e.target.value))}>
                {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="State" hint={isIndia ? "Decides CGST+SGST versus IGST." : undefined}>
              {isIndia ? (
                <Select value={f.state ?? ""} onChange={set("state")}>
                  <option value="">Select a state…</option>
                  {STATE_NAMES.map((s) => <option key={s}>{s}</option>)}
                </Select>
              ) : (
                <Input value={f.state ?? ""} onChange={set("state")} placeholder="Province or emirate" />
              )}
            </Field>
            <Field label="City"><Input value={f.city ?? ""} onChange={set("city")} /></Field>
            <Field label="Pincode"><Input value={f.pincode ?? ""} onChange={set("pincode")} /></Field>
          </div>
        </div>

        <div className="stack">
          <div className="eyebrow">Commercial</div>
          <div className="grid grid-2">
            <Field label="Currency" hint="Flows into every new document for this customer.">
              <Select value={f.currency ?? "INR"} onChange={set("currency")}>
                {CURRENCIES.map(([code, , name]) => <option key={code} value={code}>{code} — {name}</option>)}
              </Select>
            </Field>
            <Field label="Tax regime">
              <Select value={f.taxType ?? "gst"} onChange={set("taxType")}>
                {TAX_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Segment">
              <Select value={f.segment ?? ""} onChange={set("segment")}>
                {SEGMENTS.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Source">
              <Select value={f.source ?? ""} onChange={set("source")}>
                {SOURCES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Stage">
              <Select value={f.stage ?? "lead"} onChange={set("stage")}>
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>
            <Field label="Deal value"><Input numeric value={String(f.value ?? "")} onChange={set("value")} /></Field>
            <Field label="Next follow-up"><Input type="date" value={f.nextFollowUp ?? ""} onChange={set("nextFollowUp")} /></Field>
            <Field label="Owner" hint={canReassign ? "Reassigning moves this customer's quotations, orders and subscriptions too." : "Only an admin or manager can reassign."}>
              <Select value={f.ownerId} onChange={set("ownerId")} disabled={!canReassign}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        {customFields.length ? (
          <div className="stack">
            <div className="eyebrow">Custom fields</div>
            <div className="grid grid-2">
              {customFields.map((cf) => (
                <Field key={cf.id} label={cf.label}>
                  <Input
                    value={f.customFields?.[cf.id] ?? ""}
                    onChange={(e) => setF({ ...f, customFields: { ...f.customFields, [cf.id]: e.target.value } })}
                  />
                </Field>
              ))}
            </div>
          </div>
        ) : null}

        {/* Signed POs, credit applications, GST certificates — the paperwork
            a customer record acquires. Kept outside the form's own state:
            files are stored the moment they are dropped, so they survive
            closing this sheet without saving. */}
        <AttachmentsPanel
          recordType="customer"
          recordId={customer.id}
          ownerId={f.ownerId}
          currentUser={{ id: currentUser?.id ?? "", name: currentUser?.name ?? "", role: currentUser?.role }}
        />

        {f.stage === "lost" && f.lostReason ? (
          <div className="row-tight">
            <Chip tone="bad">Lost</Chip>
            <span className="field-hint">{f.lostReason}{f.lostCompetitor ? ` — ${f.lostCompetitor}` : ""}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
