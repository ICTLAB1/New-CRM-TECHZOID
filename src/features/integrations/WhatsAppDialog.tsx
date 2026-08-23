import { useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, Field, Input, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { looksLikePhone, whatsappLink } from "../../domain/integrations/phone";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";

/**
 * Send a document by WhatsApp.
 *
 * There are always two ways out of this dialog. "Send now" goes through the
 * connected provider; "Open in WhatsApp instead" opens WhatsApp with the
 * message already written and needs no setup at all. The second is not a
 * fallback for when the first breaks — it is offered every time, because a
 * salesperson in front of a customer should never be told to fix a token.
 */

export interface WhatsAppDialogProps {
  open: boolean;
  api: IntegrationsApi;
  defaultPhone?: string;
  defaultMessage?: string;
  onClose: () => void;
}

export function WhatsAppDialog({ open, api, defaultPhone = "", defaultMessage = "", onClose }: WhatsAppDialogProps) {
  const toast = useToast();
  const [phone, setPhone] = useState(defaultPhone);
  const [message, setMessage] = useState(defaultMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valid = looksLikePhone(phone);

  const send = async () => {
    setError(""); setBusy(true);
    try {
      await api.sendWhatsApp(phone, message);
      toast("WhatsApp message sent");
      onClose();
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't send that message.");
    }
    setBusy(false);
  };

  const openManually = () => {
    window.open(whatsappLink(phone, message), "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Send via WhatsApp"
      onClose={onClose}
      footer={
        <>
          <Button tone="quiet" onClick={openManually}>Open in WhatsApp instead</Button>
          <Button tone="primary" disabled={busy || !valid || !message.trim()} onClick={() => void send()}>
            {busy ? "Sending…" : "Send now"}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field
          label="Phone number"
          hint="A ten-digit number is treated as Indian. For anywhere else, include the country code."
          error={phone && !valid ? "That doesn't look like a phone number yet." : undefined}
        >
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98100 12345" invalid={!!phone && !valid} />
        </Field>
        <Field label="Message">
          <Textarea rows={8} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        {error ? (
          <div className="notice notice-bad">
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
