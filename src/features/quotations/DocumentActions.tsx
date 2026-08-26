import { useState } from "react";
import { Button } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { Confirm, Modal } from "../../components/Modal";
import { Field, Input, Textarea } from "../../components/primitives";
import { WhatsAppDialog } from "../integrations/WhatsAppDialog";
import { SendForInvoicing } from "../integrations/SendForInvoicing";
import { downloadPdf, pdfAttachment, previewPdf } from "../../documents/pdf/deliver";
import { fmtCurrency } from "../../domain/currency/format";
import { amountInWordsForCurrency } from "../../domain/words/amountInWords";
import { fmtDate } from "../../domain/dates";
import type { DocImages } from "../../documents/pdf/render";
import type { DocType, DocumentModel } from "../../domain/documents/model";
import type { ComputedRow, DocumentTotals } from "../../domain/tax/types";
import type { SalesDocument } from "../../domain/documents/create";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";
import {
  buildEmailHtml, buildEmailText,
  type EmailCompany, type EmailQuotation, type EmailSender,
} from "../../domain/integrations/emailTemplate";
import {
  autoFollowUpsOn, followUpBody, followUpSubject, planFollowUps, readSteps, stopReason,
  TONE_LABELS, type FollowUpFacts, type FollowUpTone,
} from "../../domain/followups/followups";
import { armFollowUps, followUpsAvailable, type ArmedStep } from "../../data/followups";
import { TODAY } from "../../domain/dates";

/* NO DEFAULT CC ADDRESS HERE. A real address baked into a template is one
   nobody remembers to change when the person leaves, and it goes on every
   quotation this company sends. It is configured in Settings → Integrations
   and read from there; empty means nobody is copied, which is honest. */

/**
 * Everything you can do with a finished document: keep it, send it, or hand
 * it to accounts.
 *
 * All four routes render the PDF through the same function, so what the
 * customer receives is what was downloaded and what accounts were sent.
 */

export interface DocumentActionsProps {
  api: IntegrationsApi;
  doc: SalesDocument;
  docType: DocType;
  model: DocumentModel;
  rows: ComputedRow[];
  totals: DocumentTotals;
  settings: Record<string, unknown>;
  images?: DocImages;
  /** Whose name, role and address the email carries. */
  currentUser?: { id: string; name: string; email?: string; designation?: string };
  /** Called once the customer actually has the document. The editor uses it
   *  to record that it was sent — until now nothing did, so a quotation
   *  emailed on Monday still read "Draft" on Friday, and the deal sat in
   *  Lead on the pipeline board. */
  onSent?: () => void;
}

const label = (docType: DocType): string =>
  docType === "purchase_order" ? "Purchase Order" : docType === "proforma" ? "Proforma Invoice" : "Quotation";

/** What we say when sending a document out. Kept short: it is read on a
 *  phone, usually while the sender is on a call. */
function defaultMessage(doc: SalesDocument, docType: DocType): string {
  /* The contact's name where we have one, and NO GREETING LINE AT ALL where
     we do not. "Dear Sir/Madam" and "Dear Customer" both announce that the
     sender did not know who they were writing to, which is a poor first line
     on a document asking for money. */
  const person = docType === "purchase_order"
    ? doc.vendorContact
    : doc.billContact;

  return [
    person ? `Dear ${person},` : "",
    person ? "" : "",
    /* The number and what is attached, in one line. The summary block below
       repeats the figures in a form that is easier to scan; this paragraph
       exists so the message reads as a message. */
    `Please find attached ${label(docType)} ${doc.number}, dated ${fmtDate(doc.date)}.`,
    "",
    "The headline figures are below and the attached document carries the full specification and terms.",
    "",
    "Best regards,",
    doc.preparedBy || "",
  ].filter((l, i, all) => !(l === "" && (i === 0 || all[i - 1] === ""))).join("\n");
}

