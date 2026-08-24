import { useState } from "react";
import { Button } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { Modal } from "../../components/Modal";
import { Field, Input, Textarea } from "../../components/primitives";
import { WhatsAppDialog } from "../integrations/WhatsAppDialog";
import { SendForInvoicing } from "../integrations/SendForInvoicing";
import { downloadPdf, pdfAttachment, previewPdf } from "../../documents/pdf/deliver";
import { fmtCurrency } from "../../domain/currency/format";
import { fmtDate } from "../../domain/dates";
import type { DocImages } from "../../documents/pdf/render";
import type { DocType, DocumentModel } from "../../domain/documents/model";
import type { ComputedRow, DocumentTotals } from "../../domain/tax/types";
import type { SalesDocument } from "../../domain/documents/create";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";
import {
  buildEmailHtml, buildEmailText, type EmailCompany, type EmailSender,
} from "../../domain/integrations/emailTemplate";

/** Copied on every quotation unless an admin changes `quoteCcEmail`. */
const DEFAULT_QUOTE_CC = "abhinav.jain@techzoidtechnologies.com";

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
}

const label = (docType: DocType): string =>
  docType === "purchase_order" ? "Purchase Order" : docType === "proforma" ? "Proforma Invoice" : "Quotation";

/** What we say when sending a document out. Kept short: it is read on a
 *  phone, usually while the sender is on a call. */
function defaultMessage(doc: SalesDocument, docType: DocType, totals: DocumentTotals): string {
  return [
    `Dear ${(docType === "purchase_order"
      ? doc.vendorContact || doc.vendorName
      : doc.billContact || doc.billName) || "Sir/Madam"},`,
    "",
    `Please find attached ${label(docType)} ${doc.number} dated ${fmtDate(doc.date)} for ${fmtCurrency(totals.grand, doc.currency)}.`,
    doc.validUntil ? `It is valid until ${fmtDate(doc.validUntil)}.` : "",
    "",
    "Do let me know if anything needs changing.",
    "",
    "Best regards,",
    doc.preparedBy || "",
  ].filter((l, i, all) => !(l === "" && all[i - 1] === "")).join("\n");
}

export function DocumentActions({
  api, doc, docType, model, rows, totals, settings, images, currentUser,
}: DocumentActionsProps) {
  const toast = useToast();
  const [emailOpen, setEmailOpen] = useState(false);
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);

  const renderOpts = { model, rows, images };
  const message = defaultMessage(doc, docType, totals);

  const company = (settings["company"] ?? {}) as Record<string, unknown>;

  /* Everyone who sends a quotation copies the same address, so it is filled
     in rather than remembered — but left editable, because "always" is not
     the same as "without exception". Configurable so this does not need a
     code change the day it moves. */
  const autoCc = String(settings["quoteCcEmail"] ?? DEFAULT_QUOTE_CC);

  const emailBrand: EmailCompany = {
    name: String(company["name"] ?? ""),
    tagline: String(company["tagline"] ?? ""),
    website: String(company["website"] ?? ""),
    phone: String(company["phone"] ?? ""),
    email: String(company["email"] ?? ""),
    logo: String(company["logo"] ?? "") || undefined,
    addressLines: model.header.addressLines,
    gstin: String(company["gstin"] ?? ""),
    cin: String(company["cin"] ?? ""),
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
      <Button tone="default" onClick={() => setWhatsAppOpen(true)}>WhatsApp</Button>
      {/* "Send for invoicing" asks accounts to raise a tax invoice against a
          sale. A purchase order is a purchase — there is nothing to invoice. */}
      {docType === "purchase_order" ? null : (
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
        getAttachment={async () => pdfAttachment(renderOpts)}
      />

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
  getAttachment: () => Promise<{ base64: string; filename: string }>;
  onClose: () => void;
}

function EmailDialog({
  open, api, defaultTo = "", defaultCc = "", defaultSubject, defaultMessage,
  sender, company, getAttachment, onClose,
}: EmailDialogProps) {
  const toast = useToast();
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const send = async () => {
    setError(""); setBusy(true);
    try {
      const attachment = attach ? await getAttachment() : null;
      const content = {
        body: message,
        sender,
        company,
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
      onClose();
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't send that email.");
    }
    setBusy(false);
  };

  const edited = message !== defaultMessage || subject !== defaultSubject || to !== defaultTo;

  return (
    <Modal
      open={open}
      title="Send to customer"
      description={
        sender.email
          ? `Goes out as ${sender.email}, with your signature. Replies come back to you.`
          : "Sent from your own mailbox when one is connected, otherwise from the company address."
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
              srcDoc={buildEmailHtml({ body: message, sender, company, attachmentName: attach ? "quotation.pdf" : null })}
              style={{ width: "100%", height: 380, border: "1px solid var(--rule)", borderRadius: 8, marginTop: 10, background: "#fff" }}
            />
          ) : null}
        </div>

        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
      </div>
    </Modal>
  );
}
