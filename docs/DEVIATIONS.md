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

---

## 8. The Netlify functions

Nine functions, rewritten. **Every deployed contract is unchanged**: the same
paths, the same request fields, the same environment-variable names, the same
provider for each service. In particular `/.netlify/functions/ms-oauth-callback`
keeps its exact path, because the Azure app registration on the live tenant
points at it and renaming it would break every connected mailbox until someone
edited the registration by hand.

What changed is what happens inside them. Each item below was a live
vulnerability or a real failure mode in v1.

### 8a. HTML injection in the OAuth callback — fixed

`ms-oauth-callback` returns an HTML page, and interpolated Microsoft's
`error_description` query parameter straight into it. That parameter is under
the control of whoever crafts the link back to the callback, so any script in
it ran on the site's own origin, where the CRM's Supabase session lives.

Everything variable now goes through `escapeHtml`, and the page carries a
restrictive `Content-Security-Policy`. The escaping is asserted by test using an
actual `<script>` payload.

### 8b. OAuth state was not verified — fixed

v1 passed the CRM user's id through the OAuth `state` parameter and trusted it
on the way back. Anyone could consent with their own Microsoft account and hand
back a state naming somebody else: from then on that person's quotations would
send from the attacker's mailbox, and their customer correspondence would land
in the attacker's Sent Items.

State is now HMAC-signed with a 15-minute expiry and compared with
`timingSafeEqual`. Forged, tampered, expired and future-dated states are each
rejected under test. `MS_STATE_SECRET` is the signing key; it falls back to the
service-role key so an existing deployment keeps working, and the diagnostics
screen says a dedicated secret is better.

### 8c. `ai-proxy` was unauthenticated — fixed

It called a paid API with no sign-in check at all. Anyone who guessed the URL
could spend the company's money. It now requires a Supabase session and is rate
limited per user, and the model is pinned server-side — v1 took it from the
request body, so a caller could ask for the most expensive one available.

### 8d. Internal errors were returned to callers — fixed

Five handlers returned `err.message` to the client: database messages, provider
responses, sometimes a stack. `fail()` logs the internal detail and returns only
a sentence written for whoever is standing at the screen.

### 8e. `Access-Control-Allow-Origin: *` on token-bearing endpoints — fixed

