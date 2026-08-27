import { useCallback, useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import { AttachmentsPanel } from "../attachments/AttachmentsPanel";
import { NotesPanel } from "./NotesPanel";
import { VerifyPanel } from "./VerifyPanel";
import { addNote } from "../../domain/customers/notes";
import { askBeforeSave, useConfirmedAction } from "../../components/useConfirmedAction";
import { Button, Chip, Field, Input, Select, Textarea } from "../../components/primitives";
import { applyCountry, applyGstin, customerLabel, type Customer } from "../../domain/customers/customer";
import { checkDuplicate, duplicateCheckAvailable, type DuplicateHit } from "../../data/duplicateCheck";
import { gstinMessage, validateGSTIN } from "../../domain/gstin/validate";
import { COUNTRIES } from "../../domain/geo/countries";
import { STATE_NAMES } from "../../domain/geo/states";
import { SEGMENTS, SOURCES, STAGES, applyStage, type StageId } from "../../domain/pipeline/stages";
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
  /** False while the sheet is animating away. */
  open?: boolean;
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

export function CustomerSheet({ open = true, customer, users, customFields, canReassign, currentUser, settings = {}, onSave, onClose }: CustomerSheetProps) {
  const [f, setF] = useState<Customer>({ ...customer, notes: customer.notes ?? [], customFields: customer.customFields ?? {} });
  const set = <K extends keyof Customer>(k: K) => (e: { target: { value: string } }) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  const isIndia = !f.country || f.country === "India";

  /* LIVE DUPLICATE CHECK, on leaving a field rather than at save.
     Finding out at save that this company is already in the CRM means
     re-reading everything just typed to work out what to keep; finding out
     on leaving the name field means the question is asked before any of it
     was typed. Never while typing — an answer about half a company name is
     noise, and noise is what teaches people to ignore a warning. */
  const dup = useDuplicateCheck(f, customer);

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
      open={open}
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
          {/* Allocated by the database when the record is first saved, and
              never edited: it prints on every document raised for this
              customer, and two people typing their own would be two
              customers as far as any report is concerned. */}
          {f.code ? (
            <Field label="Customer ID" hint="Allocated automatically. Prints on this customer's documents.">
              <Input className="mono" value={f.code} readOnly disabled />
            </Field>
          ) : null}
          <Field label="Company name" hint={dup.hint}>
            <Input
              value={f.company ?? ""}
              onChange={set("company")}
              onBlur={() => dup.check()}
              placeholder="Acme Industries Pvt Ltd"
            />
          </Field>
          <div className="grid grid-2">
            <Field label="Contact person"><Input value={f.contact ?? ""} onChange={set("contact")} placeholder="Rahul Sharma" /></Field>
            <Field label="Designation"><Input value={f.designation ?? ""} onChange={set("designation")} placeholder="IT Head" /></Field>
            <Field label="Email"><Input type="email" value={f.email ?? ""} onChange={set("email")} /></Field>
            <Field label="Phone"><Input value={f.phone ?? ""} onChange={set("phone")} onBlur={() => dup.check()} /></Field>
            <Field label="Alternate phone" hint="For when the first one doesn't answer."><Input value={f.altPhone ?? ""} onChange={set("altPhone")} /></Field>
            <Field label="Website"><Input value={f.website ?? ""} onChange={set("website")} placeholder="www.example.com" /></Field>
          </div>

          {/* CONSENT, NOT A PREFERENCE. Meta requires opt-in before a
              business sends the first WhatsApp message, so this gates the
              automated channel entirely. Tick it only once the customer has
              actually agreed — on the registration form, on a call, or in
              writing. */}
          <label className="row-tight" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={f.whatsappOptIn === true}
              onChange={(e) => setF((cur) => ({ ...cur, whatsappOptIn: e.target.checked }))}
            />
            <span>They have agreed to be contacted on WhatsApp</span>
          </label>
          <div className="grid grid-2">
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

        {/* Against the government register, which is the only thing that
            knows whether a well-formed GSTIN belongs to anybody. */}
        <VerifyPanel customer={f} onChange={setF} />

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

          {/* WHERE THE GOODS GO. Held here rather than typed onto each
              document: a head office billing in Delhi and taking delivery at
              a plant in Bhiwadi is the ordinary case, and retyping it per
              document is how a consignment reaches an accounts department. */}
          <label className="row-tight" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={f.shipSame !== false}
              onChange={(e) => setF((cur) => ({ ...cur, shipSame: e.target.checked }))}
            />
            <span>Goods are delivered to the billing address</span>
          </label>

          {f.shipSame === false ? (
            <div className="stack">
              <Field label="Delivery address"><Textarea rows={2} value={f.shipAddress ?? ""} onChange={set("shipAddress")} /></Field>
              <div className="grid grid-2">
                <Field label="City"><Input value={f.shipCity ?? ""} onChange={set("shipCity")} /></Field>
                <Field label="Pincode"><Input value={f.shipPincode ?? ""} onChange={set("shipPincode")} /></Field>
                <Field label="State" hint="Blank uses the billing state.">
                  {isIndia ? (
                    <Select value={f.shipState ?? ""} onChange={set("shipState")}>
                      <option value="">Same as billing</option>
                      {STATE_NAMES.map((st) => <option key={st}>{st}</option>)}
                    </Select>
                  ) : (
                    <Input value={f.shipState ?? ""} onChange={set("shipState")} />
                  )}
                </Field>
                <Field label="Who receives it"><Input value={f.shipContact ?? ""} onChange={set("shipContact")} /></Field>
                <Field label="Phone at the site"><Input value={f.shipPhone ?? ""} onChange={set("shipPhone")} /></Field>
              </div>
            </div>
          ) : null}
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
              <Select
                value={f.stage ?? "lead"}
                /* Through applyStage, not straight onto the field: moving to
                   Won here used to set the stage and nothing else, so the
                   deal never got a `wonAt` and never appeared in a single
                   revenue chart. The board has always gone through it; this
                   select was the way round it. */
                onChange={(e) => setF((c) => applyStage(c, e.target.value as StageId))}
              >
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

        {/* Calls, emails and meetings. Folded into the record being edited
            rather than saved on its own, so a note and the follow-up date
            it was written to change go in together. */}
        <NotesPanel
          customer={f}
          currentUser={currentUser}
          onAdd={(draft) => setF((c) => addNote(c, draft, { id: currentUser?.id ?? "", name: currentUser?.name ?? "" }))}
        />

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

/* ── live duplicate check ──────────────────────────────────────────── */

/**
 * Ask the database whether this customer already exists, on leaving a field.
 *
 * ONLY FOR NEW RECORDS. Editing an existing customer must not raise a
 * "duplicate of itself" alarm, and the person editing already knows the
 * record exists — they are looking at it.
 *
 * "Checking…" is shown because there is a real network round trip behind it,
 * not to make an instant answer look like work. The check has to reach the
 * server precisely because the browser cannot see other people's customers —
 * see src/data/duplicateCheck.ts.
 */
function useDuplicateCheck(draft: Customer, original: Customer) {
  const [state, setState] = useState<"idle" | "checking" | "clear" | "found">("idle");
  const [hit, setHit] = useState<DuplicateHit | null>(null);
  /* What was last asked about, so leaving the same field twice does not ask
     the same question again. */
  const asked = useRef("");
  const isNew = !original.company && !original.gstin && !original.phone;

  const check = useCallback(() => {
    if (!isNew || !duplicateCheckAvailable()) return;

    const fields = {
      company: (draft.company ?? "").trim(),
      phone: (draft.phone ?? "").trim(),
      gstin: (draft.gstin ?? "").trim(),
    };
    const key = `${fields.company}|${fields.phone}|${fields.gstin}`;
    if (!fields.company && !fields.phone && !fields.gstin) { setState("idle"); return; }
    if (key === asked.current) return;
    asked.current = key;

    setState("checking");
    void checkDuplicate(fields)
      .then((found) => {
        setHit(found);
        setState(found ? "found" : "clear");
      })
      .catch((err) => {
        /* A check that could not run is NOT a clean result. Saying "no
           existing customer found" because the network dropped is the one
           answer this must never give. */
        console.error("duplicate check failed:", err);
        setState("idle");
      });
  }, [draft.company, draft.phone, draft.gstin, isNew]);

  const hint =
    state === "checking" ? <span className="inline-check">Checking…</span>
    : state === "clear" ? <span className="inline-check is-good">✓ No existing customer found</span>
    : state === "found" && hit
      ? <span className="inline-check is-warn">
          ⚠ {hit.company} already exists{hit.ownerName ? `, with ${hit.ownerName}` : ""}
        </span>
    : undefined;

  return { check, hint, hit, found: state === "found" };
}
