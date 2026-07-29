#!/usr/bin/env bash
# Загружает nvm (если есть) и запускает команду из папки CRM
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
elif [ -d "/opt/homebrew/bin" ]; then
  export PATH="/opt/homebrew/bin:$PATH"
elif [ -d "/usr/local/bin" ]; then
  export PATH="/usr/local/bin:$PATH"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Ошибка: npm не найден."
  echo "Установите Node.js: https://nodejs.org или выполните: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  exit 1
fi

exec "$@"
