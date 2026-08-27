import { useState } from "react";
import { Button, Chip, Field, Input } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { validateGSTIN } from "../../domain/gstin/validate";
import { nameDisagrees, statusLine } from "../../domain/verification/gstin";
import { looksLikePan, panWithinGstin } from "../../domain/verification/pan";
import {
  applyGstinVerification, applyPanVerification, panContradictsGstin,
  useLegalName, verificationAgeDays, verificationIsStale,
} from "../../domain/verification/apply";
import { verificationAvailable, verifyGstin, verifyPan } from "../../data/verification";
import type { Customer } from "../../domain/customers/customer";

/**
 * Checking a customer's GSTIN and PAN against the government register.
 *
 * WHAT THIS IS FOR. The checksum validator beside the GSTIN field can only
 * say the number is well-formed. It cannot say whether the registration
 * exists, whether it is still active, or whose it is — and a cancelled
 * GSTIN passes the checksum perfectly. An invoice raised against one comes
 * back from the customer's accountant, after the goods have shipped.
 *
 * THE ANSWER HAS A DATE ON IT. A verification is a paid, point-in-time
 * call, so it is stored rather than repeated on every render, and the panel
 * shows how old it is instead of a bare tick. A registration active in
 * March may be cancelled by September; a six-month-old answer says so.
 */
export interface VerifyPanelProps {
  customer: Customer;
  onChange: (next: Customer) => void;
}

export function VerifyPanel({ customer, onChange }: VerifyPanelProps) {
  const toast = useToast();
  const [busy, setBusy] = useState<"" | "gstin" | "pan">("");
  const [consent, setConsent] = useState(false);
  const [panDraft, setPanDraft] = useState("");

  const available = verificationAvailable();
  const gstin = (customer.gstin ?? "").trim().toUpperCase();
  const gstinReady = validateGSTIN(gstin).valid;
  const age = verificationAgeDays(customer.gstinVerifiedAt);
  const stale = verificationIsStale(customer.gstinVerifiedAt);

  const runGstin = async () => {
    setBusy("gstin");
    try {
      const outcome = await verifyGstin(gstin);
      if (outcome.state === "ok") {
        onChange(applyGstinVerification(customer, outcome.result));
        const line = statusLine(outcome.result);
        toast(`${outcome.result.legalName || gstin} — ${line.text}`, line.tone === "good" ? "good" : line.tone);
        if (nameDisagrees(customer.company ?? "", outcome.result)) {
          toast(
            `The register has this GSTIN under “${outcome.result.legalName}”, not “${customer.company}”. `
            + "Both can be right — check it is the same company before invoicing.",
            "warn",
          );
        }
        return;
      }
      /* "The register said no" and "we could not ask" are different, and
         only one of them is about the customer's number. */
      toast(outcome.message, outcome.state === "not-found" ? "warn" : "bad");
    } finally {
      setBusy("");
    }
  };

  const pan = (panDraft || customer.pan || panWithinGstin(gstin)).trim().toUpperCase();

  const runPan = async () => {
    setBusy("pan");
    try {
      const outcome = await verifyPan({ pan, name: customer.legalName || customer.company || "", consent: true });
      if (outcome.state === "ok") {
        onChange(applyPanVerification(customer, outcome.result));
        toast(
          outcome.result.valid
            ? `PAN ${outcome.result.pan} is valid${outcome.result.name ? " — held by " + outcome.result.name : ""}.`
            : `The register does not recognise PAN ${outcome.result.pan}${outcome.result.status ? " (" + outcome.result.status + ")" : ""}.`,
          outcome.result.valid ? "good" : "warn",
        );
        setPanDraft("");
        return;
      }
      toast(outcome.message, outcome.state === "not-found" ? "warn" : "bad");
    } finally {
      setBusy("");
    }
  };

  const status = customer.gstinStatus
    ? statusLine({
        gstin, legalName: customer.legalName ?? "", tradeName: customer.tradeName ?? "",
        status: customer.gstinStatus, taxpayerType: customer.gstinTaxpayerType ?? "",
        constitution: "", registeredOn: customer.gstinRegisteredOn ?? "", cancelledOn: "",
        address: { line: "", city: "", state: "", pincode: "" }, natureOfBusiness: [],
      })
    : null;

  return (
    <div className="stack">
      <div className="eyebrow">Verification</div>

      {!available ? (
        <p className="field-hint">
          Checking a GSTIN against the register needs a signed-in workspace. This preview has no server to ask.
        </p>
      ) : null}

      <div className="stack">
        <div className="row-tight">
          <Button
            size="sm"
            onClick={() => void runGstin()}
            disabled={!available || !gstinReady}
            loading={busy === "gstin"}
            loadingLabel="Asking the register…"
          >
            {customer.gstinVerifiedAt ? "Check the GSTIN again" : "Verify GSTIN"}
          </Button>
          {status ? <Chip tone={status.tone === "good" ? "good" : status.tone === "bad" ? "bad" : "warn"}>{status.text}</Chip> : null}
        </div>

        {!gstinReady && available ? (
          <p className="field-hint">
            {gstin ? "Finish the GSTIN above and this will check it against the register." : "Enter a GSTIN above to check it against the register."}
          </p>
        ) : null}

        {customer.gstinVerifiedAt ? (
          <p className={stale ? "field-msg" : "field-hint"}>
            {age === 0 ? "Checked today." : age === 1 ? "Checked yesterday." : `Checked ${age} days ago.`}
            {stale ? " Registrations change — worth checking again." : ""}
            {customer.gstinRegisteredOn ? ` Registered ${customer.gstinRegisteredOn}.` : ""}
          </p>
        ) : null}

        {customer.legalName ? (
          <Field
            label="Registered name"
            hint="What the register holds this GSTIN under. This is the name that belongs on a tax invoice."
          >
            <div className="row-tight">
              <Input value={customer.legalName} readOnly />
              {(customer.company ?? "").trim() !== customer.legalName ? (
                <Button size="sm" tone="quiet" onClick={() => onChange(useLegalName(customer))}>Use as company name</Button>
              ) : null}
            </div>
          </Field>
        ) : null}
      </div>

      <div className="stack">
        <Field
          label="PAN to check"
          hint={panWithinGstin(gstin) && !customer.pan ? "Taken from the GSTIN above." : "Ten characters, like AACCN1234M."}
        >
          <Input
            value={pan}
            onChange={(e) => setPanDraft(e.target.value.toUpperCase())}
            placeholder="AACCN1234M"
          />
        </Field>

        {panContradictsGstin({ pan, gstin }) ? (
          <p className="field-msg">
            This PAN is not the one inside the GSTIN above ({panWithinGstin(gstin)}). One of the two has a typo in it.
          </p>
        ) : null}

        {/* Consent is a legal requirement for a PAN check, not a formality:
            the request carries a claim that the holder agreed, so the claim
            is made by a person ticking a box, never by a default in code. */}
        <label className="row-tight" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>This customer has agreed to us verifying their PAN.</span>
        </label>

        <div className="row-tight">
          <Button
            size="sm"
            onClick={() => void runPan()}
            disabled={!available || !consent || !looksLikePan(pan)}
            loading={busy === "pan"}
            loadingLabel="Asking the register…"
          >
            Verify PAN
          </Button>
          {customer.panVerifiedAt ? (
            <Chip tone={customer.panVerified ? "good" : "bad"}>
              {customer.panVerified ? "PAN verified" : "PAN not recognised"}
            </Chip>
          ) : null}
        </div>

        {customer.panName ? <p className="field-hint">Held by {customer.panName}.</p> : null}
      </div>
    </div>
  );
}
