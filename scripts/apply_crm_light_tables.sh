#!/usr/bin/env bash
# Apply scripts/supabase_crm_light_tables.sql to the live Supabase project.
# Requires a personal access token: https://supabase.com/dashboard/account/tokens
#
#   export SUPABASE_ACCESS_TOKEN=sbp_...
#   ./scripts/apply_crm_light_tables.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL_FILE="$ROOT/scripts/supabase_crm_light_tables.sql"
PROJECT_REF="${SUPABASE_PROJECT_REF:-gkizggztofkfaeattpih}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Set SUPABASE_ACCESS_TOKEN (Supabase Account → Access Tokens)." >&2
  exit 1
fi

export SQL_FILE PROJECT_REF
python3 <<'PY'
import json, os, pathlib, urllib.request, urllib.error, sys

sql = pathlib.Path(os.environ["SQL_FILE"]).read_text()
ref = os.environ["PROJECT_REF"]
token = os.environ["SUPABASE_ACCESS_TOKEN"]
req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{ref}/database/query",
    data=json.dumps({"query": sql}).encode(),
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read().decode()
        print(body or f"OK ({resp.status})")
except urllib.error.HTTPError as e:
    sys.stderr.write(e.read().decode() + "\n")
    raise SystemExit(e.code)
PY

echo "Verifying tables via REST..."
KEY="$(grep '^SUPABASE_KEY=' "$ROOT/backend/.env" | cut -d= -f2-)"
URL="$(grep '^SUPABASE_URL=' "$ROOT/backend/.env" | cut -d= -f2-)"
for t in crm_banquets crm_takeaway_orders crm_clients crm_rooms crm_stays crm_guest_services; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    "$URL/rest/v1/$t?select=id&limit=1")
  echo "$t -> $code"
done
