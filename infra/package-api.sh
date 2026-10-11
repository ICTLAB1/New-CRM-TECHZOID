#!/usr/bin/env bash
#
# Build the Function App package: api/ plus the server functions that came
# across from Netlify, laid out so their "../../api/lib" imports resolve.
# Writes the zip to the path given (default: api.zip in the repo root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/api.zip}"
PKG="$(mktemp -d)"
( cd "$ROOT/api" && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null )
cp -RL "$ROOT/api/." "$PKG/"
rm -rf "$PKG/netlify"
cp -R "$ROOT/netlify" "$PKG/netlify"
mkdir -p "$PKG/api" && cp -R "$ROOT/api/lib" "$PKG/api/lib"
find "$PKG" -name "*.test.mjs" -delete
rm -f "$OUT"
( cd "$PKG" && zip -qr "$OUT" . )
rm -rf "$PKG"
echo "packaged $OUT"
