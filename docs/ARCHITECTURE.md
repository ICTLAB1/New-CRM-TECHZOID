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
```

The direction of dependency is strictly one-way:

```
features/ ─▶ domain/
         └─▶ data/ ─▶ domain/
components/ (depends on nothing but React)
```

`domain/` importing from `features/` or `data/` is the thing to watch for in
review — it is what turned v1 into a 12,000-line file.

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

### Not yet ported

v1's opt-in free-canvas layout (`canvasQuotation` / `canvasProforma`, where
each block is dragged to its own millimetre coordinates) is not implemented
here yet. It ships disabled by default in v1, so classic stacked flow is the
behaviour every live document currently uses. It needs porting before v2 can
replace v1 for anyone who has switched it on.
