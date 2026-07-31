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

# Exact artifact name from latest.yml (what electron-updater will download).
SETUP_NAME=$(awk '/^path:/{print $2; exit}' "$REL/latest.yml" | tr -d "'\"")
if [[ -z "$SETUP_NAME" ]]; then
  echo "Could not read path from latest.yml"
  exit 1
fi

SETUP="$REL/$SETUP_NAME"
BLOCKMAP="$REL/${SETUP_NAME}.blockmap"

# electron-builder may emit spaced names; rename to match latest.yml.
if [[ ! -f "$SETUP" ]]; then
  VERSION="${SETUP_NAME##*-}"
  VERSION="${VERSION%.exe}"
  CANDIDATE=$(find "$REL" -maxdepth 1 -type f -name "*Setup*${VERSION}.exe" ! -name '*.blockmap' | head -1 || true)
  if [[ -n "$CANDIDATE" ]]; then
    echo "Renaming $(basename "$CANDIDATE") -> $SETUP_NAME"
    mv "$CANDIDATE" "$SETUP"
    if [[ -f "${CANDIDATE}.blockmap" ]]; then
      mv "${CANDIDATE}.blockmap" "$BLOCKMAP"
    fi
  fi
fi

if [[ ! -f "$SETUP" ]]; then
  echo "Missing setup file: $SETUP"
  exit 1
fi

FILES=("$REL/latest.yml" "$SETUP")
if [[ -f "$BLOCKMAP" ]]; then
  FILES+=("$BLOCKMAP")
else
  echo "Warning: missing blockmap $BLOCKMAP"
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