Every function answered any origin. CORS now echoes only a configured origin
(`ALLOWED_ORIGINS`, or Netlify's own `URL`/`DEPLOY_PRIME_URL`). With none
configured it still falls back to `*`, because a half-deployed site that cannot
call its own API is a worse failure — and the diagnostics screen reports the
fallback so an admin can see it.

### 8f. No rate limiting anywhere — added

Counted in Postgres, not in memory: a serverless function is a fresh process
often enough that an in-memory counter limits nothing. **Schema addition**:
`supabase/004_rate_limits.sql` adds a `rate_limits` table and an atomic
`consume_rate_limit` function. RLS is enabled with no policies, so only the
service role can touch it.

If the limiter itself errors the request is **allowed**, and the error is
logged. Losing enquiries because a counter broke is worse than briefly losing
the limit.

### 8g. Removing the last Admin is refused — new

`delete_user` refuses to remove the only remaining Admin. Doing so locks
everyone out of team management and settings, recoverable only from the
Supabase dashboard.

### 8h. Welcome email failure no longer reads as account failure

Per the brief: if the mail fails the account still exists. `create_user` returns
`{ success: true, emailSent, emailError }` and the message names what to do —
share the password directly. Reporting an error would send an admin round the
loop again, straight into "a user with this email address has already been
registered".

### 8i. `ms-diagnostics` changed shape

The one deployed contract that did change, deliberately: it is admin-only, both
ends are rewritten here, and the old shape could not carry what the screen needs
— which secret is set, a four-character masked hint so an admin can tell the
secret from the secret's ID, whether the table exists, and Microsoft's own
verdict on the credentials with `AADSTS…` codes translated into English. It also
moved from POST to GET, since it changes nothing.

It reports presence and a masked hint, never a value. The one exception is
`MS_REDIRECT_URI`, which is a public URL that has to be pasted into Azure
character for character.

---

## 9. Integrations: three client-side corrections

### 9a. "Send for invoicing" never sent the customer's PO

v1 read `doc.billPo` when building the message to accounts. Nothing in the
application ever wrote that field — the PO lives in `referenceNo`, the editor's
"Customer Reference" — so the line silently never appeared. Now reads the field
that holds it, under test.

### 9b. The WhatsApp fallback link dropped the country code

"Open in WhatsApp instead" is the route that always works: no provider, no
token, no setup. v1 passed the raw digits to `wa.me`, so a ten-digit Indian
number — which is how every number in this CRM is typed — opened a chat with
nobody. The same normalisation the server already applied is now applied to the
link, and both copies of the rule are under test.

### 9c. The assistant is given a scoped summary, not the records

v1 built the assistant's context from whatever the browser held, which under RLS
is already narrowed for a Sales user. The context is now built through
`scopeWorkspace` explicitly, so the narrowing is a decision in the code rather
than a consequence of how the data happened to load. Asserted by test: a Sales
user's snapshot contains their own customers and not a colleague's.

The assistant is also told to say when the snapshot does not contain an answer
rather than produce a figure, and every suggested question is one the snapshot
can actually answer.

---

## 10. Settings, team and catalog

### 10a. A catalog import saves before it reports

v1 parsed a workbook, showed a summary of what it had found, and left the
products in component state. Closing the dialog threw the entire import away —
silently, after telling you it had worked.

Here the parse and the save are one action, and the report describes something
that has already happened. The summary now says how many were saved and how
many products from other vendors were left alone.

### 10b. Every sheet still reports back

Carried over from the parser, and surfaced properly: a sheet that contributed
nothing lists the column names it actually has, so an unreadable price list can
be diagnosed from the screen rather than by sending the file to a developer.

### 10c. Priceless products stay available

Stated on the product form itself, next to the switch someone might otherwise
flip: a product with no price stays in the picker. Marking priceless products
inactive emptied the picker for anyone whose list quotes price on request.

### 10d. Custom fields have one definition

v1 kept the customer form's extra fields in a constant and edited them in
settings — two lists that could disagree. There is now one, in the settings
row, read by both.

### 10e. Removing the last Admin is refused in the interface too

The server already refuses it (§8g). The role selector disables the change as
well, so the answer arrives before the round trip rather than after it.

### 10f. Incentive arithmetic is unchanged, deliberately

Two things in v1's payout calculation look like bugs and have been kept:

- a **Percentage** payout is a percentage of *revenue* whatever metric the slab
  is measured on — a slab on "Deals Won" at 2% pays 2% of revenue;
- a slab's **bonus is added on top of** its payout, not instead of it.

Both are how every payout already made was worked out. Changing either would
silently restate what somebody is owed. They are pinned by test with those
exact words, so a future reader does not "fix" them.

### 10g. Settings commit on Save, never as you type

Each panel edits a draft and writes on Save, with a visible "not saved yet" and
a discard. A settings row that updates on every keystroke is how a company name
gets stored as "TechZoid Technologies Priv" when someone is called away
mid-edit — and that name prints on documents a customer's auditor may read.

### 10h. Restoring a backup will not empty a list the file lacks

A backup written by an older version has fewer lists in it. Restore replaces
only the lists the file actually contains; anything missing is left alone
rather than being emptied. The confirmation counts each list before replacing
anything.

### 10i. Every label now names its control

Found while automating a check of the catalog import: no form in the app bound
a `<label>` to its input. Clicking a label focused nothing, and a screen reader
announced an unnamed box on every field in the product form, the customer
sheet, the document editor and settings.

`Field` now generates an id and hands it to the control it wraps, so all of
them are fixed at once and a new form cannot reintroduce it. Pinned by test,
including the case where the caller sets its own id.

---

## 11. Two v1 screens ported in full

### 11a. Incentives

`calcMetrics` and `computePayout` carried over with the arithmetic unchanged
(see §10f), plus one addition: the screen names the nearest slab still out of
reach and how far away it is, instead of showing a zero and leaving someone to
work out why.

### 11b. The activity timeline

Notes people typed and records the app created, merged into one stream, newest
first, grouped by day and filterable by kind, customer, person and how far
back. Same scoping rule as everywhere else: a Sales user sees their own work.

Two small corrections to v1's version:

- a challan takes its customer and owner from the order it belongs to, rather
  than showing nothing for both;
- a record with no timestamp is grouped as **Undated** rather than filed under
  1 January 1970.
