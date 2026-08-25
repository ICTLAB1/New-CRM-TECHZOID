import { useRef, useState } from "react";
import { BrandStripsPanel } from "./BrandStripsPanel";
import { FollowUpPanel } from "./FollowUpPanel";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Field, Input, Select, Tabs, Textarea } from "../../components/primitives";
import { Confirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { CURRENCIES } from "../../domain/currency/currencies";
import { STATE_NAMES } from "../../domain/geo/states";
import { normalizeDocTemplate, SECTION_ORDER_META, type DocTemplate, type SectionKey } from "../../domain/documents/template";
import { DOMESTIC_TERMS } from "../../domain/documents/terms";
import type { IncentiveScheme, IncentiveSlab } from "../../domain/incentives/incentives";
import { buildDocNumber } from "../../domain/numbering/docNumber";

/**
 * Settings.
 *
 * Everything here writes to one `settings` row, so the screen is organised by
 * the question being answered rather than by where the value happens to live:
 * who we are, what a document looks like, how documents are numbered and
 * taxed, what we say by default, who gets paid what, and how to get the data
 * out.
 *
 * Nothing saves as you type. Each panel commits on Save, because a settings
 * row that changes under a half-finished edit is how a company name ends up
 * as "TechZoid Technologies Priv".
 */

export interface SettingsScreenProps {
  settings: Record<string, unknown>;
  canEdit: boolean;
  /** Everything, for the backup file. */
  workspaceForBackup: () => Record<string, unknown>;
  onRestore: (data: Record<string, unknown>) => void;
  onChange: (next: Record<string, unknown>) => void;
}

type Tab = "company" | "document" | "numbering" | "terms" | "incentives" | "fields" | "backup" | "brands" | "followups";

const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function SettingsScreen({ settings, canEdit, workspaceForBackup, onRestore, onChange }: SettingsScreenProps) {
  const [tab, setTab] = useState<Tab>("company");

  return (
    <main className="page">
      <PageHead
        title="Settings"
        sub={canEdit ? "Company details, document appearance, numbering and defaults." : "Read-only — an admin can change these."}
      />

      <Tabs
        tabs={[
          { id: "company", label: "Company" },
          { id: "document", label: "Document" },
          { id: "brands", label: "Logos & brands" },
          { id: "numbering", label: "Numbering & tax" },
          { id: "terms", label: "Default terms" },
          { id: "followups", label: "Follow-ups" },
          { id: "incentives", label: "Incentives" },
          { id: "fields", label: "Custom fields" },
          { id: "backup", label: "Backup" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ marginTop: 16 }}>
        {tab === "company" ? <CompanyPanel settings={settings} canEdit={canEdit} onChange={onChange} /> : null}
        {tab === "document" ? <DocumentPanel settings={settings} canEdit={canEdit} onChange={onChange} /> : null}
        {tab === "brands" ? <BrandStripsPanel settings={settings} canEdit={canEdit} onChange={onChange} /> : null}
        {tab === "numbering" ? <NumberingPanel settings={settings} canEdit={canEdit} onChange={onChange} /> : null}
        {tab === "terms" ? <TermsPanel settings={settings} canEdit={canEdit} onChange={onChange} /> : null}
        {tab === "followups" ? <FollowUpPanel settings={settings} canEdit={canEdit} onChange={onChange} /> : null}
        {tab === "incentives" ? <IncentivesPanel settings={settings} canEdit={canEdit} onChange={onChange} /> : null}
        {tab === "fields" ? <FieldsPanel settings={settings} canEdit={canEdit} onChange={onChange} /> : null}
        {tab === "backup" ? (
          <BackupPanel canEdit={canEdit} workspaceForBackup={workspaceForBackup} onRestore={onRestore} />
        ) : null}
      </div>
    </main>
  );
}

/* A panel that edits a draft and commits on Save. `dirty` drives the button,
   so nothing is ever saved by accident and nothing is saved silently. */
function useDraft<T>(initial: T, commit: (next: T) => void, message: string) {
  const toast = useToast();
  const [draft, setDraft] = useState<T>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  return {
    draft,
    setDraft,
    dirty,
    save: () => { commit(draft); toast(message, "good"); },
    reset: () => setDraft(initial),
  };
}

function SaveBar({ dirty, canEdit, onSave, onReset }: { dirty: boolean; canEdit: boolean; onSave: () => void; onReset: () => void }) {
  if (!canEdit) return null;
  return (
    <div className="row-tight" style={{ marginTop: 16 }}>
      <Button tone="primary" disabled={!dirty} onClick={onSave}>Save</Button>
      {dirty ? <Button tone="quiet" onClick={onReset}>Discard changes</Button> : null}
      {dirty ? <span className="field-hint">Not saved yet.</span> : null}
    </div>
  );
}

/* ── company ───────────────────────────────────────────────────────── */

interface Company {
  name?: string; address?: string; city?: string; state?: string; pincode?: string;
  country?: string; gstin?: string; pan?: string; cin?: string;
  phone?: string; email?: string; website?: string; tagline?: string;
  /** The logo as a data URI, with the natural size it was uploaded at.
   *  Both are needed: without the dimensions a renderer cannot preserve the
   *  aspect ratio and would stretch it to fill its box. */
  logo?: string; logoW?: number; logoH?: number;
}

/** Largest logo we will store, measured on the encoded string rather than
 *  the file: a data URI is about a third larger than the bytes it carries,
 *  and this whole object goes into one settings row read on every load. */
const MAX_LOGO_DATA_URI = 400_000;

interface UaeOffice {
  address?: string; phone?: string; businessLicense?: string; taxRegistrationNumber?: string;
}

function CompanyPanel({ settings, canEdit, onChange }: { settings: Record<string, unknown>; canEdit: boolean; onChange: (s: Record<string, unknown>) => void }) {
  const company = (settings["company"] ?? {}) as Company;
  const uaeOffice = (settings["uaeOffice"] ?? {}) as UaeOffice;
  const { draft, setDraft, dirty, save, reset } = useDraft(
    {
      company, uaeOffice,
      signatoryName: String(settings["signatoryName"] ?? ""),
      signatoryDesignation: String(settings["signatoryDesignation"] ?? ""),
    },
    (next) => onChange({ ...settings, ...next }),
    "Company details saved",
  );

  const toast = useToast();
  const logoInput = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState("");

  const set = (key: keyof Company) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, company: { ...d.company, [key]: e.target.value } }));
  const setUae = (key: keyof UaeOffice) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, uaeOffice: { ...d.uaeOffice, [key]: e.target.value } }));

  /* Read in the browser and stored inline with the rest of the company
     details, so there is no file host to configure and no second thing that
     can be missing when a document renders. The natural size is measured
     here, once, rather than by every renderer at draw time. */
  const pickLogo = (file: File | undefined) => {
    setLogoError("");
    if (!file) return;
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) {
      setLogoError("That needs to be a PNG, JPG, SVG or WebP image.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setLogoError("Couldn't read that file. Try saving it again and re-picking it.");
    reader.onload = () => {
      const src = String(reader.result ?? "");
      if (src.length > MAX_LOGO_DATA_URI) {
        setLogoError(
          `That image is too large (about ${Math.round(src.length / 1024)} KB encoded). ` +
          "Around 300 KB or less is plenty — a logo prints at 46mm wide.",
        );
        return;
      }
      const img = new Image();
      img.onerror = () => setLogoError("That file doesn't look like an image the browser can read.");
      img.onload = () => {
        setDraft((d) => ({
          ...d,
          company: { ...d.company, logo: src, logoW: img.naturalWidth, logoH: img.naturalHeight },
        }));
        toast("Logo ready — press Save to keep it");
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const clearLogo = () => {
    setLogoError("");
    setDraft((d) => ({ ...d, company: { ...d.company, logo: "", logoW: 0, logoH: 0 } }));
  };

  return (
    <div className="stack">
      {/* Written straight through rather than into the draft: it is one
          boolean, and making somebody press Save to change whether they get
          asked before saving is a joke at their expense. */}
      <Card title="How this workspace behaves">
        <label className="row-tight" style={{ cursor: canEdit ? "pointer" : "default" }}>
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={settings["confirmBeforeSave"] !== false}
            onChange={(e) => onChange({ ...settings, confirmBeforeSave: e.target.checked })}
          />
          <span>Ask before saving a customer or a document</span>
        </label>
        <div className="field-hint" style={{ marginTop: 8 }}>
          On by default. Worth knowing: a question asked before every save stops being read after the
          twentieth one, and the reflex to dismiss it carries over to the dialogs that guard something
          irreversible. Deleting always asks, whatever this is set to.
        </div>
      </Card>

      <Card title="Who we are">
        <p className="muted" style={{ marginTop: 0 }}>
          This is what prints at the top of every quotation and proforma. The seller's state also decides
          CGST + SGST versus IGST on every document.
        </p>

        <div className="stack" style={{ marginTop: 14 }}>
          <Field
            label="Company logo"
            hint="Printed at the top-left of every quotation and proforma. A wide PNG with a transparent background works best."
          >
            <div className="row-tight wrap" style={{ gap: 12, alignItems: "center" }}>
              {draft.company.logo ? (
                <img
                  src={draft.company.logo}
                  alt="Company logo"
                  style={{ maxWidth: 180, maxHeight: 48, objectFit: "contain", border: "1px solid var(--rule)", borderRadius: 6, padding: 6, background: "#fff" }}
                />
              ) : (
                <span className="field-hint">
                  No logo yet — documents print the company name instead.
                </span>
              )}
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                style={{ display: "none" }}
                onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ""; }}
              />
              <Button size="sm" disabled={!canEdit} onClick={() => logoInput.current?.click()}>
                {draft.company.logo ? "Replace" : "Upload logo"}
              </Button>
              {draft.company.logo ? (
                <Button size="sm" tone="quiet" disabled={!canEdit} onClick={clearLogo}>Remove</Button>
              ) : null}
            </div>
          </Field>
          {logoError ? <div className="notice notice-bad"><span>{logoError}</span></div> : null}

          <Field label="Legal name" hint="Exactly as registered — this goes on documents a customer may present to their auditor.">
            <Input value={draft.company.name ?? ""} disabled={!canEdit} onChange={set("name")} />
          </Field>
          <Field label="Tagline" hint={'Printed under the legal name, e.g. "One procurement partner. Multiple technology brands."'}>
            <Input value={draft.company.tagline ?? ""} disabled={!canEdit} onChange={set("tagline")} />
          </Field>
          <Field label="Address">
            <Textarea rows={2} value={draft.company.address ?? ""} disabled={!canEdit} onChange={set("address")} />
          </Field>
          <div className="grid grid-3">
            <Field label="City"><Input value={draft.company.city ?? ""} disabled={!canEdit} onChange={set("city")} /></Field>
            <Field label="State" hint="Decides CGST+SGST versus IGST.">
              <Select value={draft.company.state ?? ""} disabled={!canEdit} onChange={set("state")}>
                <option value="">—</option>
                {STATE_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
              </Select>
            </Field>
            <Field label="PIN code"><Input value={draft.company.pincode ?? ""} disabled={!canEdit} onChange={set("pincode")} /></Field>
          </div>
          <div className="grid grid-3">
            <Field label="GSTIN"><Input className="mono" value={draft.company.gstin ?? ""} disabled={!canEdit} onChange={set("gstin")} /></Field>
            <Field label="PAN"><Input className="mono" value={draft.company.pan ?? ""} disabled={!canEdit} onChange={set("pan")} /></Field>
            <Field label="CIN"><Input className="mono" value={draft.company.cin ?? ""} disabled={!canEdit} onChange={set("cin")} /></Field>
          </div>
          <div className="grid grid-3">
            <Field label="Phone"><Input value={draft.company.phone ?? ""} disabled={!canEdit} onChange={set("phone")} /></Field>
            <Field label="Email"><Input type="email" value={draft.company.email ?? ""} disabled={!canEdit} onChange={set("email")} /></Field>
            <Field label="Website"><Input value={draft.company.website ?? ""} disabled={!canEdit} onChange={set("website")} /></Field>
          </div>
          <div className="grid grid-2">
            <Field label="Authorised signatory" hint="Whoever signs on behalf of the company. Prints in the signature block on the document itself.">
              <Input value={draft.signatoryName} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, signatoryName: e.target.value }))} />
            </Field>
            <Field label="Their designation" hint="Each person's own job title, for the signature on email they send, is set on their profile in Team.">
              <Input value={draft.signatoryDesignation} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, signatoryDesignation: e.target.value }))} />
            </Field>
          </div>
        </div>

        <SaveBar dirty={dirty} canEdit={canEdit} onSave={save} onReset={reset} />
      </Card>

      <Card title="UAE office">
        <p className="muted" style={{ marginTop: 0 }}>
          Printed as a banner under the header on every quotation and proforma. Leave blank to hide it —
          also controlled by the "UAE office" toggle on the Document tab.
        </p>

        <div className="stack" style={{ marginTop: 14 }}>
          <Field label="Address" hint={'Free text, e.g. "Office C1-1F-SF2571, Ajman Free Zone C1 Building, Ajman Free Zone, Ajman".'}>
            <Textarea rows={2} value={draft.uaeOffice.address ?? ""} disabled={!canEdit} onChange={setUae("address")} />
          </Field>
          <div className="grid grid-3">
            <Field label="Phone"><Input value={draft.uaeOffice.phone ?? ""} disabled={!canEdit} onChange={setUae("phone")} /></Field>
            <Field label="Business licence number">
              <Input className="mono" value={draft.uaeOffice.businessLicense ?? ""} disabled={!canEdit} onChange={setUae("businessLicense")} />
            </Field>
            <Field label="Tax registration number">
              <Input className="mono" value={draft.uaeOffice.taxRegistrationNumber ?? ""} disabled={!canEdit} onChange={setUae("taxRegistrationNumber")} />
            </Field>
          </div>
        </div>

        <SaveBar dirty={dirty} canEdit={canEdit} onSave={save} onReset={reset} />
      </Card>
    </div>
  );
}

