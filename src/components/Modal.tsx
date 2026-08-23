import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./primitives";

/**
 * A dialog on a desktop, a bottom sheet on a phone — the switch is in CSS
 * (`.scrim` / `.modal` under 720px), so there is one component and one set
 * of behaviours regardless of where it renders.
 *
 * A centred dialog on a phone fights the keyboard and puts its actions where
 * the thumb is not; the sheet puts them at the bottom where they belong.
 */
export interface ModalProps {
  open: boolean;
  title: ReactNode;
  /** Shown under the title. Say what this will do, especially if it is
   *  irreversible — a sent email cannot be unsent. */
  description?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  /** A full-height panel down the right edge instead of a centred dialog.
   *  For long records: a centred dialog that scrolls internally hides how
   *  much is left, and a customer form is thirty fields. Still becomes a
   *  bottom sheet on a phone. */
  side?: boolean;
  children: ReactNode;
}

export function Modal({ open, title, description, onClose, footer, side, children }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={"scrim" + (side ? " scrim-side" : "")} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"modal" + (side ? " side" : "")} role="dialog" aria-modal="true" tabIndex={-1} ref={panel}>
        <header className="modal-head">
          <div>
            <div className="card-title">{title}</div>
            {description ? <div className="field-hint" style={{ marginTop: 4 }}>{description}</div> : null}
          </div>
          <Button tone="quiet" size="sm" iconOnly aria-label="Close" onClick={onClose}>✕</Button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/**
 * Confirmation for an action that reaches outside the app.
 *
 * "Send for invoicing" mails a real person and cannot be unsent, so it sits
 * behind one of these. The body should name what will happen and to whom.
 */
export interface ConfirmProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({ open, title, body, confirmLabel = "Confirm", tone = "primary", onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button tone="quiet" onClick={onCancel}>Cancel</Button>
          <Button tone={tone} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}
