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
import type { DocumentModel } from "../../domain/documents/model";
import type { ComputedRow, DocumentTotals } from "../../domain/tax/types";
import type { SalesDocument } from "../../domain/documents/create";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";

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
  docType: "quotation" | "proforma";
  model: DocumentModel;
  rows: ComputedRow[];
  totals: DocumentTotals;
  settings: Record<string, unknown>;
  images?: DocImages;
}

const label = (docType: "quotation" | "proforma") =>
  docType === "proforma" ? "Proforma Invoice" : "Quotation";

/** What we say when sending a document out. Kept short: it is read on a
 *  phone, usually while the sender is on a call. */
function defaultMessage(doc: SalesDocument, docType: "quotation" | "proforma", totals: DocumentTotals): string {
  return [
    `Dear ${doc.billContact || doc.billName || "Sir/Madam"},`,
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

export function DocumentActions({ api, doc, docType, model, rows, totals, settings, images }: DocumentActionsProps) {
  const toast = useToast();
  const [emailOpen, setEmailOpen] = useState(false);
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);

  const renderOpts = { model, rows, images };
  const message = defaultMessage(doc, docType, totals);

  const download = () => {
    try {
      toast("Saved " + downloadPdf(renderOpts), "good");
    } catch {
      toast("Couldn't build that PDF. Check the document for anything unusual in the item descriptions.", "bad");
    }
  };

  return (
    <>
      <Button tone="default" onClick={download}>Download PDF</Button>
      <Button tone="quiet" onClick={() => previewPdf(renderOpts)}>Open PDF</Button>
      <Button tone="default" onClick={() => setEmailOpen(true)}>Email</Button>
      <Button tone="default" onClick={() => setWhatsAppOpen(true)}>WhatsApp</Button>
      <SendForInvoicing
        api={api}
        doc={doc}
        docType={docType}
        totals={totals}
        settings={settings}
        getAttachment={async () => pdfAttachment(renderOpts)}
      />

      <EmailDialog
        open={emailOpen}
        api={api}
        onClose={() => setEmailOpen(false)}
        defaultTo={doc.billEmail}
        defaultSubject={`${label(docType)} ${doc.number} — ${doc.billName}`}
        defaultMessage={message}
        getAttachment={async () => pdfAttachment(renderOpts)}
      />

      <WhatsAppDialog
        open={whatsAppOpen}
        api={api}
        defaultPhone={doc.billPhone}
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
  defaultSubject: string;
  defaultMessage: string;
  getAttachment: () => Promise<{ base64: string; filename: string }>;
  onClose: () => void;
}

function EmailDialog({ open, api, defaultTo = "", defaultSubject, defaultMessage, getAttachment, onClose }: EmailDialogProps) {
  const toast = useToast();
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    setError(""); setBusy(true);
    try {
      const attachment = attach ? await getAttachment() : null;
      const result = await api.sendEmail({ to, cc, subject, message, attachment });
      toast(result.via === "microsoft" && result.from ? "Sent from " + result.from : "Email sent", "good");
      onClose();
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't send that email.");
    }
    setBusy(false);
  };

  return (
    <Modal
      open={open}
      title="Send by email"
      description="Sent from your own mailbox when one is connected, otherwise from the company address."
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
          <Field label="Copy to" hint="Optional. Comma-separate more than one.">
            <Input value={cc} onChange={(e) => setCc(e.target.value)} />
          </Field>
        </div>
        <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><Textarea rows={9} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <label className="row-tight" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
          <span>Attach the PDF</span>
        </label>
        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
      </div>
    </Modal>
  );
}