/* ── document appearance ───────────────────────────────────────────── */

const TOGGLE_LABELS: Record<string, string> = {
  uaeOffice: "UAE office banner in the header",
  isoCerts: "ISO certification badges",
  terms: "Terms & conditions block",
  bankDetails: "Bank details (proforma)",
  customerAcceptance: "Customer acceptance box",
  partnerLogos: "Partner logo strip",
  yearsOfExcellence: "Years of excellence badge",
  notes: "Notes (proforma)",
  salutation: "Salutation line",
  amountInWords: "Amount in words",
};

const COLUMN_LABELS: Record<string, string> = {
  subDesc: "Sub-description under each item",
  brand: "Brand logo column",
  sku: "Part / SKU column",
  hsn: "HSN / SAC column",
};

function DocumentPanel({ settings, canEdit, onChange }: { settings: Record<string, unknown>; canEdit: boolean; onChange: (s: Record<string, unknown>) => void }) {
  const stored = normalizeDocTemplate(settings["docTemplate"] as Partial<DocTemplate>);
  const { draft, setDraft, dirty, save, reset } = useDraft<DocTemplate>(
    stored,
    (next) => onChange({ ...settings, docTemplate: next }),
    "Document template saved",
  );
  const [showWording, setShowWording] = useState(false);

  const move = (key: SectionKey, by: number) => {
    setDraft((d) => {
      const order = [...d.sectionOrder];
      const from = order.indexOf(key);
      const to = from + by;
      if (from < 0 || to < 0 || to >= order.length) return d;
      order.splice(to, 0, ...order.splice(from, 1));
      return { ...d, sectionOrder: order };
    });
  };

  return (
    <div className="stack">
      <Card title="What appears on a document">
        <p className="muted" style={{ marginTop: 0 }}>
          Switching a block off hides it on every quotation and proforma, including ones already saved — the
          document is rendered fresh each time, never stored as a picture.
        </p>
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          {Object.entries(TOGGLE_LABELS).map(([key, label]) => (
            <label className="row-tight" key={key} style={{ cursor: canEdit ? "pointer" : "default" }}>
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={draft.sections[key as keyof typeof draft.sections] !== false}
                onChange={(e) => setDraft((d) => ({ ...d, sections: { ...d.sections, [key]: e.target.checked } }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div style={{ marginTop: 18 }}>
          <span className="eyebrow">Items table columns</span>
          <div className="grid grid-2" style={{ marginTop: 8 }}>
            {Object.entries(COLUMN_LABELS).map(([key, label]) => (
              <label className="row-tight" key={key} style={{ cursor: canEdit ? "pointer" : "default" }}>
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={draft.columns[key as keyof typeof draft.columns] !== false}
                  onChange={(e) => setDraft((d) => ({ ...d, columns: { ...d.columns, [key]: e.target.checked } }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Turning a column off gives its width back to the description, which is the column that always
            wants more.
          </div>
        </div>

        <SaveBar dirty={dirty} canEdit={canEdit} onSave={save} onReset={reset} />
      </Card>

      <Card title="Order of the blocks">
        <p className="muted" style={{ marginTop: 0 }}>Top to bottom, as they print.</p>
        <div className="stack" style={{ gap: 4, marginTop: 10 }}>
          {draft.sectionOrder.map((key, i) => (
            <div className="spread" key={key} style={{ gap: 10, padding: "5px 0", borderBottom: "1px solid var(--rule)" }}>
              <span>
                <strong>{SECTION_ORDER_META[key]?.label ?? key}</strong>
                <span className="muted"> — {SECTION_ORDER_META[key]?.hint}</span>
              </span>
              {canEdit ? (
                <span className="row-tight">
                  <Button size="sm" tone="quiet" disabled={i === 0} onClick={() => move(key, -1)} aria-label={`Move ${key} up`}>Up</Button>
                  <Button size="sm" tone="quiet" disabled={i === draft.sectionOrder.length - 1} onClick={() => move(key, 1)} aria-label={`Move ${key} down`}>Down</Button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <SaveBar dirty={dirty} canEdit={canEdit} onSave={save} onReset={reset} />
      </Card>

      <Card
        title="Wording"
        actions={<Button size="sm" tone="default" onClick={() => setShowWording((v) => !v)}>
          {showWording ? "Hide" : "Show the printed wording"}
        </Button>}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Every fixed phrase on a document. Worth changing rarely — these appear on paper a customer keeps.
        </p>
        {showWording ? (
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            {(Object.keys(draft.labels) as (keyof typeof draft.labels)[]).map((key) => (
              <Field key={key} label={key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}>
                <Input
                  value={draft.labels[key]}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({ ...d, labels: { ...d.labels, [key]: e.target.value } }))}
                />
              </Field>
            ))}
          </div>
        ) : null}
        <SaveBar dirty={dirty} canEdit={canEdit} onSave={save} onReset={reset} />
      </Card>
    </div>
  );
}

/* ── numbering and tax ─────────────────────────────────────────────── */

function NumberingPanel({ settings, canEdit, onChange }: { settings: Record<string, unknown>; canEdit: boolean; onChange: (s: Record<string, unknown>) => void }) {
  const { draft, setDraft, dirty, save, reset } = useDraft(
    {
      quotePrefix: String(settings["quotePrefix"] ?? "TZ/QT"),
      quoteSeq: Number(settings["quoteSeq"] ?? 1),
      proformaPrefix: String(settings["proformaPrefix"] ?? "TZ/PI"),
      proformaSeq: Number(settings["proformaSeq"] ?? 1),
      defaultCurrency: String(settings["defaultCurrency"] ?? "INR"),
      defaultTaxType: String(settings["defaultTaxType"] ?? "gst"),
      defaultGst: Number(settings["defaultGst"] ?? 18),
      defaultValidityDays: Number(settings["defaultValidityDays"] ?? 15),
    },
    (next) => onChange({ ...settings, ...next }),
    "Numbering and tax defaults saved",
  );

  return (
    <div className="stack">
      <Card title="Document numbers">
        <p className="muted" style={{ marginTop: 0 }}>
          The financial-year segment and the four-digit padding are fixed: documents already in the database
          carry this exact shape, and a number that changes shape stops matching what a customer has on file.
        </p>
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <Field label="Quotation prefix" hint={`Next: ${buildDocNumber(draft.quotePrefix, draft.quoteSeq)}`}>
            <Input value={draft.quotePrefix} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, quotePrefix: e.target.value }))} />
          </Field>
          <Field label="Next quotation number" hint="Only ever advances when a document is actually saved.">
            <Input numeric type="number" value={draft.quoteSeq} disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, quoteSeq: Number(e.target.value) || 1 }))} />
          </Field>
          <Field label="Proforma prefix" hint={`Next: ${buildDocNumber(draft.proformaPrefix, draft.proformaSeq)}`}>
            <Input value={draft.proformaPrefix} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, proformaPrefix: e.target.value }))} />
          </Field>
          <Field label="Next proforma number">
            <Input numeric type="number" value={draft.proformaSeq} disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, proformaSeq: Number(e.target.value) || 1 }))} />
          </Field>
        </div>
      </Card>

      <Card title="Defaults for a new document">
        <div className="grid grid-2">
          <Field label="Currency">
            <Select value={draft.defaultCurrency} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, defaultCurrency: e.target.value }))}>
              {CURRENCIES.map(([code, , name]) => <option key={code} value={code}>{code} — {name}</option>)}
            </Select>
          </Field>
          <Field label="Tax regime" hint="An export customer is set to no tax regardless — GST cannot apply.">
            <Select value={draft.defaultTaxType} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, defaultTaxType: e.target.value }))}>
              <option value="gst">GST (India)</option>
              <option value="vat">VAT</option>
              <option value="sales_tax">Sales tax</option>
              <option value="none">No tax</option>
            </Select>
          </Field>
          <Field label="Default GST rate" hint="Per cent, applied to a new line item.">
            <Input numeric type="number" value={draft.defaultGst} disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, defaultGst: Number(e.target.value) || 0 }))} />
          </Field>
          <Field label="Quotation validity" hint="Days. A quotation past this reads as Expired.">
            <Input numeric type="number" value={draft.defaultValidityDays} disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, defaultValidityDays: Number(e.target.value) || 0 }))} />
          </Field>
        </div>
        <SaveBar dirty={dirty} canEdit={canEdit} onSave={save} onReset={reset} />
      </Card>
    </div>
  );
}

