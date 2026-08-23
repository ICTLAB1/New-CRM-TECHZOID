import { Modal } from "../../components/Modal";
import { Button } from "../../components/primitives";

/**
 * Raised when a new customer looks like one already in the CRM.
 *
 * It WARNS — it never blocks. Two genuinely different companies can share a
 * name, and a hard block would only teach people to mangle the name until it
 * saved. "Continue anyway" is a real, equal option.
 */
export function DuplicateWarning({
  company,
  matchCompany,
  matchOwner,
  byGstin,
  onEdit,
  onContinue,
}: {
  company: string;
  matchCompany: string;
  matchOwner: string;
  byGstin: boolean;
  onEdit: () => void;
  onContinue: () => void;
}) {
  return (
    <Modal
      open
      title={byGstin ? "A customer with this GSTIN already exists" : "A customer with this name already exists"}
      onClose={onEdit}
      footer={
        <>
          <Button tone="quiet" onClick={onEdit}>Go back and edit</Button>
          <Button tone="primary" onClick={onContinue}>Continue anyway</Button>
        </>
      }
    >
      <div className="notice">
        <div>
          <strong>{matchCompany}</strong>, owned by {matchOwner}, is already in the CRM
          {byGstin ? " with the same GSTIN." : " under a very similar name."}
          {byGstin
            ? " A GSTIN identifies one registered business, so this is very likely the same company."
            : ""}
        </div>
      </div>
      <p className="field-hint" style={{ marginTop: 12 }}>
        You are saving <strong>{company}</strong>. Continue anyway if this is genuinely a different company —
        two businesses can share a name.
      </p>
    </Modal>
  );
}
