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