export function DocumentActions({
  api, doc, docType, model, rows, totals, settings, images, currentUser, onSent,
}: DocumentActionsProps) {
  const toast = useToast();
  const [emailOpen, setEmailOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);

  const renderOpts = { model, rows, images };
  const message = defaultMessage(doc, docType);

  const company = (settings["company"] ?? {}) as Record<string, unknown>;

  /* Everyone who sends a quotation copies the same address, so it is filled
     in rather than remembered — but left editable, because "always" is not
     the same as "without exception". Configurable so this does not need a
     code change the day it moves. */
  const autoCc = String(settings["quoteCcEmail"] ?? "");

  const emailBrand: EmailCompany = {
    name: String(company["name"] ?? ""),
    tagline: String(company["tagline"] ?? ""),
    website: String(company["website"] ?? ""),
    phone: String(company["phone"] ?? ""),
    email: String(company["email"] ?? ""),
    logo: String(company["logo"] ?? "") || undefined,
    addressLines: model.header.addressLines,
    gstin: String(company["gstin"] ?? ""),
    pan: String(company["pan"] ?? ""),
    cin: String(company["cin"] ?? ""),
    /* The certification NAMES, taken from the same strip the document
       prints, so the two can never disagree about what this company is
       certified to. Text, not the badges — see EmailCompany. */
    certifications: model.strips.certifications.map((c) => c.text).filter(Boolean),
  };

  /* The person actually sending, falling back to whoever prepared the
     document — never to the company's own generic details, which would put
     an anonymous signature on a personal message. */
  const emailSender: EmailSender = {
    name: currentUser?.name || doc.preparedBy || "",
    /* Their own job title, from their profile in Team. NOT
       settings.signatoryDesignation — that names whoever signs quotations on
       behalf of the company and prints on the document itself, so using it
       here put the same title under everybody's signature. Left blank rather
       than borrowed when a profile has none: a wrong job title on a customer
       email is worse than no job title. */
    designation: currentUser?.designation || "",
    email: currentUser?.email || "",
    phone: String(company["phone"] ?? ""),
  };

  /* A purchase order is addressed to the supplier, and its counterparty
     fields are the vendor's rather than the bill-to party's. */
  const isPo = docType === "purchase_order";
  const toAddress = isPo ? doc.vendorEmail : doc.billEmail;
  const toPhone = isPo ? doc.vendorPhone : doc.billPhone;
  const counterparty = isPo ? doc.vendorName : doc.billName;

  /* The document's own facts, formatted ONCE here and passed as strings, so
     the email cannot round or localise differently from the PDF built from
     the same totals.

     Nothing about cost, margin or commission is included — and there is
     nothing to exclude: no such field exists on a line item in this product
     (see LineItem in domain/tax/types.ts). The shape is the guard if one is
     ever added. */
  const money = (n: number) => fmtCurrency(n, doc.currency);
  const moneyRows: Array<[string, string]> = [
    ["Subtotal", money(totals.gross)],
    ...(totals.discount > 0 ? [["Discount", "- " + money(totals.discount)] as [string, string]] : []),
    ["Taxable value", money(totals.taxable)],
    /* Tax is ALWAYS split out. A single tax-inclusive figure tells a finance
       team nothing and invites a phone call. */
    ...(totals.intra
      ? ([["CGST", money(totals.cgst)], ["SGST", money(totals.sgst)]] as Array<[string, string]>)
      : totals.igst > 0
        ? ([["IGST", money(totals.igst)]] as Array<[string, string]>)
        : []),
    ...(totals.roundDiff ? [["Rounding", money(totals.roundDiff)] as [string, string]] : []),
  ];

  const emailQuotation: EmailQuotation = {
    label: label(docType),
    number: doc.number,
    date: fmtDate(doc.date),
    validLabel: isPo ? "Required by" : docType === "invoice" ? "Payment due" : "Valid until",
    validUntil: doc.validUntil ? fmtDate(doc.validUntil) : null,
    items: totals.rows.map((r) => ({
      desc: String(r.desc ?? ""),
      qty: `${r.qty ?? ""}${r.unit ? " " + r.unit : ""}`.trim(),
      rate: money(Number(r.rate) || 0),
      total: money(r.total),
    })),
    moneyRows,
    grand: money(totals.grand),
    grandWords: amountInWordsForCurrency(totals.grand, doc.currency),
    /* Only a real quotation is an offer. Saying "not an invoice" on a tax
       invoice would be a lie. */
    isOffer: docType === "quotation",
    confirmTo: currentUser?.email || undefined,
  };

  /* A follow-up chases a document the customer already has, so it is offered
     on the two that ask them for a decision. A purchase order chases a
     supplier and an invoice chases money — both are different conversations
     with their own screens. */
  const canFollowUp = docType === "quotation" || docType === "proforma";

  const followUpFacts: FollowUpFacts = {
    label: label(docType),
    number: doc.number,
    date: fmtDate(doc.date),
    validUntil: doc.validUntil ? fmtDate(doc.validUntil) : null,
    contact: doc.billContact || undefined,
    senderName: currentUser?.name || doc.preparedBy || "",
  };

  /* What arming would schedule, worked out here so the send dialog can show
     the actual dates rather than "we'll follow up" — the person pressing
     Send is the last human who sees these emails before a customer does. */
  const plannedFollowUps = canFollowUp
    ? planFollowUps(TODAY(), readSteps(settings["followUpSteps"]), doc.validUntil || null)
    : [];

  /* WHY IT CANNOT ARM, IN THE PLACE SOMEBODY WOULD LOOK FOR IT. The first
     version simply hid the tick box whenever a sequence was impossible, so a
     quotation whose validity had run out showed nothing at all — and "the
     feature is missing" is the only conclusion available from that. */
  const cannotArm = !canFollowUp ? null
    : !followUpsAvailable() ? "Automatic follow-ups need a signed-in workspace."
    : !autoFollowUpsOn(settings) ? "Switched off in Settings → Follow-ups."
    : stopReason({ status: doc.status, validUntil: doc.validUntil })
      ? `Nothing to chase — ${stopReason({ status: doc.status, validUntil: doc.validUntil })}.`
    : plannedFollowUps.length === 0
      ? `Every step in the sequence would land after ${doc.validUntil ? fmtDate(doc.validUntil) : "this document lapses"}. Move Valid until further out, or shorten the sequence in Settings → Follow-ups.`
    : null;

  const armable = canFollowUp && !cannotArm && plannedFollowUps.length > 0
    ? {
        ownerId: doc.ownerId,
        docType: docType as "quotation" | "proforma",
        docId: doc.id,
        docNumber: doc.number,
        customerId: doc.customerId || undefined,
        customerName: doc.billName || "",
        facts: followUpFacts,
        plan: plannedFollowUps,
      }
    : null;

  const download = () => {
    try {
      toast("Saved " + downloadPdf(renderOpts), "good");
    } catch {
      toast("Couldn't build that PDF. Check the document for anything unusual in the item descriptions.", "bad");
    }
  };

  return (
    <>
      <Button tone="primary" onClick={() => setEmailOpen(true)}>
        {isPo ? "Send purchase order to supplier" : `Send ${docType === "proforma" ? "proforma" : "quote"} to customer`}
      </Button>
      <Button tone="default" onClick={download}>Download PDF</Button>
      <Button tone="quiet" onClick={() => previewPdf(renderOpts)}>Open PDF</Button>
      {canFollowUp ? (
        <Button tone="default" onClick={() => setFollowUpOpen(true)}>Follow up</Button>
      ) : null}
      <Button tone="default" onClick={() => setWhatsAppOpen(true)}>WhatsApp</Button>
      {/* "Send for invoicing" asks accounts to raise a tax invoice against a
          sale. A purchase order is a purchase — there is nothing to invoice. */}
      {docType === "purchase_order" || docType === "invoice" ? null : (
        <SendForInvoicing
          api={api}
          doc={doc}
          docType={docType}
          totals={totals}
          settings={settings}
          getAttachment={async () => pdfAttachment(renderOpts)}
        />
      )}

      <EmailDialog
        open={emailOpen}
        api={api}
        onClose={() => setEmailOpen(false)}
        defaultTo={toAddress}
        defaultCc={autoCc}
        defaultSubject={`${label(docType)} ${doc.number} — ${counterparty || ""}`}
        defaultMessage={message}
        sender={emailSender}
        company={emailBrand}
        quotation={emailQuotation}
        armable={armable}
        cannotArm={cannotArm}
        onSent={onSent}
        getAttachment={async () => pdfAttachment(renderOpts)}
      />

      {canFollowUp ? (
        <EmailDialog
          open={followUpOpen}
          api={api}
          onClose={() => setFollowUpOpen(false)}
          defaultTo={toAddress}
          defaultCc={autoCc}
          defaultSubject={followUpSubject("nudge", followUpFacts)}
          defaultMessage={followUpBody("nudge", followUpFacts)}
          sender={emailSender}
          company={emailBrand}
          quotation={emailQuotation}
          /* A follow-up carries the figures but not the file by default: the
             customer already has the PDF, and a second copy of a 300 KB
             attachment is how a chaser lands in a spam folder. The tick box
             is still there for the case where they say they never got it. */
          attachByDefault={false}
          followUp={followUpFacts}
          title="Follow up"
          description="Pick how this should read, then edit it. It goes out now, from your mailbox."
          getAttachment={async () => pdfAttachment(renderOpts)}
        />
      ) : null}

      <WhatsAppDialog
        open={whatsAppOpen}
        api={api}
        defaultPhone={toPhone}
        /* WhatsApp carries no attachment: the PDF has to be added by hand in
           WhatsApp itself. Saying so here beats a customer being promised an
           attachment that never arrives. */
        defaultMessage={message + "\n\n(Attach the PDF before sending.)"}
        onClose={() => setWhatsAppOpen(false)}
      />
    </>
  );
}

