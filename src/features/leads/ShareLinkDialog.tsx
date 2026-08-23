import { Modal } from "../../components/Modal";
import { Button, Input } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { whatsappLink } from "../../domain/integrations/phone";

/**
 * A salesperson's own registration link.
 *
 * Anyone who fills it in lands as a lead in this person's pipeline, with the
 * billing details and GSTIN already typed — by the customer, who knows them —
 * instead of read out over a phone call and typed twice.
 */

const PITCH =
  "Hi! Please register your details here — including your GSTIN if applicable — " +
  "so I can prepare an accurate quotation for you: ";

export function ShareLinkDialog({
  open, user, onClose,
}: {
  open: boolean;
  user: { id: string; name: string };
  onClose: () => void;
}) {
  const toast = useToast();
  const link = (typeof window === "undefined" ? "" : window.location.origin) + "/?lead=" + user.id;
  const message = PITCH + link;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied", "good");
    } catch {
      toast("Couldn't copy — select the link and copy it manually", "warn");
    }
  };

  return (
    <Modal
      open={open}
      title="Your customer registration link"
      description="Share this instead of typing a customer's details out yourself."
      onClose={onClose}
      footer={<Button tone="quiet" onClick={onClose}>Done</Button>}
    >
      <div className="stack">
        <p style={{ margin: 0 }}>
          It asks for everything a proper quotation needs — company, billing address, GSTIN and PAN — and the
          moment it's submitted it appears in your customer list, ready to quote. The customer needs no
          account and no sign-in.
        </p>

        <div className="row-tight">
          <Input
            className="mono"
            readOnly
            value={link}
            style={{ flex: 1 }}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button tone="primary" onClick={() => void copy()}>Copy</Button>
        </div>

        <div className="row-tight wrap">
          <a
            className="btn btn-default btn-sm"
            href={whatsappLink("", message)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Share on WhatsApp
          </a>
          <a
            className="btn btn-default btn-sm"
            href={"mailto:?subject=" + encodeURIComponent("Please register your details") + "&body=" + encodeURIComponent(message)}
          >
            Share by email
          </a>
        </div>

        <div className="notice notice-flat">
          <span>
            Everything submitted through your link is attributed to you automatically, and shows in your list
            with “Customer Registration Form” as the source.
          </span>
        </div>
      </div>
    </Modal>
  );
}
