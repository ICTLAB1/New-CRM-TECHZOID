/**
 * The company's own bank accounts — where customers are told to pay.
 *
 * WHAT WAS ALREADY HERE. Both ends of this have existed since the start:
 * `settings.bankAccounts` is read when a document is rendered, and
 * `SalesDocument.bankAccountId` picks which one prints. What was missing
 * was every way of putting an account into that list or choosing between
 * them — so the details on every quotation, proforma and invoice were
 * whatever had been seeded, unreachable and unchangeable from the app.
 *
 * MORE THAN ONE IS THE NORMAL CASE, which is why this is a list rather
 * than a single set of fields on the company record: a rupee current
 * account for domestic sales and a foreign-currency account for exports are
 * different accounts, and putting the INR one on a USD invoice is how a
 * customer's wire comes back a week later minus the charges.
 */

export interface BankAccount {
  id: string;
  /** What it is called internally — "HDFC Current", "Export account". Shown
   *  in the picker, and printed after the heading when it adds something. */
  label: string;
  /** The bank. */
  name: string;
  /** Whose account it is. Falls back to the company name when blank. */
  accountName: string;
  account: string;
  ifsc: string;
  swift: string;
  branch: string;
  accountType: string;
  /** Which currency this account is for, or "" for any. Only ever used to
   *  preselect — never to forbid. Somebody invoicing in dirhams from the
   *  rupee account may have a reason, and a CRM that refuses is wrong more
   *  often than it is right. */
  currency: string;
  /** The account used when a document does not name one. Exactly one at a
   *  time; see setDefaultAccount. */
  isDefault: boolean;
  /** A UPI QR as a data URI, printed beside the details on a document. */
  upiQr?: string;
}

export const ACCOUNT_TYPES = ["Current Account", "Savings Account", "Cash Credit", "Overdraft", "EEFC Account"] as const;

const uid = (): string => "bank_" + Math.random().toString(36).slice(2, 9);

export function blankAccount(): BankAccount {
  return {
    id: uid(), label: "", name: "", accountName: "", account: "", ifsc: "",
    swift: "", branch: "", accountType: "Current Account", currency: "INR",
    isDefault: false,
  };
}

/** Legacy rows, and anything hand-edited, may be missing half of this. */
export function normalizeAccount(raw: Partial<BankAccount> & { id?: string }): BankAccount {
  return {
    ...blankAccount(),
    ...raw,
    id: raw.id || uid(),
    isDefault: raw.isDefault === true,
  };
}

/**
 * The stored accounts, normalised.
 *
 * When none of them claims to be the default, the first one is — because
 * that is already what a document falls back to, and a list showing no
 * default while quietly printing one is a list that lies. Accounts stored
 * before the default existed all arrive this way.
 */
export function readAccounts(settings: Record<string, unknown>): BankAccount[] {
  const raw = Array.isArray(settings["bankAccounts"]) ? (settings["bankAccounts"] as Partial<BankAccount>[]) : [];
  const accounts = raw.map(normalizeAccount);
  if (!accounts.length || accounts.some((a) => a.isDefault)) return accounts;
  return accounts.map((a, i) => ({ ...a, isDefault: i === 0 }));
}

/**
 * Exactly one default, always.
 *
 * Two accounts both claiming to be the default means the one that prints
 * depends on array order, which nobody can see and a re-save can change.
 */
export function setDefaultAccount(accounts: BankAccount[], id: string): BankAccount[] {
  return accounts.map((a) => ({ ...a, isDefault: a.id === id }));
}

/** Removing the default promotes the first survivor, so documents that name
 *  no account keep printing something. */
export function removeAccount(accounts: BankAccount[], id: string): BankAccount[] {
  const left = accounts.filter((a) => a.id !== id);
  if (!left.length || left.some((a) => a.isDefault)) return left;
  return left.map((a, i) => ({ ...a, isDefault: i === 0 }));
}

export function addAccount(accounts: BankAccount[], account: BankAccount): BankAccount[] {
  /* The first account added is the default by definition — there is
     nothing else for a document to fall back to. */
  const next = [...accounts, account];
  return accounts.length === 0 ? setDefaultAccount(next, account.id) : next;
}

export function updateAccount(accounts: BankAccount[], account: BankAccount): BankAccount[] {
  return accounts.map((a) => (a.id === account.id ? account : a));
}

/**
 * Which account a document should print.
 *
 * In order: the one it names; the one matching its currency; the default;
 * the first there is. The currency step is what keeps an export invoice off
 * the rupee account without anybody having to remember.
 */
export function pickBankAccount(
  accounts: BankAccount[],
  bankAccountId: string | undefined,
  currency?: string,
): BankAccount | null {
  if (!accounts.length) return null;
  const named = accounts.find((a) => a.id === bankAccountId);
  if (named) return named;
  const cur = (currency ?? "").trim().toUpperCase();
  if (cur) {
    const matching = accounts.find((a) => (a.currency ?? "").trim().toUpperCase() === cur);
    if (matching) return matching;
  }
  return accounts.find((a) => a.isDefault) ?? accounts[0] ?? null;
}

/** Enough of an account to be worth printing. A block naming a bank with no
 *  number tells a customer nothing and looks like a mistake on a document. */
export const accountIsUsable = (a: Pick<BankAccount, "name" | "account">): boolean =>
  !!(a.name ?? "").trim() && !!(a.account ?? "").trim();

/** How an account reads in a picker. */
export function accountSummary(a: BankAccount): string {
  const tail = (a.account ?? "").trim().slice(-4);
  return [a.label || a.name, tail ? "····" + tail : "", a.currency].filter(Boolean).join(" · ");
}

/* ── what a bank will and will not accept ──────────────────────────────
   Checked because these print on a document a customer pays against, and
   a transposed IFSC is found by the customer's bank, days later. Every
   check WARNS and none of them block: a foreign account has no IFSC at
   all, and a CRM that refuses to save one is broken for exports. */

/** Four letters, a zero, then six alphanumerics. RBI's format, fixed. */
export const IFSC_SHAPE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** SWIFT/BIC: 4 bank, 2 country, 2 location, optionally 3 branch. */
export const SWIFT_SHAPE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export interface AccountWarning {
  field: "name" | "account" | "ifsc" | "swift" | "label";
  message: string;
}

export function warningsFor(a: BankAccount): AccountWarning[] {
  const out: AccountWarning[] = [];
  const ifsc = (a.ifsc ?? "").trim().toUpperCase();
  const swift = (a.swift ?? "").trim().toUpperCase();
  const account = (a.account ?? "").replace(/\s/g, "");

  if (!(a.name ?? "").trim()) out.push({ field: "name", message: "Without a bank name this account will not print at all." });
  if (!account) out.push({ field: "account", message: "Without an account number this will not print at all." });
  else if (!/^\d{6,20}$/.test(account)) {
    out.push({ field: "account", message: "Indian account numbers are 6 to 20 digits. Check this one — it prints on every invoice." });
  }
  if (ifsc && !IFSC_SHAPE.test(ifsc)) {
    out.push({ field: "ifsc", message: "An IFSC is four letters, a zero, then six more characters — like HDFC0000123." });
  }
  if (swift && !SWIFT_SHAPE.test(swift)) {
    out.push({ field: "swift", message: "A SWIFT code is 8 or 11 characters — like HDFCINBB." });
  }
  if (!ifsc && !swift) {
    out.push({ field: "ifsc", message: "No IFSC and no SWIFT — a customer cannot send money to this account from the details on the document." });
  }
  return out;
}