/* ── default terms ─────────────────────────────────────────────────── */

function TermsPanel({ settings, canEdit, onChange }: { settings: Record<string, unknown>; canEdit: boolean; onChange: (s: Record<string, unknown>) => void }) {
  const stored = (settings["defaultTerms"] as string[] | undefined) ?? [...DOMESTIC_TERMS];
  const { draft, setDraft, dirty, save, reset } = useDraft<string[]>(
    stored,
    (next) => onChange({ ...settings, defaultTerms: next }),
    "Default terms saved",
  );

  return (
    <Card title="Default terms and conditions">
      <p className="muted" style={{ marginTop: 0 }}>
        Copied onto every new quotation, where they can still be edited per document. Changing them here does
        not touch documents already saved — a quotation's terms are part of what was agreed.
      </p>

      <div className="stack" style={{ marginTop: 14, gap: 8 }}>
        {draft.map((clause, i) => (
          <div className="row-tight" key={i} style={{ alignItems: "flex-start" }}>
            <span className="muted mono" style={{ paddingTop: 7, minWidth: 22 }}>{i + 1}.</span>
            <Textarea
              rows={2}
              value={clause}
              disabled={!canEdit}
              style={{ flex: 1 }}
              onChange={(e) => setDraft((d) => d.map((c, j) => (j === i ? e.target.value : c)))}
            />
            {canEdit ? (
              <Button size="sm" tone="danger" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>Remove</Button>
            ) : null}
          </div>
        ))}
        {canEdit ? (
          <div className="row-tight">
            <Button tone="default" onClick={() => setDraft((d) => [...d, ""])}>Add a clause</Button>
            <Button tone="quiet" onClick={() => setDraft([...DOMESTIC_TERMS])}>Restore the standard set</Button>
          </div>
        ) : null}
      </div>

      <SaveBar dirty={dirty} canEdit={canEdit} onSave={save} onReset={reset} />
    </Card>
  );
}

