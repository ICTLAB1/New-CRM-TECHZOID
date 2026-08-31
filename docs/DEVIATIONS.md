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

---

## 12. Wiring the real workspace

### 12a. The Supabase client is created on first use

It was created at module scope, so merely importing anything in `data/` threw
when the environment wasn't configured — which took down the preview build
entirely, including screens that never touch a database. Nothing connects now
until something asks for the client.

### 12b. A failed save reloads rather than pretending

Writes are optimistic: the screen updates first. If the write is rejected —
usually row-level security refusing something that isn't yours — the workspace
reloads and a banner says the change wasn't saved. v1 left the rejected change
on screen, so a Sales user could edit a colleague's record, see it apparently
save, and find it unchanged the next morning.

### 12c. Realtime never overwrites a save in flight

A change broadcast while a write is in progress used to pull the pre-write rows
back over what had just been typed. The refetch is debounced and skipped while
anything is being saved.

### 12d. Sign-in never says which half was wrong

"Invalid login credentials" is now "That email and password don't match an
account." Telling someone the address exists but the password is wrong is how
an attacker works out which addresses are worth attacking.

### 12e. A sign-in with no profile row says so

The account exists, the CRM has no record of who it belongs to, and every
screen would be empty. It now says exactly that and offers to sign out, rather
than showing an empty workspace that looks like data loss.

### 12f. The catalog stays in the settings row

v1 stored the product catalog inside `settings.productCatalog`. It stays there:
it is configuration rather than records, and the brief is explicit that the
schema does not change.

---

## 13. The public registration form

Ported from v1, at the same address — `?lead=<salesperson-id>` — so links
already shared with customers keep working. It is checked before anything
else, so a customer with a link never sees a sign-in screen.

Three changes, all in the same direction: it is filled in once, by a stranger,
often on a phone.

- **It says why it wants a GSTIN.** "Optional, but with it your invoice carries
  the tax credit you can claim" — a stranger has no reason to hand over a tax
  number to a form, and the previous version simply asked.
- **The GSTIN is checked as it is typed**, with the same 15-character checksum
  the CRM uses, so a transposition is caught here rather than on the invoice.
- **A dead link is not the visitor's fault.** "Please check the link, or ask
  whoever sent it to you for a fresh one" — and it says plainly that nothing
  typed would reach anyone until it works.

The honeypot field is positioned off-screen rather than `display: none`: some
bots skip hidden fields, and the field only works if they fill it in.

---

## 14. A drift the guard didn't catch

Found by rasterising a sample quotation and looking at it: a line item with no
sub-description printed its **product name** in the grey meant for
specifications. The PDF only redrew the first line in bold when there was a
second line beneath it; the preview always drew it bold. The two renderers
disagreed, on screen, for the simplest possible item.

The drift guard asserts that every value in the model reaches the preview. It
cannot see a style, so it could not see this.

The fix is the same shape as the rest of this architecture: the decision moved
out of both renderers into `splitDescription`, which they now both call, and
which is tested — including the single-line case that broke.

---

## 15. The write path had no tests

`syncEntity` and `syncSettings` — the code that diffs the app's state against
what the server holds and issues the actual writes — had never run against
anything, fake or real. Everything else in this codebase is wrong-and-caught;
this was wrong-and-silent, because a bad diff here doesn't fail loudly, it
rewrites or deletes rows nobody asked it to touch.

`store.ts` is now built around an injectable Supabase client (`createStore`),
with the app's own instance created lazily from the real one on first use.
17 tests drive it against a fake client that records every operation:

- an unchanged record writes nothing — the guarantee that saving one screen
  does not rewrite the whole table, and does not wake every other browser
  through realtime for nothing;
- `id` and `owner_id` are lifted out of the record and never duplicated
  inside the stored blob, where they could drift from the columns RLS
  actually reads;
- the promoted columns (`customer_id`, `order_id`, `quote_id`) are correct
  per table, and an empty relation is written as `null`, not `""`;
- an add, a change and a delete in the same save each produce exactly the
  right operation;
- a write the database refuses — row-level security rejecting a record that
  isn't the caller's — surfaces as a thrown error rather than being
  swallowed;
- loading fills in the fields legacy records were written without, takes the
  id and owner from the columns rather than the jsonb blob even when they
  disagree, and a failed read rejects rather than returning half a
  workspace.

Not yet covered: the realtime guard in `useWorkspace` that skips a refetch
while a save is in flight. Testing that means driving a React hook through
effects and timers, which needs a DOM test environment (jsdom or similar)
this project doesn't have installed yet — adding one is a real dependency
and config decision, left for a session where that's asked for rather than
assumed.

---

## 16. The quotation redesign: matching the client's reference document

