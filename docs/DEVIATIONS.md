# Deliberate deviations from v1

v1 is the specification. Everything else in this codebase reproduces its
behaviour exactly, proven by the parity suite in `src/domain/parity.test.ts`.

This file lists every place the rewrite deliberately behaves differently, why,
and what would be lost by reverting. Nothing gets added here without a test.

---

## 1. Amount in words: minor unit rounding up to a whole unit

**v1:** an amount whose paise/cents round to 100 printed the literal word
`undefined` on the customer's document.

```js
v1.amountInWords(99.995)
// "Ninety Nine Rupees and undefined Paise Only"
```

`Math.round((99.995 - 99) * 100)` is `100`, and `ONES[100]` is `undefined`.

**Now:** the minor unit carries into the whole unit.

```ts
amountInWords(99.995)  // "One Hundred Rupees Only"
```

**Why deviate:** in practice every total passes through `round2()` before
reaching this function, so a three-decimal amount should never arrive — but a
document that prints "undefined" to a customer is not a failure mode worth
preserving, and the carry is the arithmetically correct answer regardless.

**Found by:** the parity fuzz, not by reading the code.

**Tests:** `parity.test.ts` → "deviation: minor unit rounding up to a whole
unit", including an assertion that no amount in `0.000`–`0.999` can produce
the string `undefined`.

---

## 2. Catalog import: currency marks on the known-column path

**v1:** `round2(get("ERP Price", ...))` — `round2` is `Number()` underneath, so
a price written `₹1,25,000` under a perfectly well-recognised header imported
as **0**, silently. v1 stripped `₹`, commas and spaces only on the *inferred*
column path.

**Now:** `stripMoney()` is applied on both paths, for both `sellPrice` and
`costPrice`.

**Why deviate:** the brief requires stripping `₹` and commas as a property of
the parser, and a price silently importing as zero is precisely the class of
failure the generous-matching rules exist to prevent — the same reasoning v1's
own comment gives for trimming whitespace in headers ("silently import every
price as zero rather than erroring, which is worse than a crash").

**Tests:** `parseWorkbook.test.ts` → "strips currency marks and thousands
separators".

---

## 3. `profiles` RLS update policy

The zip of v1 carries a `schema.sql` whose `profiles_update_self_or_admin`
policy has **no `with check` clause** — hard-won detail #11, the bug that let
any authenticated user set their own role to `Admin`.

Production has since been fixed, and the live policy is:

```sql
create policy "profiles_update_self_or_admin" on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (
    public.is_admin()
    or role = (select p.role from public.profiles p where p.id = auth.uid())
  );
```

`supabase/schema.sql` here carries the **live** version, with a `drop policy
if exists` ahead of it so re-running the file is safe. This is not a schema
change — it aligns the checked-in file with what the database already enforces.

---

## Behaviour deliberately NOT "fixed"

Things that look like bugs and are being kept, because v1 is the specification
and no brief item calls them out:

- **`amountInWordsWestern` never pluralises the currency name** — "One Hundred
  US Dollar Only", not "Dollars". v1 behaviour, asserted by test.
- **`fmtCurrency` formats INR with en-US grouping** (`₹1,234,567.89`), while
  the separate `inr()` helper used for on-screen CRM figures uses en-IN
  (`₹12,34,567.89`). Documents and dashboards differ on purpose in v1.
- **A blank `billState` counts as inter-state**, so a legacy customer with no
  state captured gets IGST rather than a CGST+SGST split.
- **Catalog header scanning gives up after 15 rows**, then falls back to column
  inference, which can harvest preamble rows as junk products. Noisy beats
  empty — and the per-sheet import report is what surfaces it.
- **An unknown `taxType` is taxed**, not treated as exempt. Only the exact
  string `"none"` zeroes tax.

---

## 4. The approved quotation design replaces v1's document layout

`docs/quotation-design/` holds the supplied pack — reference render, spec,
tokens and data example. The document is now built to that design: navy
header with a number plaque, a three-column details grid (quotation details,
BILL TO, SHIP TO), a four-cell reference strip, a nine-column items table, a
terms-and-summary split, partner/certification strips and a company footer.

Four points where the pack, v1, and the rebuild brief disagreed, each decided
explicitly rather than picked silently:

### 4a. INR now groups in lakhs and crores

v1 grouped every currency western-style — an INR document read
"₹2,173,877.50". The approved design renders "₹21,73,877.50" on every figure.
INR uses `en-IN`; every other currency keeps `en-US`, which is correct for
USD, AED, EUR and the rest.

**This changes the face of every INR document the company sends.** Pinned by
`parity.test.ts` → "deviation: INR groups in lakhs and crores", which also
asserts non-INR currencies still match v1 exactly.

### 4b. The licence-key clause is gone from the default terms

v1's domestic terms carried:

> Licence keys, activation codes, and subscription plans, once delivered and
> activated, are strictly non-returnable and non-refundable as per the
> respective OEM's licensing policy.

The supplied spec omits it and instructs that the standard terms must not
mention licence keys, activation or provisioning at all. The fourteen supplied
clauses are used verbatim, so **that cover is no longer in the default terms**
for a business whose main product line is software licences.

Decided explicitly. Terms remain fully editable per document, so the clause
can be re-added to any individual quotation, and `terms.ts` records where it
went. Restoring it as a default is a one-line change to `DOMESTIC_TERMS`.

### 4c. Tax rows follow the tax mode, not the reference image

The reference image prints CGST, SGST **and** IGST together with zeros in the
inapplicable rows. The spec text says to show CGST/SGST or IGST according to
the actual tax mode, which is also v1's behaviour. The written spec wins: a
zero line invites the reader to wonder what it is for.

### 4d. Logo slots fall back to text

No badge or partner image assets were supplied. The layout reserves the slots
and renders them from settings when assets are configured; until then each
prints its name, shrinking to fit rather than breaking a brand name mid-word.
No badge, partner designation or certification is ever drawn from nothing.

### Not adopted from the spec

- **"Never use browser floating point"** — the rebuild brief states tax and
  currency behaviour must not change, and the parity suite pins it. The
  existing discipline is `round2()` at every step, which is what v1 does and
  what those tests hold. Introducing a decimal library would change results.
  Revisit only with the parity suite as the check.
