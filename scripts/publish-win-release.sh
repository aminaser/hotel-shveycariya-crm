#!/usr/bin/env bash
# Upload Windows installer + electron-updater metadata to a GitHub Release.
# Usage:
#   npm run electron:build:win
#   bash scripts/publish-win-release.sh v0.1.1
set -euo pipefail

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "Usage: $0 <tag>   e.g. v0.1.1"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REL="$ROOT/release"

if [[ ! -f "$REL/latest.yml" ]]; then
  echo "Missing $REL/latest.yml — run npm run electron:build:win first"
  exit 1
fi

# Prefer Setup exe; names come from electron-builder (see latest.yml)
SETUP=$(ls "$REL"/*Setup*.exe "$REL"/*setup*.exe 2>/dev/null | head -1 || true)
BLOCKMAP=$(ls "$REL"/*.exe.blockmap 2>/dev/null | head -1 || true)

if [[ -z "$SETUP" ]]; then
  echo "No Setup .exe found in $REL"
  exit 1
fi

FILES=("$REL/latest.yml" "$SETUP")
if [[ -n "$BLOCKMAP" ]]; then
  FILES+=("$BLOCKMAP")
fi

echo "Creating/updating release $TAG with:"
printf '  %s\n' "${FILES[@]}"

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "${FILES[@]}" --clobber
else
  gh release create "$TAG" "${FILES[@]}" \
    --title "Windows $TAG" \
    --notes "Установщик CRM. Для автообновления нужны latest.yml + Setup.exe (+ .blockmap)."
fi

echo "Done: https://github.com/aminaser/hotel-shveycariya-crm/releases/tag/$TAG"