The client supplied a definitive reference quotation (`TZ/QT/2026-27/0042`)
and asked for its format exactly, superseding the design pack in §4 wherever
the two disagree. Both renderers changed together, per the shared
`DocumentModel` architecture; nothing here is PDF-only or preview-only.

### 16a. Document number: full four-digit year, hyphenated

v1 and the design pack both produced `PREFIX/2627/0001` — both financial
years compressed to two digits, no separator. The reference shows
`TZ/QT/2026-27/0042`: the full starting year, a hyphen, then the closing
year's two digits. `buildDocNumber` now produces the reference's format.

This only affects documents created from here on — a document number already
stored is just text, so existing quotations keep their old-format numbers.
Pinned by `parity.test.ts` → "document numbering", including an explicit
assertion that the new format does **not** match v1's.

### 16b. Company details moved from the footer into the header

v1 and the design pack printed the company's address, contact line and
GSTIN/PAN/CIN in the footer, repeated on every page. The reference prints
them once, directly under the company name in the header, and keeps the
footer to the closing line and page number. `DocumentModel.footer` is now
just `{ closing }`; the header carries `addressLines`, `contactLine` and
`registration` instead.

Found and fixed in the same pass: `header.tagline` read `s.tagline`, but the
company's tagline is stored at `settings.company.tagline` — every other
company field. The tagline silently fell back to its default before this fix.

### 16c. A UAE office banner, with real settings behind it

The reference carries a highlighted banner under the header rule: office
address, phone, business licence number and tax registration number. The
`uaeOffice` section toggle already existed, but nothing in Settings could
ever populate `settings.uaeOffice` — the banner was unreachable dead code.
`CompanyPanel` now has a UAE office card (address, phone, business licence,
tax registration number), and the header renders it when either the address
or phone is filled in.

### 16d. An HSN/SAC summary table, computed once

The reference adds a table grouping every line by its HSN/SAC code, showing
each group's taxable value, rate, tax (CGST+SGST or IGST, matching the
document's actual tax split) and total. `computeDocument()` now returns
`hsnGroups`, grouped and summed the same way `slabs` already groups by rate —
lines with no HSN/SAC set are left out of every group rather than bucketed
under `""`. `DocumentModel.hsnSummary` formats it for display; the total row
reads `t.taxable`/`t.cgst`/`t.sgst`/`t.igst`/`t.taxTotal` directly rather than
re-summing, so it can never disagree with the SUMMARY box above it.

### 16e. Certifications print as plain text, not a drawn medallion ring

§5b's drawn ISO ring — standard on the left, title and scope beside it — does
not appear in the reference at all. Each certification there is just its name
and a licence/certificate number, centred, no ring, no scope line.
`medallionNumber()` and the ring-drawing code are gone; `LogoSlot.medallion`
is replaced with `LogoSlot.certNo`, printed under the name when configured.
Never fabricated: `DEFAULT_CERTIFICATIONS` carries no `certNo`, same as it
has always carried no artwork, and prints just the name until an admin fills
the real number in.

### 16f. The signature block is drawn — it never was

`DocumentModel.signature` (`forLine`, `signatoryName`, `signatoryDesignation`)
was fully computed since the original build but never drawn by either
renderer — a genuine missing feature, not a design choice. Both renderers now
draw "For {company}", a blank band for a physical signature, then the
signatory's name and designation — falling back to "Authorised Signatory"
when neither is configured, which is what the reference itself shows.

The customer-acceptance box and "We Accept" payment-methods line, also
computed but never drawn, are still not drawn: the reference carries neither,
so `DEFAULT_DOC_TEMPLATE.sections.customerAcceptance` is now off by default
to match it. The acceptance box now renders (both renderers) when a business
explicitly turns the toggle back on; "We Accept" remains a further gap, left
for when it is actually asked for.

### 16g. Bank details print on a quotation too, not only a proforma

The reference's page 2 carries a BANK DETAILS block below the HSN/SAC
summary, on a *quotation*. v1 and the design pack showed bank details only on
a proforma, sharing the terms column. `bankBlock` in the model is no longer
gated to `isProforma`; each renderer draws it in its own block, after the
HSN/SAC summary, only for a quotation (a proforma keeps showing it beside its
summary, where there is no terms column to share the space with, unchanged).

---

## 17. Two-way sync with the company website

v1 had no integration with the marketing site at all. Leads captured on
`ttpldelhi.com` were retyped.

**Outbound** — `netlify/functions/webhook-dispatch-background.mjs` posts
`deal.created`, `deal.stage_changed`, `deal.won`, `deal.lost` and
`activity.logged` to a configured endpoint. Signed Stripe-style,
`t=<unix>,v1=<hex>` HMAC-SHA256 over `"<t>.<body>"`, matching the scheme the
website already expected. **The body is re-signed on every retry attempt**,
not once before the loop: the backoff schedule (8 attempts, 255s total) plus
per-attempt timeouts can exceed the receiver's 300-second replay window, and
a signature that ages out mid-retry fails as though the secret were wrong.
The event id stays fixed across attempts so the receiver still dedupes.