/* ── incentive schemes ─────────────────────────────────────────────── */

const METRICS = ["Revenue", "Deals Won", "Quotations Sent", "Renewals", "New Customers"] as const;

function IncentivesPanel({ settings, canEdit, onChange }: { settings: Record<string, unknown>; canEdit: boolean; onChange: (s: Record<string, unknown>) => void }) {
  const stored = (settings["incentiveSchemes"] as IncentiveScheme[] | undefined) ?? [];
  const { draft, setDraft, dirty, save, reset } = useDraft<IncentiveScheme[]>(
    stored,
    (next) => onChange({ ...settings, incentiveSchemes: next }),
    "Incentive schemes saved",
  );

  const patchScheme = (id: string, patch: Partial<IncentiveScheme>) =>
    setDraft((d) => d.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const patchSlab = (schemeId: string, slabId: string, patch: Partial<IncentiveSlab>) =>
    setDraft((d) => d.map((s) => (s.id === schemeId
      ? { ...s, slabs: s.slabs.map((sl) => (sl.id === slabId ? { ...sl, ...patch } : sl)) }
      : s)));

  const addScheme = () => setDraft((d) => [...d, {
    id: uid(), name: "New scheme", description: "", period: "Quarterly", active: false, slabs: [],
  }]);

  return (
    <div className="stack">
      <Card
        title="Commission schemes"
        actions={canEdit ? <Button size="sm" tone="primary" onClick={addScheme}>Add a scheme</Button> : null}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Each scheme measures one period and pays per slab. A percentage payout is always a percentage of
          revenue earned in that period, whatever the slab is measured on — that is how every payout so far
          has been worked out, so it has been left exactly as it was.
        </p>
        {draft.length === 0 ? (
          <Empty
            title="No schemes yet"
            body="Until one is active, the Incentives screen tells everyone there is nothing to show."
            action={canEdit ? <Button tone="primary" onClick={addScheme}>Add a scheme</Button> : null}
          />
        ) : null}
        <SaveBar dirty={dirty} canEdit={canEdit} onSave={save} onReset={reset} />
      </Card>

      {draft.map((scheme) => (
        <Card
          key={scheme.id}
          title={scheme.name || "Untitled scheme"}
          actions={
            <span className="row-tight">
              <Chip tone={scheme.active ? "good" : "neutral"}>{scheme.active ? "Active" : "Inactive"}</Chip>
              {canEdit ? (
                <Button size="sm" tone="danger" onClick={() => setDraft((d) => d.filter((s) => s.id !== scheme.id))}>Remove</Button>
              ) : null}
            </span>
          }
        >
          <div className="grid grid-2">
            <Field label="Name">
              <Input value={scheme.name} disabled={!canEdit} onChange={(e) => patchScheme(scheme.id, { name: e.target.value })} />
            </Field>
            <Field label="Period">
              <Select value={scheme.period} disabled={!canEdit} onChange={(e) => patchScheme(scheme.id, { period: e.target.value })}>
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly — Indian financial quarters</option>
                <option value="Yearly">Financial year</option>
              </Select>
            </Field>
            <Field label="Description" hint="Shown to whoever is being paid on it.">
              <Input value={scheme.description ?? ""} disabled={!canEdit} onChange={(e) => patchScheme(scheme.id, { description: e.target.value })} />
            </Field>
            <Field label="Status" hint="Only active schemes appear on the Incentives screen.">
              <Select value={scheme.active ? "active" : "inactive"} disabled={!canEdit}
                onChange={(e) => patchScheme(scheme.id, { active: e.target.value === "active" })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="spread">
              <span className="eyebrow">Slabs</span>
              {canEdit ? (
                <Button size="sm" tone="default" onClick={() => patchScheme(scheme.id, {
                  slabs: [...scheme.slabs, { id: uid(), metric: "Revenue", minTarget: 0, maxTarget: 0, payoutType: "Percentage", payoutValue: 5, bonusFlat: 0 }],
                })}>Add a slab</Button>
              ) : null}
            </div>

            {scheme.slabs.length === 0 ? (
              <div className="field-hint" style={{ marginTop: 8 }}>No slabs — this scheme pays nothing.</div>
            ) : (
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Measured on</th><th className="num">From</th><th className="num">To</th>
                      <th>Pays</th><th className="num">Value</th><th className="num">Bonus</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {scheme.slabs.map((slab) => (
                      <tr key={slab.id}>
                        <td>
                          <Select value={slab.metric} disabled={!canEdit} onChange={(e) => patchSlab(scheme.id, slab.id, { metric: e.target.value })}>
                            {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
                          </Select>
                        </td>
                        <td><Input numeric type="number" value={slab.minTarget} disabled={!canEdit}
                          onChange={(e) => patchSlab(scheme.id, slab.id, { minTarget: Number(e.target.value) || 0 })} /></td>
                        <td><Input numeric type="number" value={slab.maxTarget} disabled={!canEdit}
                          title="0 means no upper limit"
                          onChange={(e) => patchSlab(scheme.id, slab.id, { maxTarget: Number(e.target.value) || 0 })} /></td>
                        <td>
                          <Select value={slab.payoutType} disabled={!canEdit} onChange={(e) => patchSlab(scheme.id, slab.id, { payoutType: e.target.value })}>
                            <option value="Percentage">% of revenue</option>
                            <option value="Flat">Flat amount</option>
                          </Select>
                        </td>
                        <td><Input numeric type="number" value={slab.payoutValue} disabled={!canEdit}
                          onChange={(e) => patchSlab(scheme.id, slab.id, { payoutValue: Number(e.target.value) || 0 })} /></td>
                        <td><Input numeric type="number" value={slab.bonusFlat} disabled={!canEdit}
                          onChange={(e) => patchSlab(scheme.id, slab.id, { bonusFlat: Number(e.target.value) || 0 })} /></td>
                        <td>
                          {canEdit ? (
                            <Button size="sm" tone="danger" onClick={() => patchScheme(scheme.id, { slabs: scheme.slabs.filter((sl) => sl.id !== slab.id) })}>Remove</Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="field-hint" style={{ marginTop: 8 }}>
              An upper limit of 0 means no ceiling. A bonus is paid on top of the slab's payout, not instead of it.
            </div>
          </div>

          <SaveBar dirty={dirty} canEdit={canEdit} onSave={save} onReset={reset} />
        </Card>
      ))}
    </div>
  );
}

/* ── custom fields ─────────────────────────────────────────────────── */

function FieldsPanel({ settings, canEdit, onChange }: { settings: Record<string, unknown>; canEdit: boolean; onChange: (s: Record<string, unknown>) => void }) {
  const stored = (settings["customFields"] as { id: string; label: string }[] | undefined) ?? [];
  const { draft, setDraft, dirty, save, reset } = useDraft(
    stored,
    (next) => onChange({ ...settings, customFields: next }),
    "Custom fields saved",
  );
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; label: string } | null>(null);

  return (
    <Card
      title="Extra fields on a customer"
      actions={canEdit ? (
        <Button size="sm" tone="primary" onClick={() => setDraft((d) => [...d, { id: uid(), label: "" }])}>Add a field</Button>
      ) : null}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Anything the business tracks that this CRM has no column for — a vendor code, an agreed credit term.
        They appear at the bottom of every customer record.
      </p>

      {draft.length === 0 ? (
        <Empty title="No extra fields" body="Most teams need none. Add one only when the same note keeps being typed." />
      ) : (
        <div className="stack" style={{ marginTop: 12, gap: 8 }}>
          {draft.map((field) => (
            <div className="row-tight" key={field.id}>
              <Input
                value={field.label}
                disabled={!canEdit}
                placeholder="Field name as it appears on the customer"
                style={{ flex: 1 }}
                onChange={(e) => setDraft((d) => d.map((f) => (f.id === field.id ? { ...f, label: e.target.value } : f)))}
              />
              {canEdit ? (
                <Button size="sm" tone="danger" onClick={() => setConfirmRemove(field)}>Remove</Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <SaveBar dirty={dirty} canEdit={canEdit} onSave={save} onReset={reset} />

      <Confirm
        open={!!confirmRemove}
        title="Remove this field?"
        body={<>
          The field stops appearing on customer records. Anything already typed into it stays in the record
          and comes back if the field is added again — nothing is deleted.
        </>}
        confirmLabel="Remove the field"
        tone="danger"
        onConfirm={() => {
          setDraft((d) => d.filter((f) => f.id !== confirmRemove?.id));
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </Card>
  );
}

/* ── backup ────────────────────────────────────────────────────────── */

function BackupPanel({
  canEdit, workspaceForBackup, onRestore,
}: {
  canEdit: boolean;
  workspaceForBackup: () => Record<string, unknown>;
  onRestore: (data: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  const download = () => {
    const payload = { ...workspaceForBackup(), exportedAt: new Date().toISOString(), version: 2 };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `techzoid-crm-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast("Backup downloaded", "good");
  };

  const read = async (file: File) => {
    setError("");
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      if (!Array.isArray(data["customers"])) {
        throw new Error("no customer list");
      }
      setPending(data);
    } catch {
      setError("That file isn't a CRM backup — it has no customer list in it.");
    }
  };

  const counts = pending
    ? (["customers", "quotations", "proformas", "orders", "challans", "subscriptions"] as const)
      .map((key) => [key, Array.isArray(pending[key]) ? (pending[key] as unknown[]).length : 0] as const)
    : [];

  return (
    <Card title="Backup and restore">
      <p className="muted" style={{ marginTop: 0 }}>
        Records live in the shared workspace, which is backed up by Supabase. This is for taking a copy you
        hold yourself — before a big import, or to move the data somewhere else.
      </p>

      <div className="row-tight wrap" style={{ marginTop: 14 }}>
        <Button tone="primary" onClick={download}>Download a backup</Button>
        {canEdit ? (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void read(file);
              }}
            />
            <Button tone="default" onClick={() => fileInput.current?.click()}>Restore from a file</Button>
          </>
        ) : null}
      </div>

      {error ? <div className="notice notice-bad" style={{ marginTop: 12 }}><span>{error}</span></div> : null}

      <Confirm
        open={!!pending}
        title="Replace everything with this backup?"
        body={
          <div className="stack">
            <p style={{ margin: 0 }}>
              This replaces every record currently in the workspace with what is in the file. There is no undo
              — download a backup of what is here first if you might want it.
            </p>
            <div className="notice notice-flat">
              <div className="stack" style={{ gap: 3, width: "100%" }}>
                {counts.map(([key, n]) => (
                  <div className="spread" key={key}>
                    <span className="muted">{key}</span>
                    <span className="mono">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        }
        confirmLabel="Replace everything"
        tone="danger"
        onConfirm={() => {
          if (pending) {
            onRestore(pending);
            toast("Backup restored", "good");
          }
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </Card>
  );
}
