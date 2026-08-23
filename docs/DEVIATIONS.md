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

---

## 5. Supplied brand and ISO assets

Source files and the supplier's usage README live in `brand-assets/`;
`scripts/build-brand-assets.mjs` trims, downscales and embeds them as data
URIs in `src/assets/brandAssets.ts`. Seed values for the settings record are
in `src/domain/documents/brandDefaults.ts`.

### 5a. The third certification was wrong in the supplied strip

`ISO_Certifications_Supplied_Reference.png` names the third certification
**"ISO 22000-1:2018 — Food Safety Management System"**. The design spec and
the individual asset filename both name **ISO/IEC 20000-1:2018 — IT Service
Management System**. These are unrelated standards, and a food-safety claim on
an IT quotation would be false.

Confirmed with the owner as **ISO/IEC 20000-1:2018, IT Service Management
System**. Pinned by test, which also asserts no certification mentions 22000
or food safety.

### 5b. The individual ISO badges are drawn, not pasted

All three supplied ISO PNGs are broken artwork: the standard number overflows
its ring, is clipped at the image edge, and collides with the caption text.
Verified programmatically — `ISO_9001_2015.png` has ink touching the left
edge, `ISO_IEC_20000-1_2018.png` the left and right.

The renderer draws the ring, number, title and scope instead. It is crisp at
any size, prints the scope in full, and lets the third certification be
corrected without new artwork. An explicitly configured asset still wins, so
approved badges can replace this when supplied.

### 5c. HP and Acer are logos, not partner designations

`brand-assets/README.md` is explicit: no approved HP or Acer partner badge was
supplied, so neither may be captioned as a partner. They appear as plain brand
logos among the technology partners. Microsoft, Adobe and Cisco keep their
supplied badge wording unaltered. Asserted by test.

### 5d. Asset quality note

`Cisco_Partner_Supplied_Reference.png` was cropped from a corporate signature
image and is visibly upscaled — soft at print size. It renders acceptably at
the strip's scale, but a vector or higher-resolution original would be better.

---

## 6. Renewals: two changes to how expiry reads

### 6a. Days remaining is counted in calendar days

v1 measured to 23:59:59 on the expiry date from the current clock time, so a
subscription expiring **today** reported "1 day left" for most of the working
day — read by a salesperson as a day of runway that does not exist. Counted in
whole calendar days now, so the number means what its label says and gives the
same answer whatever time it is asked. Pinned by test.

### 6b. A lapsed licence reads as overdue, not as history

v1 greyed out an expired subscription. That contradicted its own sort, which
puts the most urgent first: a customer whose licence lapsed last week is
unlicensed *today*, which is the most urgent row on the screen. Red means
overdue everywhere else in this product, so it means overdue here.

Renewals someone has explicitly marked **Lost** are excluded from the due list
instead — otherwise the list stops being a to-do.

---

## 7. Three renewal screens became one

v1 had a renewal dashboard, a renewal pipeline and a renewal calendar. All
three read the same records and answered the same question — what is about to
lapse, and what is it worth — so they are one screen with 7/30/90-day windows
across the top.

The calendar earned its place least: a list sorted by days remaining says the
same thing in a tenth of the space, and a month grid cannot show the value at
risk, which is the number that makes the list worth opening.

Say the word if the calendar is used in practice and it comes back.