**Inbound** — `netlify/functions/webhook-receive.mjs` takes the same events
back from the website. It carries **no bearer token**: the signature is the
authentication, and a second secret in the URL would only be a second thing
to leak. Exactly-once is enforced by inserting the event id into
`webhook_received` as a lock rather than by checking-then-inserting.

**No echo loop, structurally.** Inbound writes reach the browser through
Supabase realtime → `useWorkspace.reload()` → `setData()`. The outbound
dispatcher is called only from `Workbench.handleCustomersChange`, which
realtime never goes through. This is a property of the wiring, not a flag
somebody has to remember to set.

Signing secrets have **no client-facing RLS policy at all** — not a
restrictive one, none. `webhook_secrets` is readable only by the service
role, and a secret is shown exactly once, at generation.

## 18. Purchase orders

New in v2: v1 recorded only what the company sold.

Its own table rather than a flag on `quotes`, because the two face opposite
directions — mixing them would put suppliers in the sales pipeline and count
money owed as money owed *to* us on every dashboard. It reuses
`SalesDocument` and the shared `DocumentModel`, so it renders through the
same renderer and preview as a quotation and cannot drift from the format the
client signed off. Three party boxes instead of two (SUPPLIER / BILL TO /
SHIP TO), sized from the party count rather than at a fixed four columns —
equal columns wrapped the document number mid-token.

Three things a PO deliberately does **not** carry, all confirmed against the
client's own reference: bank details (we are paying, not being paid), the
customer-acceptance box, and a "thank you for the opportunity" closing.
Acceptance is instead a **Supplier Acknowledgement** block, and its height is
derived from the field count — at the fixed height it was, the fourth field's
rule ran straight through "Company Seal".

BILL TO is **not stored on the order**. It is read from settings at render
time, so changing the company's registered address does not leave old orders
showing the old one.

## 19. Goods receipt

Deliveries are stored as **events**, never as a `receivedQty` accumulated on
each line. A running total loses the delivery history the moment anyone
corrects a number and cannot answer "which delivery was short"; with events,
a mistyped delivery is fixed by removing it rather than by reverse-engineering
what the number used to be.

Completion is decided **per line, never by summed quantity**: an order where
one item arrived twice over and another never arrived is not complete, and
comparing totals says it is. Over-delivery is its own status rather than a
negative outstanding, which reads as a shortage at a glance. A negative
receipt quantity is treated as a keying error and ignored — honouring it
would silently increase what the supplier still owes, and returns are their
own document.

`impliedStatus` never revives a cancelled order and never touches a draft.
It reports; the caller applies.

Receipts live in the order's existing `data` column, so this needed no
migration.

## 20. Tax invoices and receivables

v1 stopped at the proforma. A won quotation had nowhere to go.

The invoice is a fourth document type on the shared model. It differs from a
quotation only where the document genuinely differs: `validUntil` is a
**payment due date**, not a validity window — an invoice does not expire, it
falls overdue — there is no customer-acceptance block (an invoice is a
demand, not an offer), and bank details stay, because that is how the
customer pays.

**Receivables is derived, never stored.** Outstanding and age are computed
from each invoice's payment ledger and its due date on every read, which is
what stops a "paid" flag set by hand from disagreeing with the money actually
recorded. The grand total is **injected** into `buildReceivables` rather than
re-derived inside it, so the figure being chased is the figure the invoice
prints — a receivables screen with its own idea of what an invoice is worth
is the first place the two could diverge. Drafts and cancelled invoices are
excluded: issuing is what creates the debt.

## 21. Attachments

New in v2. Two halves kept in step: the bytes in a **private** Supabase
Storage bucket, and a row in `attachments` saying what they are and what they
belong to.

`upload` deletes the object it just wrote if the row insert fails, and
`remove` drops the row only *after* the object is gone — the other order can
leave bytes nobody can see, because with the row gone nothing names the path
any more.

`storage.objects` carries its own policies. A private bucket is not a policy;
it only means there is no public URL. Objects live under
`<owner-uuid>/<record-type>/<record-id>/<unique>-<name>`, owner first, so the
policies decide from the first path segment without joining anything. Read is
deliberately wider than write: any signed-in user may read, but only the
file's owner or an Admin/Manager may write or delete.

**There is no update policy on `attachments`, on purpose.** A row describes
bytes that already exist; repointing it after the fact is how an approved
document quietly becomes a different one. Replacing a file means deleting and
uploading again.

File type is decided by **extension, not by the MIME the browser reports**. A
browser calls `.docx` "application/zip" and `.exe` "application/octet-stream";
the extension is what the operating system acts on when somebody
double-clicks the download.

