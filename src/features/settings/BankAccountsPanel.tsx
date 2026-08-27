import { useState } from "react";
import { Button, Card, Chip, Empty, Field, Input, Select } from "../../components/primitives";
import { Confirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import {
  ACCOUNT_TYPES, accountSummary, addAccount, blankAccount, readAccounts, removeAccount,
  setDefaultAccount, updateAccount, warningsFor, type BankAccount,
} from "../../domain/banking/accounts";
import { CURRENCIES } from "../../domain/currency/currencies";

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
    const warnings = warningsFor(editing);
    const set = <K extends keyof BankAccount>(k: K) => (e: { target: { value: string } }) =>
      setEditing((a) => (a ? { ...a, [k]: e.target.value } : a));
    const warningFor = (field: string) => warnings.find((w) => w.field === field)?.message;

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
        <div className="stack-wide">
          <div className="grid grid-2">
            <Field label="Name it" hint="For your own list — “HDFC Current”, “Export account”. Prints after the heading when it differs from the bank.">
              <Input value={editing.label} onChange={set("label")} placeholder="HDFC Current" />
            </Field>
            <Field label="Currency" hint="Which currency this account is for. A document in that currency picks it automatically.">
              <Select value={editing.currency} onChange={set("currency")}>
                <option value="">Any currency</option>
                {CURRENCIES.map(([code, , name]) => <option key={code} value={code}>{code} — {name}</option>)}
              </Select>
            </Field>
          </div>

          <div className="grid grid-2">
            <Field label="Bank" hint={warningFor("name")}>
              <Input value={editing.name} onChange={set("name")} placeholder="HDFC Bank Ltd" invalid={!!warningFor("name")} />
            </Field>
            <Field label="Account holder" hint="Leave blank to print the company name.">
              <Input value={editing.accountName} onChange={set("accountName")} />
            </Field>
          </div>

          <div className="grid grid-2">
            <Field label="Account number" hint={warningFor("account")}>
              <Input value={editing.account} onChange={set("account")} invalid={!!warningFor("account")} />
            </Field>
            <Field label="Account type">
              <Select value={editing.accountType} onChange={set("accountType")}>
                {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
          </div>

          <div className="grid grid-2">
            <Field label="IFSC" hint={warningFor("ifsc") ?? "For payments within India."}>
              <Input
                value={editing.ifsc}
                onChange={(e) => setEditing((a) => (a ? { ...a, ifsc: e.target.value.toUpperCase() } : a))}
                placeholder="HDFC0000123"
                invalid={!!warningFor("ifsc")}
              />
            </Field>
            <Field label="SWIFT / BIC" hint={warningFor("swift") ?? "For payments from outside India."}>
              <Input
                value={editing.swift}
                onChange={(e) => setEditing((a) => (a ? { ...a, swift: e.target.value.toUpperCase() } : a))}
                placeholder="HDFCINBB"
                invalid={!!warningFor("swift")}
              />
            </Field>
          </div>

          <Field label="Branch"><Input value={editing.branch} onChange={set("branch")} placeholder="Netaji Subhash Place, New Delhi" /></Field>

          {warnings.length ? (
            <div className="notice notice-warn">
              <span>
                <strong>These print on every document a customer pays against.</strong> Nothing here stops you
                saving — a foreign account has no IFSC — but a bank will reject what it cannot read.
              </span>
            </div>
          ) : null}
        </div>
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
