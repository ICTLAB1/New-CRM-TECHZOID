import { describe, expect, it } from "vitest";
import {
  accountIsUsable, accountSummary, addAccount, blankAccount,
  pickBankAccount, readAccounts, removeAccount, setDefaultAccount, updateAccount, warningsFor,
  type BankAccount,
} from "./accounts";

const acc = (o: Partial<BankAccount>): BankAccount => ({ ...blankAccount(), ...o });

const INR = acc({ id: "inr", label: "HDFC Current", name: "HDFC Bank Ltd", account: "50200045678901", ifsc: "HDFC0000123", currency: "INR", isDefault: true });
const USD = acc({ id: "usd", label: "Export account", name: "ICICI Bank", account: "000305012345", swift: "ICICINBB", currency: "USD" });

describe("keeping exactly one default", () => {
  it("moves the default rather than adding a second", () => {
    // Two accounts claiming to be the default means the one that prints
    // depends on array order, which nobody can see.
    const next = setDefaultAccount([INR, USD], "usd");
    expect(next.filter((a) => a.isDefault).map((a) => a.id)).toEqual(["usd"]);
  });

  it("makes the first account added the default", () => {
    // There is nothing else for a document to fall back to.
    const one = addAccount([], acc({ id: "a" }));
    expect(one[0]?.isDefault).toBe(true);
  });

  it("does not steal the default from an existing account", () => {
    const two = addAccount([INR], acc({ id: "b" }));
    expect(two.find((a) => a.id === "inr")?.isDefault).toBe(true);
    expect(two.find((a) => a.id === "b")?.isDefault).toBe(false);
  });

  it("promotes a survivor when the default is removed", () => {
    // Otherwise every document naming no account silently prints nothing.
    const left = removeAccount([INR, USD], "inr");
    expect(left).toHaveLength(1);
    expect(left[0]?.isDefault).toBe(true);
  });

  it("leaves an empty list empty", () => {
    expect(removeAccount([INR], "inr")).toEqual([]);
  });

  it("does not disturb the default when removing a non-default", () => {
    const left = removeAccount([INR, USD], "usd");
    expect(left.map((a) => a.id)).toEqual(["inr"]);
    expect(left[0]?.isDefault).toBe(true);
  });
});

describe("which account a document prints", () => {
  it("uses the one the document names, whatever else is true", () => {
    expect(pickBankAccount([INR, USD], "usd", "INR")?.id).toBe("usd");
  });

  it("matches the document's currency when it names none", () => {
    // Putting the rupee account on a dollar invoice is how a customer's
    // wire comes back a week later minus the charges.
    expect(pickBankAccount([INR, USD], "", "USD")?.id).toBe("usd");
    expect(pickBankAccount([INR, USD], undefined, "usd")?.id).toBe("usd");
  });

  it("falls back to the default when no currency matches", () => {
    expect(pickBankAccount([INR, USD], "", "AED")?.id).toBe("inr");
  });

  it("falls back to the first when nothing is marked default", () => {
    const none = [acc({ id: "a" }), acc({ id: "b" })];
    expect(pickBankAccount(none, "", "")?.id).toBe("a");
  });

  it("ignores an id that no longer exists", () => {
    // A deleted account must not blank the bank block on old documents.
    expect(pickBankAccount([INR, USD], "deleted-account", "")?.id).toBe("inr");
  });

  it("has nothing to print when there are no accounts", () => {
    expect(pickBankAccount([], "anything", "INR")).toBeNull();
  });
});