`record_type` + `record_id` is loose rather than five foreign keys, since a
file can hang off a customer or any of four document types. The trade is that
a deleted record would leave orphan rows, which the app clears on delete —
the safer failure, because an orphaned row is tidy-up and a cascade that ate
a signed contract is not.

In demo mode the panel says attachments need a signed-in workspace rather
than offering an upload that would quietly lose somebody's contract.

## 22. Attachments became a team resource

As first shipped (§21), a file could only be read or added by the record's
owner or an Admin/Manager. That is wrong for how this company works: a
salesperson covering a colleague's account cannot see the signed purchase
order sitting against it, and the file ends up emailed around instead —
which is the outcome attachments exist to prevent.

Read and add are now open to anyone signed in. **Delete is not**: it is the
person who uploaded the file, or an Admin/Manager. Adding is additive and
reversible; deleting somebody else's signed contract is neither.

This needed a second identity on the row. `owner_id` is who owns the
*record*; `uploaded_by_id` is who put the file there, and it is what the
delete policy reads. The insert policy checks `uploaded_by_id = auth.uid()`,
so a row cannot claim somebody else uploaded it — which would also hand its
deletion to that person.

The storage path changed with it, from the record owner's folder to the
**uploader's**. The object policy accepts writes only inside your own first
path segment, so keying the path off the record owner would have rejected
every cross-owner upload. Files written before this keep their old path;
read is bucket-wide so they stay visible, and they stay deletable by exactly
who could delete them before.

One consequence, accepted deliberately: deleting a record no longer
guarantees its attachments go with it. A colleague's file survives, because
the policies will not let you remove what you did not upload. The tidy-up
being untidy is the better failure.

Sales orders gained attachments here too. "The documents related to an
order" are mostly the customer's own paperwork — their PO, a signed delivery
note, a site photo — none of which this CRM produces, and all of which were
previously only findable in somebody's inbox.

Previewing moved in-app. A signed URL is minted when the viewer opens rather
than held on every row: a list of twenty files would otherwise mint twenty
links, nineteen of which nobody clicks, each a working way into the bucket
for five minutes. PDFs render in a `sandbox=""` frame — the file belongs to
somebody else and renders inside the app's own page.

## 23. Follow-ups, registration links and customer IDs

Automatic follow-ups on a quotation: three by default (day 3, 7 and 14),
armed when a quotation is emailed and cancelled the moment the document is
decided — accepted, rejected, expired, cancelled or paid. **Draft is not a
decision**, and treating it as one would have cancelled every sequence
overnight, because emailing a quotation does not by itself change its
status. The stop rule exists twice, once in TypeScript for the app and once
in plain JavaScript for the scheduled Netlify function, and a single test
file exercises both against the same table of cases — two copies that agree
is the arrangement; two copies that drift is the bug.

WhatsApp follow-ups go through Interakt's Cloud API. Business-initiated
messages outside Meta's 24-hour window must be templates, so a follow-up is
always sent as an approved template rather than free text, and it requires
`whatsappOptIn` on the customer. An unticked box is not consent, and neither
is a legacy record that predates the question.

Registration links are short (`?lead=` plus a per-user code from
`my_lead_code()`) rather than a raw customer UUID, and the CRM can email one
straight to a customer. Every customer, however they arrive, is allocated a
readable ID — CUST-000124 — by `next_customer_code()` in the database, not
by the browser: the public form runs on a server with nobody watching, and
two readers of one counter hand out the same number twice.

## 24. Repeat business reaches the board

Moving a customer along the pipeline when a quotation goes out (§ the
pipeline rules in `src/domain/pipeline/advance.ts`) originally refused to
touch anybody marked Won or Lost, on the reasoning that a conclusion is a
decision and an automatic rule may not overwrite one.

That is right about the deal and wrong about the customer. An existing
client is the likeliest person in the database to be quoted again, and under
that rule their quotation was the one that appeared nowhere — the board
showed every new lead and none of the repeat business.

The rule is now about the quotation, not the customer: **a quotation raised
after the conclusion is new business** and puts the customer back on the
board; one raised before it is the paperwork of the concluded deal and
changes nothing. Within the open stages nothing changed — a second
quotation for a deal in Negotiation still leaves it there.

Two things had to become true first.

A win is now a **fact with a date and an amount**, not a state a record is
in. `wonAt` was already stamped once and never re-stamped; `wonValue` joins
it, snapshotting what the deal was worth at the moment it was won. Revenue
reports, the dashboard and the incentive figures read those instead of the
current stage, so moving a re-engaged customer out of Won does not erase
what they already bought, and re-quoting them at a different value does not
rewrite last quarter.

