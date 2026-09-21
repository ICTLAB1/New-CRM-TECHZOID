import { useState } from "react";
import { Button, Card, Chip, Empty } from "../../components/primitives";
import { Confirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { BankAccountFields } from "./BankAccountForm";
import {
  accountSummary, addAccount, blankAccount, readAccounts, removeAccount,
  setDefaultAccount, updateAccount, type BankAccount,
} from "../../domain/banking/accounts";

/**
 * The accounts customers are told to pay into.
 *
 * Both ends of this existed already — a document renders whichever account
 * it names, and falls back to a default — but nothing could put an account
 * into the list or change one, so every quotation and invoice printed
 * whatever had been seeded, with no way to correct it.
 *
 * MORE THAN ONE IS THE NORMAL CASE. A rupee current account and a
 * foreign-currency account are different accounts; which one prints follows
 * the document's currency unless somebody picks otherwise on the document.
 *
 * Nothing here is a hard validation. A foreign account has no IFSC, and a
 * form that refuses to save one would be broken for exactly the exports
 * this company does. The warnings say what a bank will reject; saving is
 * always allowed.
 */
export function BankAccountsPanel({
  settings, canEdit, onChange,
}: {
  settings: Record<string, unknown>;
  canEdit: boolean;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const accounts = readAccounts(settings);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<BankAccount | null>(null);

  const commit = (next: BankAccount[], message: string) => {
    onChange({ ...settings, bankAccounts: next });
    toast(message, "good");
  };

  const save = (account: BankAccount) => {
    const exists = accounts.some((a) => a.id === account.id);
    commit(
      exists ? updateAccount(accounts, account) : addAccount(accounts, account),
      `${account.label || account.name || "Account"} saved.`,
    );
    setEditing(null);
  };

  if (editing) {
    return (
      <Card
        title={accounts.some((a) => a.id === editing.id) ? "Edit bank account" : "New bank account"}
        actions={
          <div className="row-tight">
            <Button size="sm" tone="quiet" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="sm" tone="primary" onClick={() => save(editing)}>Save account</Button>
          </div>
        }
      >
        <BankAccountFields account={editing} onChange={setEditing} />
      </Card>
    );
  }

  return (
    <Card
      title="Bank accounts"
      actions={canEdit ? <Button size="sm" onClick={() => setEditing(blankAccount())}>Add an account</Button> : null}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Printed on quotations, proformas and tax invoices — never on a purchase order, where we are the buyer and
        our own account has no business being. A document uses the account it names, otherwise the one matching its
        currency, otherwise the default.
      </p>

      {!accounts.length ? (
        <Empty
          title="No bank account yet"
          body="Until one is added, quotations and invoices print no payment details at all."
        />
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Bank</th>
                <th>IFSC / SWIFT</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td data-label="Account">
                    <div className="row-tight">
                      <strong>{a.label || a.name || "Unnamed"}</strong>
                      {a.isDefault ? <Chip tone="accent">Default</Chip> : null}
                      {a.currency ? <Chip tone="neutral" dot={false}>{a.currency}</Chip> : null}
                    </div>
                    <div className="field-hint">{accountSummary(a)}</div>
                  </td>
                  <td data-label="Bank">
                    {a.name}
                    {a.branch ? <div className="field-hint">{a.branch}</div> : null}
                  </td>
                  <td data-label="IFSC / SWIFT" className="mono">
                    {[a.ifsc, a.swift].filter(Boolean).join(" · ") || <span className="field-hint">Neither set</span>}
                  </td>
                  <td data-label="">
                    {canEdit ? (
                      <div className="row-tight">
                        <Button size="sm" tone="quiet" onClick={() => setEditing(a)}>Edit</Button>
                        {!a.isDefault ? (
                          <Button size="sm" tone="quiet" onClick={() => commit(setDefaultAccount(accounts, a.id), `${a.label || a.name} is now the default.`)}>
                            Make default
                          </Button>
                        ) : null}
                        <Button size="sm" tone="danger" onClick={() => setConfirmRemove(a)}>Remove</Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!canEdit ? <p className="field-hint" style={{ marginTop: 12 }}>Only an admin or a manager can change these.</p> : null}

      <Confirm
        open={!!confirmRemove}
        title={`Remove ${confirmRemove?.label || confirmRemove?.name || "this account"}?`}
        /* Said plainly, because the consequence is invisible until somebody
           opens an old document and finds the payment block changed. */
        body="Documents that named this account will fall back to the default. Documents already sent are unaffected — a PDF that has gone out is a file, not a view of this list."
        confirmLabel="Remove account"
        tone="danger"
        onConfirm={() => {
          if (confirmRemove) commit(removeAccount(accounts, confirmRemove.id), `${confirmRemove.label || confirmRemove.name} removed.`);
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </Card>
  );
}
