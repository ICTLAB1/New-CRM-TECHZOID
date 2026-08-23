import { useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, Field, Input, Select, Textarea } from "../../components/primitives";
import { LOST_REASONS, type LostDetail } from "../../domain/pipeline/stages";

/**
 * Asked for when a deal moves to Lost — and never required.
 *
 * "Skip" is always available and always saves the move. Forcing the input
 * would mean a salesperson who does not know the reason either invents one,
 * which poisons the report, or leaves the deal in Negotiation forever, which
 * poisons the pipeline. Neither is worth a mandatory field.
 */
export function LostReasonModal({
  company,
  onSave,
  onSkip,
}: {
  company: string;
  onSave: (detail: LostDetail) => void;
  onSkip: () => void;
}) {
  const [reason, setReason] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Modal
      open
      title={`Why did ${company} not close?`}
      description="Takes ten seconds, and turns “Lost deals” from a count into something you can act on."
      onClose={onSkip}
      footer={
        <>
          <Button tone="quiet" onClick={onSkip}>Skip</Button>
          <Button tone="primary" onClick={() => onSave({ lostReason: reason, lostCompetitor: competitor, lostNotes: notes })}>
            Save reason
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Select a reason…</option>
            {LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>

        {reason === "Lost to competitor" ? (
          <Field label="Which competitor, if known">
            <Input value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="e.g. a rival GeM reseller" />
          </Field>
        ) : null}

        <Field label="Anything else worth noting" hint="Optional.">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
