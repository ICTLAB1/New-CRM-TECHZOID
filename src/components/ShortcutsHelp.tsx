import { Modal } from "./Modal";
import { Button } from "./primitives";
import { SHORTCUTS } from "./hotkeys";

/**
 * The shortcut list, on `?`.
 *
 * A shortcut nobody can discover is a shortcut nobody uses, and this is the
 * cheapest way to make the whole set findable without putting hints on every
 * button. The rows come from the same module that binds the keys, so the
 * list cannot promise something the app does not do.
 */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      title="Keyboard shortcuts"
      description="Press ? at any time to see this again."
      onClose={onClose}
      footer={<Button tone="primary" onClick={onClose}>Close</Button>}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th style={{ width: 130 }}>Keys</th><th>Does</th><th>Where</th></tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((row) => (
              <tr key={row.keys}>
                <td className="mono strong">{row.keys}</td>
                <td>{row.what}</td>
                <td className="muted">{row.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-hint" style={{ marginBottom: 0 }}>
        Typing always wins: a bare key like <span className="mono">/</span> does nothing while the
        caret is in a field, so a slash in an address stays a slash.
      </p>
    </Modal>
  );
}
