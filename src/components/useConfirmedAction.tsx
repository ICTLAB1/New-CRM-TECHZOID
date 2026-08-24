import { useState, type ReactNode } from "react";
import { Confirm } from "./Modal";

/**
 * Put a confirmation in front of an action.
 *
 * ONE CAVEAT, stated where whoever wires the next screen will read it:
 * a confirmation on an action that is always safe teaches people to dismiss
 * confirmations. After the twentieth "Save this customer?" nobody reads the
 * twenty-first, and the dialog that finally guards something irreversible
 * gets the same reflexive click. That is why `enabled` exists and why it is
 * read from a setting rather than hard-coded: the team can turn it off if
 * the asking starts costing more than it saves, without a code change.
 *
 * Used like:
 *
 *   const save = useConfirmedAction({ title: "Save?", onConfirm: doSave });
 *   <Button onClick={save.ask}>Save</Button>
 *   {save.dialog}
 *
 * When `enabled` is false `ask` simply runs the action, so a call site never
 * needs to know which mode it is in.
 */

export interface ConfirmedActionOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  /** Ask, rather than just doing it. Defaults to asking. */
  enabled?: boolean;
}

export interface ConfirmedAction {
  /** Call this from the button. Asks, or runs straight through. */
  ask: () => void;
  /** Render this somewhere in the tree. */
  dialog: ReactNode;
  /** True while the question is on screen. */
  open: boolean;
}

export function useConfirmedAction({
  title, body, confirmLabel = "Save", tone = "primary", onConfirm, enabled = true,
}: ConfirmedActionOptions): ConfirmedAction {
  const [open, setOpen] = useState(false);

  const ask = () => {
    if (!enabled) { onConfirm(); return; }
    setOpen(true);
  };

  const dialog = (
    <Confirm
      open={open}
      title={title}
      body={body ?? "This will be saved now."}
      confirmLabel={confirmLabel}
      tone={tone}
      onConfirm={() => { setOpen(false); onConfirm(); }}
      onCancel={() => setOpen(false)}
    />
  );

  return { ask, dialog, open };
}

/** Whether saves are confirmed, read from the workspace settings. Defaults
 *  to ON — it was asked for explicitly — but it is one toggle in Settings to
 *  turn back off. */
export const askBeforeSave = (settings: Record<string, unknown>): boolean =>
  settings["confirmBeforeSave"] !== false;
