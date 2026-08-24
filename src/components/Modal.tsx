import { useEffect, useRef, useState, type ReactNode } from "react";
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
  /**
   * There are edits in here that closing would throw away.
   *
   * Escape and a click on the backdrop are both easy to hit by accident —
   * Escape especially, since it is also how you dismiss a browser autofill
   * menu or an IME candidate list. With this set, either one asks first
   * instead of silently discarding a half-filled form. The X button asks
   * too: it is deliberate, but "close" and "discard everything I typed"
   * should not be the same click without a word.
   */
  unsavedChanges?: boolean;
  children: ReactNode;
}

export function Modal({ open, title, description, onClose, footer, side, unsavedChanges, children }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);

  /* Read through a ref inside the key handler so the listener does not have
     to be town down and re-added on every keystroke that changes it. */
  const dirty = useRef(unsavedChanges);
  dirty.current = unsavedChanges;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dirty.current) setConfirming(true);
      else onClose();
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

  /* A dialog reopened after being dismissed must not still be asking. */
  useEffect(() => { if (!open) setConfirming(false); }, [open]);

  if (!open) return null;

  const attemptClose = () => {
    if (unsavedChanges) setConfirming(true);
    else onClose();
  };

  return (
    <div className={"scrim" + (side ? " scrim-side" : "")} onMouseDown={(e) => { if (e.target === e.currentTarget) attemptClose(); }}>
      <div className={"modal" + (side ? " side" : "")} role="dialog" aria-modal="true" tabIndex={-1} ref={panel}>
        <header className="modal-head">
          <div>
            <div className="card-title">{title}</div>
            {description ? <div className="field-hint" style={{ marginTop: 4 }}>{description}</div> : null}
          </div>
          <Button tone="quiet" size="sm" iconOnly aria-label="Close" onClick={attemptClose}>✕</Button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}

        {/* Drawn INSIDE the panel rather than as a second Modal: a nested
            scrim over the first one dims the very thing being asked about,
            and stacks two Escape handlers that would both fire. */}
        {confirming ? (
          <div className="modal-guard" role="alertdialog" aria-modal="true" aria-label="Discard changes?">
            <div className="modal-guard-box">
              <div className="card-title">Discard your changes?</div>
              <p className="field-hint" style={{ marginTop: 6 }}>
                What you have typed here hasn't been saved yet. Closing now loses it.
              </p>
              <div className="row-tight" style={{ marginTop: 14, justifyContent: "flex-end" }}>
                <Button tone="quiet" onClick={() => setConfirming(false)}>Keep editing</Button>
                <Button tone="danger" onClick={() => { setConfirming(false); onClose(); }}>Discard</Button>
              </div>
            </div>
          </div>
        ) : null}
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