**Lost is the exception, and getting it wrong cost a day in production.**
The rule was first written as "stage is Won, or there is a `wonAt`". Because
the stamp is deliberately never cleared, that also took in every deal marked
Won and later marked Lost — and on the live board it put a lost ₹39.76 L
deal into "Won this month", so the tile read ₹42.21 L while the pipeline
funnel three inches below it read ₹3.03 L for the same deals.

The rule now asks about Lost first. A deal in an open stage carrying a
`wonAt` is a customer coming back; a deal in Lost is not, whatever happened
before it. The test that was supposed to cover this passed for the wrong
reason — its lost customer had no `wonAt`, so the hard question was never
asked. There is now one that asks it.

And the customer sheet's Stage field now goes through `applyStage` like the
board always has. Marking somebody Won from the sheet used to set the stage
and nothing else — no `wonAt` — so that deal never appeared in a single
revenue chart. Losses are stamped too, with `lostAt`, which is what lets a
revival be told from the loss itself.

## 25. Document numbers are allocated by the database

Every document series — quotation, proforma, purchase order, tax invoice,
sales order, delivery challan — had its counter in the shared `settings`
row, which the browser read, used, and wrote back incremented.

`settings` is writable only by an admin or a manager. A salesperson's
write-back was rejected by row-level security, the rejection was swallowed,
and **every quotation they raised came out with the same number**. Even with
the rights it was a read-then-write from however many browsers were open.

`public.next_doc_seq(kind)` (migration 018) does both halves in one
statement, as the database. Twelve concurrent callers get 1 to 12 with no
duplicates and no gaps; a salesperson may call it, because the right to take
the next number is not the right to edit company settings.

The number is still taken when a document is **saved**, not when the editor
opens: a series with holes in it is a question from an auditor, and opening
the editor and changing your mind must not leave one. The number shown while
editing is a preview, labelled as such, and typing over it clears the
`autoNumber` flag so a number somebody chose by hand survives the save.

When there is no database — the preview build — or when migration 018 has
not been applied yet, allocation falls back to the browser's own counter.
That is the old behaviour: wrong under contention, but it does not lose the
document somebody has just spent ten minutes on. The fallback logs.

## 26. Notes on a customer

`Customer.notes` had been in the type since the beginning. The activity
timeline read it, the webhook dispatcher fired `activity.logged` when one
appeared, and **nothing anywhere could create one** — so the timeline showed
only what the app itself had recorded, and the half of it meant to hold
"rang Rajesh, wants the AMC split out" was always empty.

The customer sheet now has the box, next to the follow-up date it is usually
written to change. A note carries what kind of contact it was, what was
said, optionally an outcome and what happens next, and who recorded it.

Notes are **append-only**. There is no edit and no delete: a call log that
can be rewritten afterwards cannot be relied on by whoever reads it on
Friday, and they would have no way to know it had been changed. A correction
is a new note saying so.

## 27. GSTIN and PAN verified against the register

The checksum validator beside the GSTIN field is offline arithmetic: it
reads the state code and the PAN out of the number and confirms the check
digit. It cannot say whether the registration exists, whether it is still
active, or whose it is — and **a cancelled GSTIN passes the checksum
perfectly**. An invoice raised against one comes back from the customer's
accountant, after the goods have shipped.

Verification goes through Sandbox (sandbox.co.in). The key and secret are
Netlify environment variables read only on the server; the browser calls our
own function, which calls the provider. They are deliberately **not**
prefixed `VITE_` — anything with that prefix is compiled into the JavaScript
every visitor downloads, and a paid verification key published on the
internet is somebody else's free key. The build is checked for this: the
shipped bundle contains neither credential nor even the provider's hostname.

The endpoint is authenticated and rate-limited per person, for the reason
`ai-proxy` was in v1: an endpoint that verifies without asking who is
calling is somebody else's free verification service.

**What the register says is recorded; what a person typed is not
overwritten.** The registered name lands in `legalName`, beside `company`,
never on top of it — customers are known internally by divisions, brands and
short forms that somebody has typed into forty quotations, and silently
replacing that would rewrite how they appear everywhere with nothing to
notice it by. Applying it is a button. The address is the one exception, in
one direction: it fills fields that are **empty**, because a blank city on a
record that now has an authoritative one is a gap, not a decision.

An answer carries its date rather than a bare tick. A registration active in
March may be cancelled by September, so the panel says "checked 200 days
ago" and marks anything past six months as worth re-checking.

Three distinctions the code is careful about, because getting any of them
backwards is worse than not having the feature:

- **"The register says no" is not "we could not ask."** A 404 means the
  register answered about the number somebody typed; a 429 or a 502 means we
  never got to ask. Telling a salesperson their customer's GSTIN is bad when
  in fact the service was down sends them to the wrong conversation.
- **A blank status is never read as active.** Guessing in the reassuring
  direction is how a cancelled registration gets invoiced.