/* ── email ─────────────────────────────────────────────────────────── */

interface EmailDialogProps {
  open: boolean;
  api: IntegrationsApi;
  defaultTo?: string;
  defaultCc?: string;
  defaultSubject: string;
  defaultMessage: string;
  sender: EmailSender;
  company: EmailCompany;
  /** The document's facts, so the email carries a summary and the lines
   *  rather than only whatever the sender typed. */
  quotation?: EmailQuotation | null;
  /** Present on a follow-up: turns on the tone picker, which rewrites the
   *  subject and message from the document's own facts. */
  followUp?: FollowUpFacts;
  /** False where the customer already has the file. */
  attachByDefault?: boolean;
  /** Fired after a successful send, so the document can be marked as one. */
  onSent?: () => void;
  /** Present when this send can also arm an automatic sequence. Null when
   *  the workspace has it switched off, when there is nowhere to store one,
   *  or when the quotation's validity leaves no room for a chaser. */
  armable?: {
    ownerId: string;
    docType: "quotation" | "proforma";
    docId: string;
    docNumber: string;
    customerId?: string;
    customerName: string;
    facts: FollowUpFacts;
    plan: Array<{ step: number; tone: FollowUpTone; dueOn: string }>;
  } | null;
  /** Why no sequence can be armed, when none can. Shown instead of the tick
   *  box, because a control that silently is not there reads as a feature
   *  that was never built. */
  cannotArm?: string | null;
  title?: string;
  description?: string;
  getAttachment: () => Promise<{ base64: string; filename: string }>;
  onClose: () => void;
}

