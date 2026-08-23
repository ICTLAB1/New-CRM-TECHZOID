# Architecture

## The shape

```
domain/   pure functions. No React, no I/O, no Supabase, no jsPDF imports at
          the top level. Everything here is unit-testable in a node
          environment and is where every rule from the brief actually lives.

data/     Supabase access and the legacy-normalisation boundary. The only
          layer that knows about tables, RLS or realtime channels.

features/ one folder per feature area, owning its screens and local state.
          Reaches into domain/ for calculation and data/ for persistence.

components/ the shared library. Presentational, no business logic.

integrations/ one interface describing everything the browser asks a server
          to do on its behalf, plus the implementation that calls the Netlify
          functions. Screens take the interface, never `fetch`.

netlify/  the functions themselves, plus lib/ — the shared HTTP, auth,
          validation, signing and rate-limiting they all use. Plain .mjs,
          because that is what Netlify runs.
```

The direction of dependency is strictly one-way:

```
features/ ─▶ domain/
         └─▶ data/ ─▶ domain/
components/ (depends on nothing but React)
```

`domain/` importing from `features/` or `data/` is the thing to watch for in
review — it is what turned v1 into a 12,000-line file.

## The server boundary

Anything needing a secret runs in a Netlify function: the Microsoft client
secret, the Resend key, the WhatsApp token, the Anthropic key, and the Supabase
service-role key. None of them may ever reach a browser bundle.

Everything else goes straight to Supabase from the client, where row-level
security is the access control. The rule for deciding: **if the operation
needs a credential the user should not hold, it is a function; if it only needs
to be limited to that user's own rows, it is RLS.**

Four rules live in `netlify/lib/` so no handler has to remember them:

- CORS is locked to the site's own origin, never `*`
- a response never carries an internal error message; `fail()` logs the detail
  and returns a sentence written for a person
- every endpoint that costs money or writes to the database is rate limited,
  counted in Postgres because a serverless process is too short-lived to count
  anything in memory
- the OAuth `state` is HMAC-signed and expires, so a callback cannot be made to
  attach one person's mailbox to another person's account

`docs/DEVIATIONS.md` §8 records what each of these was in v1, because every one
of them replaced a live vulnerability rather than a stylistic choice.

### Integrations are optional, and say so

No integration is allowed to block work. WhatsApp always offers "Open in
WhatsApp instead", which needs no setup at all; email falls back from a
personal Microsoft 365 mailbox to the shared sender; the assistant and the
invoicing address each degrade to a sentence explaining what an admin needs to
add. A preview build with no server behind it runs on `demoApi`, which refuses
every outward-facing action and says why — there is no mode where a button
looks like it worked and did nothing.

## Why the domain layer is separate

Three rules from the brief are only enforceable if calculation lives in exactly
one place:

1. **The preview and the PDF must be generated from the same components.** They
   drifted apart in v1 and it took a byte-level comparison to catch. Both read
   the same `computeDocument()` result and, from stage 3, the same document
   component tree.
2. **`taxType === "none"` zeroes tax at source.** If any screen totals a
   document by its own arithmetic, that guarantee is gone. Nothing may
   re-derive money — every total comes from `computeDocument()`.
3. **Legacy records lack modern fields.** `data/normalize.ts` is the single
   boundary where a record acquires its defaults. Downstream code may assume
   the fields exist precisely because nothing else is allowed to guess.

## Parity as a build gate

`src/domain/parity.test.ts` imports the *actual v1 implementation*, extracted
verbatim from `src/App.jsx`, and requires identical output on:

- all 131 currencies × 17 amounts, for three formatters
- 500 randomised documents through the tax engine (quantities, rates,
  discounts, four regimes, four states, round-off on and off)
- GSTIN validation across valid, malformed, incomplete and transposed inputs
- document numbering across prefixes and sequence values
- amount-in-words across scales and eight currencies

A regression fails `npm test` rather than reaching a customer. When a parity
test fails, the default assumption is that the rewrite is wrong — v1 is the
specification. Overriding that means adding an entry to `docs/DEVIATIONS.md`
with a test that pins the new behaviour.

## What must not change

- **The database schema and RLS policies.** `supabase/` is carried forward, not
  redesigned. The one edit is aligning `schema.sql` with the `with check`
  clause already live in production.
- **The Netlify Function contracts.** The deployed Azure app registration's
  OAuth redirect URI points at `/.netlify/functions/ms-oauth-callback`. That
  path is load-bearing outside this repository.
- **Tax, currency and document-numbering behaviour.** Guarded by parity tests.

## The document renderers

A document is described once and drawn twice:

```
domain/documents/model.ts    what the document SAYS  ─┬─▶ documents/pdf/     (jsPDF, millimetres)
domain/documents/columns.ts  the items table          └─▶ features/…/preview (React, CSS)
```

The brief's requirement is that the preview and the PDF share one
implementation, because they drifted apart in v1 and it took a byte-level
comparison to catch. Literal component sharing is impossible — one draws into
a PDF canvas, the other into the DOM — so the split is drawn at the only place
drift actually hurts: **every decision about content lives in the model**, and
a renderer owns nothing but geometry and drawing primitives.

That means labels, figures, row order, section order and visibility, column
selection, and money formatting are all resolved once, in
`buildDocumentModel()`. A renderer that computes any of those locally has
re-opened the bug.

`columns.ts` carries width, type size, padding, alignment and the cell getter
for every column. All of it is measured, and the three metrics only work as a
set: a narrow column at default padding wraps mid-number. The PDF renderer
consumes those values directly rather than deriving them — it did derive them
briefly, and produced `12.0 / 0` in the Disc. column, caught by rendering the
page and looking at it.

### The drift guard

`src/documents/preview/DocumentPreview.test.tsx` renders the preview with
`renderToStaticMarkup` and asserts that every value the model carries — each
header meta row, detail row, reference cell, party row, summary line, term,
registration number and strip slot — actually appears in the markup. The items
table is checked cell by cell against the same column getters the PDF calls,
and column widths against the same millimetre figures.

So a figure the PDF prints cannot quietly go missing on screen, and neither
renderer can start formatting money its own way.

### Not yet ported

v1's opt-in free-canvas layout (`canvasQuotation` / `canvasProforma`, where
each block is dragged to its own millimetre coordinates) is not implemented
here yet. It ships disabled by default in v1, so classic stacked flow is the
behaviour every live document currently uses. It needs porting before v2 can
replace v1 for anyone who has switched it on.

## Where a setting lives

One `settings` row holds everything configurable, and it is the only
definition of each thing in it. Two rules keep it that way:

- **No constant shadows a setting.** The customer form's extra fields were a
  constant in v1 *and* a settings value — two lists that could disagree. There
  is one now, and the form reads it.
- **A default belongs in `domain/`, not in a screen.** `DOMESTIC_TERMS`,
  `DEFAULT_DOC_TEMPLATE`, `DEFAULT_PARTNER_DESIGNATIONS` and the rest are
  values the domain can fall back to when the settings row has nothing, so a
  half-filled settings row can never produce an undefined label at render time.

Settings panels edit a draft and commit on Save. Nothing writes as you type.
