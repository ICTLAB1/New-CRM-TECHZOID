# TechZoid CRM — v2

A rewrite of the v1 CRM (a single 12,208-line `src/App.jsx`) into a modular,
strictly-typed codebase. **Functionality is unchanged.** v1 is the
specification; where this code and v1 disagree, v1 is presumed right until
proven otherwise, and every deliberate difference is listed in
[`docs/DEVIATIONS.md`](docs/DEVIATIONS.md).

Stack is unchanged: React + Vite, Supabase (Postgres, Auth, RLS — no custom
auth), Netlify Functions (`.mjs`), jsPDF + jspdf-autotable, SheetJS.

## Status

This is being built in the ten stages the rebuild brief lays out, each verified
before the next.

| # | Stage | State |
|---|-------|-------|
| 1 | Project structure, TypeScript, database layer, auth, RLS | data layer + schema done; auth UI pending |
| 2 | Domain logic — tax, currency, numbering — with tests | **done, parity-verified against v1** |
| 3 | PDF generation, verified by rendering images | **done, compared against v1's own renderer** |
| 4 | Design system and shell | **done** |
| 5 | Customers and pipeline | not started |
| 6 | Quotations and proformas with live preview | not started |
| 7 | Orders, dispatch, subscriptions, renewals | not started |
| 8 | Dashboard and reports | not started |
| 9 | Integrations — email, Microsoft OAuth, WhatsApp, AI | not started |
| 10 | Settings, team management, catalog | not started |

Nothing here is deployed. The live site at `crm.ttpldelhi.com` still runs v1.

## Running it

```bash
npm install
cp .env.example .env      # fill in from Supabase -> Project Settings -> API
npm run dev
npm test                  # domain + parity suite
npm run typecheck         # strict, zero errors
```

## Layout

```
src/
  domain/          pure business logic — no React, no I/O, fully tested
    tax/           the single source of truth for document totals
    currency/      131 ISO 4217 currencies, screen and PDF formatting
    gstin/         15-character checksum validation
    numbering/     document numbers, Indian financial year
    words/         amount in words (Indian and western scales)
    catalog/       Excel/CSV price-list parsing
    payments/      payment ledger derivation
    geo/           states (with GST codes), countries
    documents/     the shared document model — what a document SAYS
  documents/pdf/   the jsPDF renderer — geometry only
  data/            Supabase client, entity sync, legacy normalisation
  components/      shared component library
  styles/          design tokens and component styles
  app/             application shell and navigation
  features/        feature folders                     (stages 5-10)
supabase/          schema and RLS — carried forward, not redesigned
netlify/functions/ backend; contracts must not change
scripts/           v1 reference extraction for parity tests
```

## The rules this codebase is built around

Each was a production bug in v1. They are enforced by tests, not by memory.

- `taxType === "none"` zeroes tax **per row, at source** — not by hiding a
  column downstream.
- The on-screen preview and the PDF must be generated from the **same**
  components. They drifted apart once and it took a byte-level comparison to
  catch.
- Items-table column widths total exactly 180mm, measured against worst-case
  content. Money columns carry a bare number — the header names the currency.
  Adding a prefix back wraps large figures mid-number.
- jsPDF corrupts anything outside Latin-1. Unsafe currency **codes** (not
  symbols — PKR and MUR share ₨) fall back to `Rs. ` or `CODE `.
- Catalog import saves immediately, matches columns generously, never drops a
  sheet silently, and keeps priceless products **active**.
- Merging a catalog import replaces only that vendor's products.
- Every screen survives records with no `currency`, `taxType`, `billCountry`,
  `paymentHistory` or `lostReason`. Normalise on load.
- Microsoft tokens live in `ms_mail_accounts`, never on `profiles` — that
  table is readable by every authenticated user.
- The `profiles` update policy needs its `with check` clause, or any user can
  make themselves Admin.
- `ai-proxy` requires a signed-in user; it calls a paid API.

## Parity testing

`npm test` runs the rewrite and the **actual v1 implementation** over the same
inputs and requires identical output — including 500 randomised documents
through the tax engine, and every one of the 131 currencies at 17 amounts.

The reference is extracted verbatim from v1, never retyped:

```bash
scripts/extract-v1-reference.sh /path/to/v1/src/App.jsx
```

## Verifying the interface

Same discipline as the PDF — build it and look at it:

```bash
npm run build && node scripts/shoot.mjs   # desktop, phone, bottom sheet
```

The agreed direction and the rules that hold it together are in
[`docs/DESIGN.md`](docs/DESIGN.md), enforced by `src/styles/design-rules.test.ts`.

## Verifying the PDF

Never by measuring coordinates — that gave false results repeatedly in v1,
both false failures and missed real problems. Render it and look at it:

```bash
npx tsx scripts/render-sample.ts          # writes tmp/*.pdf
pdftoppm -png -r 110 tmp/quotation.pdf tmp/quotation
node scripts/compare-v1-pdf.mjs           # same doc through v1's own renderer
```

`compare-v1-pdf.mjs` renders the identical document through the extracted v1
generator, diffs the extracted text, and pixel-diffs the rasterised page. A
concentrated block of differing pixels in one row band is a real difference;
scattered single pixels are anti-aliasing. Then **look at both images** — the
numbers are a filter, not the verdict.

This caught a live regression: the Disc. and Tax % columns were rendering
`12.0 / 0` and `18 / %`, wrapped mid-value, because their cell padding had
been derived from a style bucket instead of carried as a measured value.
