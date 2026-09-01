#!/usr/bin/env bash
# Everything that must pass before a push, with REAL exit codes.
#
# WHY THIS EXISTS. Twice in one day a commit was pushed that could not build,
# because the check was run as `npx tsc --noEmit | head -3; echo "OK"` — the
# echo prints whether or not tsc failed, and `head` swallows the exit code.
# The Netlify build is the first thing that notices, which means the whole
# site stops deploying and nothing in the repo says why.
#
# Run: npm run verify
set -euo pipefail

echo "── typecheck and production build ───────────────────────────"
npm run build

echo "── tests ────────────────────────────────────────────────────"
npx vitest run

echo
echo "All green. Safe to push."
