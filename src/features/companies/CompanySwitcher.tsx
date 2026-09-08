import { useState } from "react";
import { Button, Input, Select } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { createCompany, type Company } from "../../data/companies";

/**
 * Which business you are working in, in the top bar.
 *
 * IT IS IN THE TOP BAR AND NOT BURIED IN SETTINGS because it changes what
 * every screen behind it is showing. Somebody who cannot see at a glance
 * which company they are raising an invoice for will eventually raise one
 * for the wrong one, and an invoice under the wrong company's GSTIN is not a
 * mistake you fix by editing a record.
 *
 * HIDDEN WHEN THERE IS ONLY ONE. A picker with a single option is furniture:
 * it takes up room in a crowded bar and teaches nothing. It appears the day
 * a second company exists.
 */
export function CompanySwitcher({
  companies, activeId, onSwitch, onAdded,
}: {
  companies: Company[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const active = companies.find((c) => c.id === activeId);
  const canAdd = companies.some((c) => c.role === "Admin");

  if (!companies.length) return null;
  if (companies.length <= 1 && !canAdd) return null;

  return (
    <>
      {companies.length > 1 ? (
        <Select
          className="topbar-company"
          aria-label="Company"
          value={activeId ?? ""}
          onChange={(e) => onSwitch(e.target.value)}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      ) : (
        <span className="topbar-crumb truncate" title={active?.name}>{active?.name ?? ""}</span>
      )}

      {canAdd ? (
        <Button tone="quiet" size="sm" onClick={() => setAdding(true)}>+ Company</Button>
      ) : null}

      {adding ? (
        <AddCompany
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); onAdded(); }}
        />
      ) : null}
    </>
  );
}

/**
 * Starting a second business in this CRM.
 *
 * WHAT IT DELIBERATELY DOES NOT COPY. The new company inherits the document
 * layout, the terms and the tax defaults — the things that are about how
 * this company likes its paperwork to look. It inherits no GSTIN, no PAN, no
 * logo, no bank account, no document counters and no integration keys.
 * Copying those would produce a second company quietly invoicing under the
 * first one's tax number, which is the single worst thing this feature could
 * do, and it would look like it was working.
 */
function AddCompany({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError(""); setBusy(true);
    try {
      await createCompany(name);
      toast(`${name.trim()} added. Switch to it to set up its details.`, "good");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that company.");
    }
    setBusy(false);
  };

  return (
    <Modal
      open
      title="Add a company"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Add it
          </Button>
        </>
      }
    >
      <div className="stack">
        <label className="small muted" htmlFor="new-company-name">Registered name</label>
        <Input
          id="new-company-name"
          value={name}
          placeholder="Foxpopz Trading Private Limited"
          onChange={(e) => setName(e.target.value)}
        />
        <p className="muted small" style={{ margin: 0 }}>
          It starts with this company's document layout, terms and tax defaults, and with nothing
          else — no GSTIN, no logo, no bank account, no document numbers and no connected mailbox.
          Those belong to one business and are set separately, in Settings, once you switch to it.
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          Its quotations and invoices start again at 0001. Nothing already in the CRM moves.
        </p>
        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
      </div>
    </Modal>
  );
}