function EmailDialog({
  open, api, defaultTo = "", defaultCc = "", defaultSubject, defaultMessage,
  sender, company, quotation, followUp, attachByDefault = true, armable = null,
  cannotArm = null, onSent, title, description, getAttachment, onClose,
}: EmailDialogProps) {
  const toast = useToast();
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [tone, setTone] = useState<FollowUpTone>("nudge");
  const [attach, setAttach] = useState(attachByDefault);
  const [arm, setArm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  /* What the current tone would have written. Kept so switching tone can
     tell "untouched" from "typed into" without asking every time. */
  const written = followUp ? followUpBody(tone, followUp) : defaultMessage;

  const [pendingTone, setPendingTone] = useState<FollowUpTone | null>(null);

  const applyTone = (next: FollowUpTone) => {
    if (!followUp) return;
    setTone(next);
    setSubject(followUpSubject(next, followUp));
    setMessage(followUpBody(next, followUp));
    setPendingTone(null);
  };

  /* Switching tone rewrites the message, so anything typed would go with it.
     Asked rather than assumed — the same rule as closing a form with unsaved
     edits, and for the same reason. */
  const pickTone = (next: FollowUpTone) => {
    if (!followUp || next === tone) return;
    if (message !== written) { setPendingTone(next); return; }
    applyTone(next);
  };

  const send = async () => {
    setError(""); setBusy(true);
    try {
      const attachment = attach ? await getAttachment() : null;
      const content = {
        body: message,
        sender,
        company,
        quotation,
        attachmentName: attachment?.filename ?? null,
      };
      const result = await api.sendEmail({
        to, cc, subject,
        /* Both versions, built from the same content so they cannot say
           different things. */
        message: buildEmailText(content),
        html: buildEmailHtml(content),
        replyTo: sender.email || undefined,
        attachment,
      });
      toast(result.via === "microsoft" && result.from ? "Sent from " + result.from : "Email sent", "good");

      /* After the send, never instead of it, and never allowed to fail it.
         The customer has the quotation either way; a sequence that could not
         be stored is worth a warning, not an error on a message that went. */
      if (armable && arm) {
        try {
          const steps: ArmedStep[] = armable.plan.map((p) => ({
            step: p.step,
            steps: armable.plan.length,
            tone: p.tone,
            dueOn: p.dueOn,
            subject: followUpSubject(p.tone, armable.facts),
            message: buildEmailText({
              body: followUpBody(p.tone, armable.facts),
              sender, company, quotation, attachmentName: null,
            }),
            /* Rendered NOW, from the same builder the preview uses, and
               stored. What goes out weeks later is this exact markup — not
               something re-templated by code nobody watched. */
            html: buildEmailHtml({
              body: followUpBody(p.tone, armable.facts),
              sender, company, quotation, attachmentName: null,
            }),
          }));
          await armFollowUps({
            ownerId: armable.ownerId,
            docType: armable.docType,
            docId: armable.docId,
            docNumber: armable.docNumber,
            customerId: armable.customerId,
            customerName: armable.customerName,
            to, cc, replyTo: sender.email || undefined,
            steps,
          });
          toast(`${steps.length} follow-up${steps.length === 1 ? "" : "s"} scheduled.`, "good");
        } catch {
          toast("Sent — but the follow-ups could not be scheduled. Send them by hand, or try arming again.", "warn");
        }
      }

      /* After the send and after arming, so a failure in either is never
         recorded as a document the customer has. */
      onSent?.();
      onClose();
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't send that email.");
    }
    setBusy(false);
  };

  const edited = message !== written || subject !== defaultSubject || to !== defaultTo;

  return (
    <Modal
      open={open}
      title={title ?? "Send to customer"}
      description={
        description ?? (sender.email
          ? `Goes out as ${sender.email}, with your signature. Replies come back to you.`
          : "Sent from your own mailbox when one is connected, otherwise from the company address.")
      }
      unsavedChanges={edited && !busy}
      onClose={onClose}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Cancel</Button>
          <Button tone="primary" disabled={busy || !to.trim() || !subject.trim()} onClick={() => void send()}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </>
      }
    >
      <div className="stack">
        {followUp ? (
          <Field label="How this should read" hint={TONE_LABELS[tone].what}>
            <div className="row-tight" role="group">
              {(Object.keys(TONE_LABELS) as FollowUpTone[]).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  tone={t === tone ? "default" : "quiet"}
                  aria-pressed={t === tone}
                  onClick={() => pickTone(t)}
                >
                  {TONE_LABELS[t].name}
                </Button>
              ))}
            </div>
          </Field>
        ) : null}

        <Confirm
          open={!!pendingTone}
          title="Replace what you have written?"
          body="Switching how this reads rewrites the subject and the message. What you have typed is lost."
          confirmLabel="Replace"
          tone="danger"
          onConfirm={() => { if (pendingTone) applyTone(pendingTone); }}
          onCancel={() => setPendingTone(null)}
        />

        <div className="grid grid-2">
          <Field label="To"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Copy to" hint="Filled in automatically. Comma-separate more than one, or clear it.">
            <Input value={cc} onChange={(e) => setCc(e.target.value)} />
          </Field>
        </div>
        <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message" hint="Your signature and the company details are added automatically underneath.">
          <Textarea rows={9} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <label className="row-tight" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
          <span>Attach the PDF</span>
        </label>

        {/* The dates, not a promise. These emails leave with nobody
            watching, so the last person who can stop them is looking at
            exactly when they will go. */}
        {!armable && cannotArm ? (
          <div>
            <label className="row-tight" style={{ opacity: .55 }}>
              <input type="checkbox" checked={false} disabled readOnly />
              <span>Follow up automatically</span>
            </label>
            <p className="field-hint" style={{ margin: "4px 0 0 24px" }}>{cannotArm}</p>
          </div>
        ) : null}

        {armable ? (
          <div>
            <label className="row-tight" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={arm} onChange={(e) => setArm(e.target.checked)} />
              <span>Follow up automatically</span>
            </label>
            <p className="field-hint" style={{ margin: "4px 0 0 24px" }}>
              {arm
                ? `${armable.plan.length} email${armable.plan.length === 1 ? "" : "s"} to ${to || "this customer"}, on ${armable.plan.map((p) => fmtDate(p.dueOn)).join(", ")}. They stop by themselves the moment this ${armable.docType === "proforma" ? "proforma" : "quotation"} is accepted, turned down or expires — and you can stop them from this document at any time.`
                : "Nothing will be sent on its own. You can still follow up by hand from this document."}
            </p>
          </div>
        ) : null}

        <div>
          <Button size="sm" tone="quiet" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Hide preview" : "Preview what the customer sees"}
          </Button>
          {showPreview ? (
            /* Rendered in a sandboxed frame: this is the real markup that
               will be sent, and it must not be able to touch the app around
               it or load anything from outside. */
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={buildEmailHtml({ body: message, sender, company, quotation, attachmentName: attach ? "quotation.pdf" : null })}
              style={{ width: "100%", height: 380, border: "1px solid var(--rule)", borderRadius: 8, marginTop: 10, background: "#fff" }}
            />
          ) : null}
        </div>

        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
      </div>
    </Modal>
  );
}
