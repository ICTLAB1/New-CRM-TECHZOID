import { useEffect, useRef, useState } from "react";

/**
 * Change one field without opening the record.
 *
 * Reads as the value until somebody means to change it, then becomes a
 * select. The point is the three steps it removes — open, edit, save —
 * from the change a salesperson makes most often.
 *
 * IT COMMITS THROUGH THE SCREEN'S OWN SAVE. Nothing here writes: `onCommit`
 * is the same function the editor calls, so everything that hangs off a
 * save still happens. Marking a quotation Sent from this control advances
 * the deal on the pipeline board exactly as marking it Sent inside the
 * record does, because it is the same code path and not a shortcut past it.
 *
 * The value shown stays the one that was passed in. It changes when the
 * save comes back and the row re-renders with it — so a refused save leaves
 * the old value on screen rather than a new one the server never took.
 */
export function InlineSelect({ value, options, label, disabled, onCommit, children }: {
  value: string;
  options: readonly string[];
  /** For the screen reader: "Status of TZ/QT/2627/0009". */
  label: string;
  disabled?: boolean;
  onCommit: (next: string) => void | Promise<void>;
  /** How the value looks when it is not being edited — usually a chip. */
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const select = useRef<HTMLSelectElement>(null);

  useEffect(() => { if (editing) select.current?.focus(); }, [editing]);

  if (disabled) return <>{children}</>;

  if (!editing) {
    return (
      <button
        type="button"
        className="inline-edit"
        aria-label={`${label} — press to change`}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      >
        {children}
        <span className="inline-edit-hint" aria-hidden>▾</span>
      </button>
    );
  }

  const choose = async (next: string) => {
    setEditing(false);
    if (next === value || busy) return;
    setBusy(true);
    try {
      await onCommit(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      ref={select}
      className="input inline-select"
      aria-label={label}
      defaultValue={value}
      disabled={busy}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => void choose(e.target.value)}
      /* Leaving without choosing is a cancel, not a change. */
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }}
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