- **A name that differs is not a name that disagrees.** "Northline Logistics
  Pvt Ltd" and "NORTHLINE LOGISTICS PRIVATE LIMITED" are the same company.
  Flagging that pair every time is how people learn to ignore the flag.

PAN verification requires the holder's consent, so the request carries a
consent flag — set from a box a person ticks, never defaulted in code, and
refused server-side without it.

The provider's endpoints could not be confirmed by calling them: the machine
this was built on has no route to `api.sandbox.co.in`. They are therefore
isolated in a `ROUTES` map at the top of `netlify/lib/sandbox.mjs` with a
comment saying so, everything downstream is independent of them, and
Integrations → Test connection reports the provider's own status code so a
mismatch is a two-line change rather than an investigation.

Aadhaar OKYC and bank-account verification are also available from this
provider and are **not** built. Both are about individuals and need a
consent journey of their own; neither is what a B2B customer record needs.

## 28. Bank accounts became something you can manage

Both ends of this had existed since the start and never met. A document
renders whichever account it names — `SalesDocument.bankAccountId` — and
`settings.bankAccounts` is the list it names one from. Nothing anywhere
could put an account into that list, edit one, or choose between them. So
every quotation, proforma and invoice printed whatever had been seeded, and
correcting a branch address meant editing the database by hand.

**More than one is the normal case**, which is why this is a list rather
than a set of fields on the company record. A rupee current account and a
foreign-currency account are different accounts, and putting the INR one on
a USD invoice is how a customer's wire comes back a week later minus the
charges. An account can name the currency it is for; a document in that
currency picks it without anybody remembering.

Which account prints, in order: the one the document names, the one
matching its currency, the default, the first there is. The document
editor's picker shows what the automatic answer would be — the choice is
visible on the screen where it is made rather than discovered on the PDF.

Never on a purchase order. Bank details tell someone where to pay **us**;
on a document where we are the buyer, our own account is at best noise and
at worst an invitation to misdirect a payment. The renderer already refused
to print it there and the picker does not offer it.

Exactly one default, always. Two accounts both claiming it means the one
that prints depends on array order, which nobody can see and a re-save can
change. Adding the first account makes it the default because there is
nothing else to fall back to; removing the default promotes a survivor; and
a stored list where none claims it reads as the first one being it —
because that is already what prints, and a list showing no default while
quietly printing one is a list that lies.

**Every check warns and none of them blocks.** An IFSC in the wrong shape,
an account number with letters in it, no IFSC and no SWIFT at all — each is
flagged, in the words of what a bank will reject, and each still saves. A
foreign account has no IFSC, and a form that refuses to save one is broken
for exactly the exports this company does.

## 29. The counter functions were callable without signing in

Found by looking at the live database rather than by re-reading the
migration:

```
select routine_name, grantee from information_schema.role_routine_grants
where specific_schema = 'public' and routine_name = 'next_doc_seq';
-- anon, authenticated, postgres, service_role
```

Migration 018 ends with `revoke all on function … from public`, which reads
like it closes this and does not. **PUBLIC is the pseudo-role; `anon` is a
real one**, and Supabase's default privileges grant EXECUTE on every new
function in `public` to anon and authenticated as it is created. The revoke
removed the pseudo-role's grant and left anon's untouched. Every
security-definer function in the schema was affected, not only the new one.

Nothing readable was exposed — none of these return anybody's data. But two
of them **advance a counter**, and the anon key is in the JavaScript every
visitor downloads by design. So anyone could push quotation numbers and
customer IDs to arbitrary values by calling them in a loop.
`next_customer_code` had been open since it was written; `next_doc_seq`
since earlier the same day.

`find_duplicate_customer` and `my_lead_code` already refused when
`auth.uid()` was null and were never exposed this way. Their grants are
revoked too — a grant nothing needs is a grant worth not having.

Fixed in two layers, because **the grant comes back on its own**: any
future `create or replace` re-triggers those default privileges silently,
so a revoke alone would quietly undo itself the next time one of these
functions is edited. The in-function check is what still holds then.

The guard refuses **anon specifically** rather than demanding a signed-in
user, and that distinction is the whole care in it: `next_customer_code` is
also called by the public registration form, which runs server-side as
`service_role` and therefore has no `auth.uid()` at all. A "must be signed
in" check would have broken every customer arriving through the form — the
one path nobody would think to test by hand.

## 30. Money is shown in the currency the record is in

Every screen formatted every figure as rupees. A hard-coded ₹, Indian
grouping, whatever the record's currency actually was. A proforma raised in
dollars rendered correctly on its own PDF and read as **₹11,948** in the
list beside it — the same digits, the wrong currency, and nothing on screen
to say which one the customer would be billed.

The document renderer had always done this properly, through
`fmtCurrency()`. The CRM's own tables and tiles never did. `moneyList()`
and `moneyShort()` are the same idea for screens, and the old `inr*`
helpers stay as the INR case so that rupee figures are unchanged to the
character — pinned by a test that walks both over the same numbers.

