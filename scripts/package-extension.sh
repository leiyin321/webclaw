#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./scripts/check-syntax.sh
node scripts/validate-release.mjs
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')).version")"
OUTPUT="${1:-dist/webclaw-${VERSION}.zip}"
OUTPUT_DIR="$(dirname "$OUTPUT")"
OUTPUT_NAME="$(basename "$OUTPUT")"

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT"
zip -q -r "$OUTPUT" \
  manifest.json \
  src \
  assets/icons/icon-16.png \
  assets/icons/icon-32.png \
  assets/icons/icon-48.png \
  assets/icons/icon-128.png \
  LICENSE \
  PRIVACY.md \
  SECURITY.md \
  -x "*.DS_Store" "*/.DS_Store" "*.map"

if command -v shasum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && shasum -a 256 "$OUTPUT_NAME" > "${OUTPUT_NAME}.sha256")
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum "$OUTPUT_NAME" > "${OUTPUT_NAME}.sha256")
fi

echo "Created $OUTPUT"
