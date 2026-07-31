#!/usr/bin/env bash
# Prepare a self-contained CPython runtime for packaging.
# Usage:
#   bash scripts/prepare-runtime.sh          # macOS (host arch)
#   bash scripts/prepare-runtime.sh win      # Windows x64 (cross from Mac)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
TARGET="${1:-darwin}"
PY_VERSION="3.12.9"
PY_TAG="20250317"
CACHE="$ROOT/.cache"
mkdir -p "$CACHE"

if [[ "$TARGET" == "win" || "$TARGET" == "windows" ]]; then
  RUNTIME="$BACKEND/runtime-win"
  PY_ARCH="x86_64-pc-windows-msvc"
  TARBALL="cpython-${PY_VERSION}+${PY_TAG}-${PY_ARCH}-install_only.tar.gz"
  PYTHON_HINT="Windows x64"
else
  RUNTIME="$BACKEND/runtime"
  HOST_ARCH="$(uname -m)"
  case "$HOST_ARCH" in
    arm64) PY_ARCH="aarch64-apple-darwin" ;;
    x86_64) PY_ARCH="x86_64-apple-darwin" ;;
    *) echo "Unsupported mac arch: $HOST_ARCH" >&2; exit 1 ;;
  esac
  TARBALL="cpython-${PY_VERSION}+${PY_TAG}-${PY_ARCH}-install_only.tar.gz"
  PYTHON_HINT="macOS ${HOST_ARCH}"
fi

URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PY_TAG}/${TARBALL}"
ARCHIVE="$CACHE/$TARBALL"

download_and_extract() {
  echo "==> Downloading portable Python ${PY_VERSION} (${PY_ARCH})"
  if [[ ! -f "$ARCHIVE" ]]; then
    curl -L --fail --retry 3 -o "$ARCHIVE" "$URL"
  fi
  rm -rf "$RUNTIME"
  mkdir -p "$RUNTIME"
  tar -xzf "$ARCHIVE" -C "$RUNTIME" --strip-components=1
}

if [[ "$TARGET" == "win" || "$TARGET" == "windows" ]]; then
  if [[ ! -f "$RUNTIME/python.exe" ]]; then
    download_and_extract
  fi

  # Cross-install pure/binary wheels for Windows into the portable tree.
  # Host Mac Python is only used as a pip driver — it does not need to run Win code.
  HOST_PIP=""
  if [[ -x "$BACKEND/runtime/bin/python3" ]]; then
    HOST_PIP="$BACKEND/runtime/bin/python3"
  elif [[ -x "$BACKEND/.venv/bin/python" ]]; then
    HOST_PIP="$BACKEND/.venv/bin/python"
  elif [[ -x "$BACKEND/.venv/Scripts/python.exe" ]]; then
    HOST_PIP="$BACKEND/.venv/Scripts/python.exe"
  elif command -v python >/dev/null 2>&1; then
    HOST_PIP="python"
  else
    HOST_PIP="python3"
  fi

  echo "==> Cross-installing requirements for ${PYTHON_HINT} via $($HOST_PIP --version)"
  SITE="$RUNTIME/Lib/site-packages"
  mkdir -p "$SITE"

  # uvicorn[standard] pulls uvloop (not on Windows) — install base uvicorn + optional win wheels.
  "$HOST_PIP" -m pip install --upgrade pip
  "$HOST_PIP" -m pip install \
    --target "$SITE" \
    --platform win_amd64 \
    --python-version 312 \
    --implementation cp \
    --abi cp312 \
    --only-binary=:all: \
    --no-compile \
    --upgrade \
    "fastapi==0.115.6" \
    "uvicorn==0.34.0" \
    "sqlalchemy==2.0.36" \
    "alembic==1.14.0" \
    "pydantic==2.10.3" \
    "pydantic-settings==2.6.1" \
    "python-jose[cryptography]==3.3.0" \
    "bcrypt==4.2.1" \
    "python-multipart==0.0.20" \
    "eval_type_backport==0.2.2" \
    "openpyxl==3.1.5" \
    "tzdata==2025.2" \
    "httptools>=0.6.3" \
    "watchfiles>=0.13" \
    "websockets>=10.4" \
    "python-dotenv>=0.21.0"

  # python-build-standalone ships python*._pth with `#import site` commented out,
  # so Lib/site-packages is ignored and uvicorn fails to import on clean PCs.
  for pth in "$RUNTIME"/python*._pth; do
    if [[ -f "$pth" ]]; then
      echo "==> Enabling site-packages in $(basename "$pth")"
      if grep -q '^#import site' "$pth"; then
        # works on both BSD/macOS and GNU sed
        sed -i.bak 's/^#import site/import site/' "$pth" && rm -f "${pth}.bak"
      elif ! grep -q '^import site' "$pth"; then
        printf '\nimport site\n' >> "$pth"
      fi
    fi
  done

  echo "==> Windows runtime ready at $RUNTIME"
  ls -la "$RUNTIME/python.exe"
else
  if [[ ! -x "$RUNTIME/bin/python3" ]]; then
    download_and_extract
  fi
  PYTHON="$RUNTIME/bin/python3"
  echo "==> Using $($PYTHON --version) for ${PYTHON_HINT}"
  echo "==> Installing backend requirements"
  "$PYTHON" -m pip install --upgrade pip
  "$PYTHON" -m pip install -r "$BACKEND/requirements.txt"
  echo "==> Runtime ready at $RUNTIME"
  "$PYTHON" -c "import fastapi, uvicorn, sqlalchemy, openpyxl; print('imports OK')"
fi

if [[ ! -f "$BACKEND/.env" ]]; then
  echo "WARNING: backend/.env missing — Supabase sync will be disabled in the package." >&2
fi