**The scale words are not universal**, which is why the compact form takes a
currency. Crore and lakh are how Indian money is read and how this CRM
writes it everywhere else; "$2.57 L" is not a shorter way of writing a
dollar figure, it is a phrase a reader in New York has to decode. Rupees
keep Cr/L/K, everything else gets M/K.

### Totals were worse than a formatting bug

₹100 + $100 is not 200 of anything. Every list footer, every outstanding
balance and every summary tile was adding across currencies, so a total was
wrong by the whole of the foreign documents in it — and looked authoritative
being wrong.

`totalsByCurrency()` keeps them apart, and the screens print "₹23,59,866 +
$11,948" rather than one figure. Where more than one currency is in play the
line says so.

**No exchange rates, deliberately.** Converting needs a rate source and a
decision about *which* rate — the day the document was raised, the day it
was paid, today — and a made-up rate produces a single confident number that
is wrong in a way nobody can see. Two honest numbers beat one invented one.
Until somebody decides the rate policy, the currencies stay apart.

Applied to the document lists, the editor, and receivables — where an
outstanding balance in two currencies is two different debts. **The
dashboard's summary tiles still add across currencies** and are the
remaining place this is wrong; they are compact by design and need a
product decision about what a mixed-currency tile should say.

## 31. Incentives could not see an invoice

Reported as "I created a customer, made a proforma which is paid, and an
invoice sent and accepted, worth more than ₹22 lakhs — incentives are not
updated." The screen read **Deals won 3, Revenue earned ₹0**, which is the
contradiction that gives it away.

Three separate faults, stacked.

**Invoices were never passed in.** The analytics `Workspace` had no
`invoices` field at all, and `Workbench` did not send them. The incentive
calculation could not see a tax invoice even in principle.

**Revenue was read from a typed estimate.** It came from the Deal value on
the customer record — while the screen said "worked out from deals actually
closed, not from targets typed in". A raised, accepted invoice counted for
nothing.

**And a zero could freeze permanently.** `applyStage` snapshotted
`wonValue: customer.wonValue ?? (Number(customer.value) || 0)`. `??` falls
through on null and undefined but **not on 0**, so a deal marked Won before
anybody typed a value got `wonValue: 0`, and `wonAmount()` returned 0 for
ever after — the real figure typed in later could not get past the
snapshot. Three won deals and no revenue is exactly what that looks like.
Fixed by never snapshotting a zero.

The compounding is what made it total silence rather than a wrong number: a
Percentage slab pays a percentage of **revenue** whatever its own metric, so
revenue of zero paid zero on every slab, including the ones measured on
deals won.

### Revenue now has three meanings, and you pick one

They are genuinely different money — the difference is *when* somebody gets
paid, not a detail:

- **Tax invoices raised** — recognised revenue, counted the day the invoice
  is raised. Drafts excluded; an invoice nobody sent is not revenue.
- **Payments received** — money as it actually clears, across invoices and
  proformas alike, because this company takes payment against a proforma
  routinely. Dated by the **payment**, not the document: a January invoice
  settled in March is March's revenue to somebody paid on collections.
- **Deal value on the customer** — the old behaviour, kept so an existing
  scheme is not silently restated.

**The default stays the old behaviour** for exactly that reason. Changing
what somebody is owed without them asking is the one thing this file has
warned against since the schemes were written; the basis is chosen per
scheme in Settings → Incentives, and the incentives screen names the basis
under the revenue figure so nobody has to guess what they are being paid on.

## 32. The screens were not connected to each other

Reported as "check all inter connectivity, most of them are not working
properly", and the reporter was right. One cause underneath all of it: **tax
invoices and sales orders were added to the CRM after the analytics and
hand-off layers were written, and never wired into them.** Each screen
worked; the joins between them did not.

**The whole Deliver section had no way in.** `orderFromProforma()` existed,
complete and correct, and nothing anywhere called it. Sales orders could
never be created, and since dispatch challans are raised from a sales order,
Dispatch was unreachable too — two screens in the navigation that could only
ever show seed data. A proforma now confirms into a sales order, numbered
from the same database counter every other document uses.

**Tax invoices were invisible to four screens.**

- *Dashboard* — "Payments due" and "Needs attention" read proformas only, so
  an overdue invoice showed on Receivables and nowhere on the screen people
  open first. Money owed is money owed whichever document asked for it.
- *Activity* — raising an invoice, the moment the money is actually asked
  for, left no trace on the one screen that claims to show everything that
  happened.
- *Reports* — the payments report counted proformas only.
- *Incentives* — see §31; the workspace had no `invoices` field at all.

The scoping helper carries invoices through as well, or a Sales user's
dashboard would silently drop them again after all this.

### What was checked and is connected

