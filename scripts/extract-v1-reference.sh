#!/usr/bin/env bash
# Regenerate scripts/v1-reference.mjs from the frozen v1 source.
#
# The parity tests compare this rewrite against the ACTUAL v1 implementation,
# so the reference must be copied verbatim rather than retyped. Point SRC at
# the v1 src/App.jsx and re-run.
set -euo pipefail
SRC="${1:-../crm-source/src/App.jsx}"
OUT="$(dirname "$0")/v1-reference.mjs"

START=$(grep -n '^const STATES = \[' "$SRC" | cut -d: -f1)
END=$(( $(grep -n '^const CSS = ' "$SRC" | cut -d: -f1) - 1 ))

{
  echo "/* AUTO-EXTRACTED from the v1 src/App.jsx, lines ${START}-${END}, verbatim."
  echo "   Reference implementation used only by the parity tests to prove the"
  echo "   TypeScript rewrite produces identical output. Do not edit by hand;"
  echo "   regenerate with scripts/extract-v1-reference.sh. */"
  sed -n "${START},${END}p" "$SRC"
  echo ""
  echo "export { STATES, COUNTRIES, CURRENCIES, getCurrency, fmtCurrency, fmtCurrencyPdf, fmtMoneyCellPdf, validateGSTIN, taxTypeLabel, amountInWords, amountInWordsWestern, amountInWordsForCurrency, buildDocNumber, computeQuote, round2, inr, inrShort, PDF_UNSAFE_CURRENCY_CODES };"
} > "$OUT"

echo "wrote $OUT (lines ${START}-${END})"
