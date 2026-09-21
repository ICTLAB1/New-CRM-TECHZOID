import { Field, Input, Select } from "../../components/primitives";
import {
  ACCOUNT_TYPES, warningsFor, type BankAccount,
} from "../../domain/banking/accounts";
import { CURRENCIES } from "../../domain/currency/currencies";

/**
 * The fields of one bank account, with nothing around them.
 *
 * PULLED OUT OF BankAccountsPanel SO IT IS NOT ONLY IN SETTINGS. An account
 * is missed at the moment a document needs it — an export invoice in
 * dirhams, and the only accounts on file are rupee ones — and sending
 * somebody to Settings at that moment means abandoning a half-typed
 * invoice. The document editor opens this same form over the document, the
 * way it already does for a customer who is not on file yet.
 *
 * IT IS THE SAME FORM, deliberately, not a cut-down one. An account added
 * in a hurry mid-invoice is the one that most needs the IFSC and SWIFT
 * checks, and a second form would have drifted from this one within a
 * month.
 *
 * Nothing here is a hard validation: a foreign account has no IFSC, and a
 * form that refused to save one would be broken for exactly the exports
 * this is for. The warnings say what a bank will reject; saving is always
 * allowed.
 */
export function BankAccountFields({
  account, onChange,
}: {
  account: BankAccount;
  onChange: (next: BankAccount) => void;
}) {
  const warnings = warningsFor(account);
  const set = <K extends keyof BankAccount>(k: K) => (e: { target: { value: string } }) =>
    onChange({ ...account, [k]: e.target.value });
  const warningFor = (field: string) => warnings.find((w) => w.field === field)?.message;

  return (
      <div className="stack-wide">
        <div className="grid grid-2">
          <Field label="Name it" hint="For your own list — “HDFC Current”, “Export account”. Prints after the heading when it differs from the bank.">
            <Input value={account.label} onChange={set("label")} placeholder="HDFC Current" />
          </Field>
          <Field label="Currency" hint="Which currency this account is for. A document in that currency picks it automatically.">
            <Select value={account.currency} onChange={set("currency")}>
              <option value="">Any currency</option>
              {CURRENCIES.map(([code, , name]) => <option key={code} value={code}>{code} — {name}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid grid-2">
          <Field label="Bank" hint={warningFor("name")}>
            <Input value={account.name} onChange={set("name")} placeholder="HDFC Bank Ltd" invalid={!!warningFor("name")} />
          </Field>
          <Field label="Account holder" hint="Leave blank to print the company name.">
            <Input value={account.accountName} onChange={set("accountName")} />
          </Field>
        </div>

        <div className="grid grid-2">
          <Field label="Account number" hint={warningFor("account")}>
            <Input value={account.account} onChange={set("account")} invalid={!!warningFor("account")} />
          </Field>
          <Field label="Account type">
            <Select value={account.accountType} onChange={set("accountType")}>
              {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
        </div>

        <Field
          label="IBAN"
          hint={warningFor("iban") ?? "For an account outside India, this is what the customer pays into. Leave blank for an Indian account."}
        >
          <Input
            value={account.iban}
            onChange={(e) => onChange({ ...account, iban: e.target.value.toUpperCase() })}
            placeholder="AE31 0860 0000 0923 9742 660"
            invalid={!!warningFor("iban")}
          />
        </Field>

        <div className="grid grid-2">
          <Field label="IFSC" hint={warningFor("ifsc") ?? "For payments within India."}>
            <Input
              value={account.ifsc}
              onChange={(e) => onChange({ ...account, ifsc: e.target.value.toUpperCase() })}
              placeholder="HDFC0000123"
              invalid={!!warningFor("ifsc")}
            />
          </Field>
          <Field label="SWIFT / BIC" hint={warningFor("swift") ?? "For payments from outside India."}>
            <Input
              value={account.swift}
              onChange={(e) => onChange({ ...account, swift: e.target.value.toUpperCase() })}
              placeholder="HDFCINBB"
              invalid={!!warningFor("swift")}
            />
          </Field>
        </div>

        <Field label="Branch"><Input value={account.branch} onChange={set("branch")} placeholder="Netaji Subhash Place, New Delhi" /></Field>

        {warnings.length ? (
          <div className="notice notice-warn">
            <span>
              <strong>These print on every document a customer pays against.</strong> Nothing here stops you
              saving — a foreign account has no IFSC — but a bank will reject what it cannot read.
            </span>
          </div>
        ) : null}
      </div>
  );
}