Quotation → proforma → invoice; proforma → sales order → dispatch challan;
purchase order → goods receipt; invoice → receivables; a quotation sent →
the pipeline board; a deal won → the revenue reports; a note logged →
Activity. Subscriptions and renewals are entered directly, by design —
nothing upstream creates them.

Purchase orders deliberately stay out of the sales analytics: they are the
buy side, and counting what the company spends as though it were revenue is
worse than not counting it.

## 33. Auto-refresh that does not depend on Realtime, and a message board

### Everybody's screen keeps itself current

The realtime subscription was already here and already right: a change
arrives as a table name, and the workspace refetches everything, which is
cheap at this size and cannot get out of step the way applying individual
row events can.

What it could not do is **tell anybody when it was not working**. It depends
on the Realtime service being switched on for the project and every table
being in the publication — server-side configuration this code cannot see,
cannot fix, and cannot even detect: a socket that never delivers looks
exactly like a workspace where nothing is happening.

So it is no longer relied on alone. Coming back to the tab refetches, which
is the moment somebody is about to read the screen; and a 45-second poll
runs underneath, so a screen left open on a wall display stays true even if
the socket never connects. All three go through one guard — never pull the
server's rows over a save still in flight — and none of them run while the
tab is hidden, because there is nothing to refresh into and a background tab
polling all day is somebody's battery.

### An admin can put a message on everybody's screen

For the things that cannot wait for a meeting: the GST portal is down, stop
raising invoices; prices change on Monday.

**Stored, not shouted.** A socket message only reaches whoever happens to be
looking, and "stop raising invoices" has to reach the person who opens the
CRM twenty minutes later too. So it is a row, read on load, on refocus, and
on a poll — the same three routes as the workspace, for the same reason.

**Because it interrupts, it is rationed.** Shown once per person and then
never again; gone at its expiry whether or not anybody read it. A popup that
comes back is one people learn to dismiss without reading, and then the one
that mattered is dismissed too. The composer says as much in the panel:
this is worth having *because it is rare*.

Row-level security does the deciding, proven against a real Postgres before
any client code was written: a person reads only what is addressed to them
or to everybody and has not expired — a message to one person did not appear
for another; only an admin or a manager can send; and `from_id` must be the
sender, so a message cannot go out under somebody else's name. The admin who
tried to forge one in the test got the same refusal as the salesperson who
tried to send one at all.

Dismissals are kept in the browser rather than in a table. A read receipt
would need a row per person per message, and the question being answered is
only "has this screen shown it yet" — which is a property of the screen. The
id list is capped, because a list that grows for ever fills the storage
quota and then every write fails silently, which would show every message on
every load.

## 34. Vendor price lists, and the margin on a deal

### One cost price was never true

The same SKU comes from several distributors at different prices, those
prices are quoted for a period and then expire, and which one you can
actually get today is the job. A single `costPrice` field can only hold one
of those, and quoting off a stale one is how a deal is won at a loss.

A product now carries a list: distributor, cost, currency, valid-until, and
a note ("deal reg", "Q3 promo"). **Expired prices are skipped rather than
silently used** — that is the entire point of recording the date, and the
catalog says so when every price on a product has lapsed.

`costPrice` stays and stays meaningful: it is kept level with the cheapest
live entry, so every screen written before this — and every document already
saved — reads exactly as it did.

### Margin, where the decision is made

**The cost is captured on the line, not looked up later.** A price list
changes; a quotation does not. Reading the catalog when a six-week-old
quotation is reopened would restate its margin every time a distributor
moved a price, and last month's reported margin would drift under
everyone's feet. Same reason `wonValue` is snapshotted when a deal is won.

The editor shows the margin beside the grand total, so it is visible at the
moment somebody decides the price rather than discovered in a report next
month. A live example from the demo data: an HP laptop quoted at ₹1,12,500
less 8% against a ₹1,18,000 cost reads **"₹-6,125 margin (-0.4%)"** with
*"At least one line is priced below what it cost"* under it.

Three things it refuses to do:

- **An uncosted line is unknown, not free.** Averaging it in as zero cost
  would report a 100% margin on a line nobody has costed. Uncosted lines are
  excluded and the count of them is stated.
- **A zero cost IS a cost.** Free stock still has a margin, so `0` counts and
  only a missing value is unknown.
- **A healthy total does not hide a loss-making line.** `anyBelowCost` is
  tracked separately, because the loss-leader buried inside a profitable
  quote is exactly what a single percentage conceals.

### None of it reaches the customer

Cost and margin are on the record and on the editor's own screen. They are
**not** in the model the PDF and the preview are built from, and a test
asserts it by serialising the whole model and searching for the cost
figures — so a cost reaching any part of the document fails the build, not
only a cost column. The day somebody adds one "just for debugging" is the
day a customer opens a quotation and reads what the product cost.
