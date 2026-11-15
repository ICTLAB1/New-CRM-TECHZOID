import { useEffect, useRef, useState } from "react";
import { Button, Chip } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import {
  previewWhatsApp, sendWhatsApp, whatsappLabel, type WhatsAppPreview,
} from "../../data/whatsapp";

/**
 * "Send WhatsApp" — shown, then sent only when somebody confirms.
 *
 * THE PREVIEW IS THE MESSAGE. It is built on the server by the same code
 * that sends, from the same record, and the wording is read from the
 * approved template in Meta rather than written here — so what is on screen
 * is what the customer receives, not an impression of it.
 *
 * NOTHING IS SENT BY OPENING THIS. The preview costs a read; the send
 * happens on the button and nowhere else.
 */

export interface SendWhatsAppDialogProps {
  open: boolean;
  onClose: () => void;
  companyId: string | null;
  /** The messages that may be sent about this record, best first. More than
   *  one puts a chooser at the top rather than making the screen carry a
   *  button each. */
  templates: readonly string[];
  recordType: string;
  recordId: string;
  customerId?: string;
  /** The handful of facts the record cannot hold. */
  extra?: { sentTo?: string; against?: string; amount?: number };
  /** Renders the document this message is about, where it has one.
   *
   *  ONLY THIS APP CAN BUILD IT. The PDF is drawn from what is on screen,
   *  and the server has no renderer — so if the message is one that carries
   *  the quotation, it is made here and handed over with the send. */
  getPdf?: () => { base64: string } | null;
  onSent?: () => void;
}

export function SendWhatsAppDialog({
  open, onClose, companyId, templates, recordType, recordId, customerId, extra, getPdf, onSent,
}: SendWhatsAppDialogProps) {
  const toast = useToast();
  const first = templates[0] ?? "";
  /* Held, not rebuilt: the send must attach the very PDF that was shown. */
  const pdfRef = useRef<{ base64: string } | null>(null);
  const [template, setTemplate] = useState(first);
  const [preview, setPreview] = useState<WhatsAppPreview | null>(null);
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) setTemplate(first);
  }, [open, first, recordId]);

  useEffect(() => {
    if (!open || !companyId || !template) return;
    let live = true;
    setLoading(true);
    setProblem("");
    setPreview(null);
    /* Rendered once, for the preview and the send alike, so the filename on
       screen is the filename that goes. A render that throws is simply no
       attachment — never a dialog that will not open. */
    let pdf: { base64: string } | null = null;
    try {
      pdf = getPdf?.() ?? null;
    } catch {
      pdf = null;
    }
    pdfRef.current = pdf;

    void previewWhatsApp({ companyId, template, recordType, recordId, customerId, extra, pdf })
      .then((p) => { if (live) setPreview(p); })
      .catch((err: unknown) => {
        if (live) setProblem(err instanceof Error ? err.message : "That could not be prepared.");
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- re-reads when the dialog opens on a record */
  }, [open, companyId, template, recordType, recordId, customerId]);

  const send = async () => {
    if (!companyId) return;
    setSending(true);
    try {
      const out = await sendWhatsApp({
        companyId, template, recordType, recordId, customerId, extra, pdf: pdfRef.current,
      });
      if (out.ok) {
        toast("WhatsApp message sent", "good");
        onSent?.();
        onClose();
      } else if (out.alreadySent) {
        toast(out.reason ?? "That has already gone today.", "warn");
        onClose();
      } else {
        toast(out.reason ?? "That did not send.", "bad");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "That did not send.", "bad");
    }
    setSending(false);
  };

  const blocked = preview?.blocked ?? "";
  const canSend = !!preview && !blocked && !loading && !sending;

  return (
    <Modal
      open={open}
      title="Send on WhatsApp"
      description={preview?.label ? `${preview.label} — to ${preview.customerName || "this customer"}` : undefined}
      onClose={onClose}
      onSubmit={canSend ? () => void send() : undefined}
      canSubmit={canSend}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void send()} disabled={!canSend}>
            {sending ? "Sending…" : "Send it"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="muted">Preparing the message…</div>
      ) : problem ? (
        <div className="notice notice-bad">{problem}</div>
      ) : !preview ? (
        <div className="notice notice-warn">Nothing to show.</div>
      ) : (
        <div className="stack">
          {blocked ? <div className="notice notice-warn">{blocked}</div> : null}

          {/* Which of the approved messages. Only shown when the record has
              more than one, because a chooser with one option is furniture. */}
          {templates.length > 1 ? (
            <div className="row-tight wrap">
              {templates.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  tone={name === template ? "primary" : "quiet"}
                  onClick={() => setTemplate(name)}
                  disabled={sending}
                >
                  {whatsappLabel(name)}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="row-tight wrap">
            <Chip tone={blocked ? "neutral" : "accent"} dot={false}>
              To: {preview.to ? `+${preview.to}` : "no number"}
            </Chip>
            {preview.customerName ? <span className="muted">{preview.customerName}</span> : null}
            {/* The quotation itself, when it is going with the message. */}
            {preview.documentName ? (
              <Chip tone="good" dot={false}>📎 {preview.documentName}</Chip>
            ) : null}
          </div>

          {/* Offered but not going: the message still sends, so this is a
              note rather than a warning. */}
          {preview.documentNote ? (
            <div className="notice">
              <span>
                <strong>The PDF is not attached to this one.</strong> {preview.documentNote}. The message
                itself still goes, and the quotation is in the email.
              </span>
            </div>
          ) : null}

          {/* The approved wording with the blanks filled. When Meta could
              not be asked, the blanks are shown on their own and the reason
              is stated — never an invented sentence. */}
          {preview.body ? (
            <div
              style={{
                whiteSpace: "pre-wrap",
                background: "var(--card-tint, #f6f4f0)",
                border: "1px solid var(--rule)",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 14,
              }}
            >
              {preview.body}
            </div>
          ) : (
            <div className="stack">
              <div className="notice">
                The approved wording could not be read from Meta, so this shows what will be filled into it.
                {preview.wordingProblem ? ` ${preview.wordingProblem}` : ""}
              </div>
              <ol className="tight">
                {preview.values.map((v, i) => <li key={`${i}-${v}`}>{v}</li>)}
              </ol>
            </div>
          )}

          {preview.body && preview.wordingProblem ? (
            <div className="notice notice-warn">{preview.wordingProblem}</div>
          ) : null}

          {preview.missing.length ? (
            <div className="notice notice-warn">
              <span>
                <strong>Not on the record:</strong> {preview.missing.join(", ")}. The message will use a general
                phrase instead — close this and fill it in if that matters.
              </span>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