describe("reading what is stored", () => {
  it("fills in what a legacy or hand-edited row is missing", () => {
    const [a] = readAccounts({ bankAccounts: [{ id: "x", name: "HDFC Bank Ltd", account: "1234567890" }] });
    // isDefault is true because it is the only one and nothing else
  // claimed it — the promotion rule below.
    expect(a).toMatchObject({ id: "x", name: "HDFC Bank Ltd", swift: "", accountType: "Current Account", isDefault: true });
  });

  it("gives a row with no id one, so the picker can tell them apart", () => {
    const [a] = readAccounts({ bankAccounts: [{ name: "HDFC" }] });
    expect(a?.id).toBeTruthy();
  });

  it("copes with nothing stored, or rubbish", () => {
    expect(readAccounts({})).toEqual([]);
    expect(readAccounts({ bankAccounts: "not an array" })).toEqual([]);
  });

  it("treats anything but true as not the default", () => {
    const [a, b] = readAccounts({ bankAccounts: [{ id: "x", isDefault: "yes" }, { id: "y" }] });
    // Neither claimed it, so the first one gets it — see below.
    expect(a?.isDefault).toBe(true);
    expect(b?.isDefault).toBe(false);
  });

  it("makes the first the default when none of them claims it", () => {
    // Accounts stored before the default existed all arrive this way, and
    // the first is already what a document falls back to. A list showing no
    // default while quietly printing one is a list that lies.
    const [a, b] = readAccounts({ bankAccounts: [{ id: "x" }, { id: "y" }] });
    expect(a?.isDefault).toBe(true);
    expect(b?.isDefault).toBe(false);
  });

  it("leaves an explicit default alone", () => {
    const [a, b] = readAccounts({ bankAccounts: [{ id: "x" }, { id: "y", isDefault: true }] });
    expect(a?.isDefault).toBe(false);
    expect(b?.isDefault).toBe(true);
  });
});

describe("editing one", () => {
  it("replaces only the one edited", () => {
    const next = updateAccount([INR, USD], { ...USD, branch: "BKC, Mumbai" });
    expect(next.find((a) => a.id === "usd")?.branch).toBe("BKC, Mumbai");
    expect(next.find((a) => a.id === "inr")).toEqual(INR);
  });
});

describe("whether it is worth printing", () => {
  it("needs a bank and a number", () => {
    // A block naming a bank with no number looks like a mistake on a
    // document a customer is about to pay against.
    expect(accountIsUsable(INR)).toBe(true);
    expect(accountIsUsable({ name: "HDFC", account: "" })).toBe(false);
    expect(accountIsUsable({ name: "", account: "123" })).toBe(false);
    expect(accountIsUsable({ name: "  ", account: "  " })).toBe(false);
  });

  it("reads in a picker without showing the whole number", () => {
    expect(accountSummary(INR)).toBe("HDFC Current · ····8901 · INR");
    expect(accountSummary(acc({ name: "Axis Bank", account: "", currency: "" }))).toBe("Axis Bank");
  });
});

describe("what a bank will not accept", () => {
  it("catches an IFSC in the wrong shape", () => {
    expect(warningsFor(acc({ name: "HDFC", account: "50200045678901", ifsc: "HDFC123" })).some((w) => w.field === "ifsc")).toBe(true);
    expect(warningsFor(acc({ name: "HDFC", account: "50200045678901", ifsc: "HDFC0000123" })).some((w) => w.field === "ifsc")).toBe(false);
  });

  it("catches a SWIFT in the wrong shape, and accepts both lengths", () => {
    expect(warningsFor(acc({ name: "ICICI", account: "000305012345", swift: "ICICINBB" })).some((w) => w.field === "swift")).toBe(false);
    expect(warningsFor(acc({ name: "ICICI", account: "000305012345", swift: "ICICINBB001" })).some((w) => w.field === "swift")).toBe(false);
    expect(warningsFor(acc({ name: "ICICI", account: "000305012345", swift: "ICICI" })).some((w) => w.field === "swift")).toBe(true);
  });

  it("says so when there is no way to send money at all", () => {
    const w = warningsFor(acc({ name: "HDFC", account: "50200045678901" }));
    expect(w.some((x) => x.message.includes("cannot send money"))).toBe(true);
  });

  it("NEVER refuses a foreign account for having no IFSC", () => {
    // A CRM that will not save an export account is broken for exports.
    // Every one of these is a warning; none of them is a block.
    const warnings = warningsFor(USD);
    expect(warnings.every((w) => typeof w.message === "string")).toBe(true);
    expect(warnings.some((w) => w.field === "ifsc")).toBe(false);
  });

  it("catches a number that is not a number", () => {
    expect(warningsFor(acc({ name: "HDFC", account: "50200-abc", ifsc: "HDFC0000123" })).some((w) => w.field === "account")).toBe(true);
    // Spaces are how people type them and are not an error.
    expect(warningsFor(acc({ name: "HDFC", account: "5020 0045 6789", ifsc: "HDFC0000123" })).some((w) => w.field === "account")).toBe(false);
  });
});
