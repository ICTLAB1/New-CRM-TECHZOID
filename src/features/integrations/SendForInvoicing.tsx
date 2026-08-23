import { useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, Field, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { buildInvoicingEmail, docLabel } from "../../domain/integrations/invoicing";
import { fmtCurrency } from "../../domain/currency/format";
import type { DocumentTotals } from "../../domain/tax/types";
import type { SalesDocument } from "../../domain/documents/create";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";

/**
 * Hand a signed-off document to accounts.
 *
 * Behind a confirmation, deliberately. It emails a real person, there is no
 * way to unsend it, and the button sits on a toolbar next to Print — a stray
 * click should not put a request in someone's inbox. The dialog shows the
 * addresses and the value before it goes, so the confirmation is a check
 * rather than a formality.
 */

export interface SendForInvoicingProps {
  api: IntegrationsApi;
  doc: SalesDocument;
  docType: "quotation" | "proforma";
  totals: DocumentTotals;
  settings: Record<string, unknown>;
  /** Generates the PDF on demand. Injected so this component knows nothing
   *  about how a document is rendered. */
  getAttachment: () => Promise<{ base64: string; filename: string }>;
}

export function SendForInvoicing({ api, doc, docType, totals, settings, getAttachment }: SendForInvoicingProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mail = buildInvoicingEmail({
    doc, docType, totals, note,
    settings: {
      invoicingEmail: settings["invoicingEmail"] as string | undefined,
      invoicingCc: settings["invoicingCc"] as string | undefined,
    },
  });

  const send = async () => {
    setError(""); setBusy(true);
    try {
      if (!mail.to) {
        throw new IntegrationError(
          "No invoicing address is set. An admin can add one in Settings → Integrations.", 400);
      }
      const attachment = await getAttachment();
      await api.sendEmail({ to: mail.to, cc: mail.cc, subject: mail.subject, message: mail.body, attachment });
      toast("Sent to " + mail.to + " for invoicing");
      setOpen(false);
      setNote("");
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't send that. Try again in a moment.");
    }
    setBusy(false);
  };

  return (
    <>
      <Button tone="default" onClick={() => { setError(""); setOpen(true); }}>Send for invoicing</Button>
      <Modal
        open={open}
        title="Send for invoicing"
        description="This emails accounts so they can raise the tax invoice. It cannot be unsent."
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button tone="quiet" onClick={() => setOpen(false)}>Cancel</Button>
            <Button tone="primary" disabled={busy || !mail.to} onClick={() => void send()}>
              {busy ? "Sending…" : "Send now"}
            </Button>
          </>
        }
      >
        <div className="stack">
          <p style={{ margin: 0 }}>
            {docLabel(docType)} <strong>{doc.number}</strong> for {doc.billName || "this customer"}, with the
            PDF attached.
          </p>

          <div className="notice notice-flat">
            <div className="stack" style={{ gap: 4, width: "100%" }}>
              <div className="spread"><span className="muted">To</span><span className="mono">{mail.to || "not set"}</span></div>
              {mail.cc ? <div className="spread"><span className="muted">Copy to</span><span className="mono">{mail.cc}</span></div> : null}
              <div className="spread">
                <span className="muted">Value</span>
                {/* The document's own currency, never rupees by assumption. */}
                <span className="mono">{fmtCurrency(totals.grand, doc.currency)}</span>
              </div>
            </div>
          </div>

          <Field label="Note for accounts" hint="Optional — anything they need to know before raising it.">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. PO received, invoice against milestone 1" />
          </Field>

          {!mail.to ? (
            <div className="notice">
              <span>No invoicing address is set. An admin can add one in Settings → Integrations.</span>
            </div>
          ) : null}
          {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
        </div>
      </Modal>
    </>
  );
}
