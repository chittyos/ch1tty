#!/usr/bin/env bash
set -euo pipefail

REGISTER_URL="${CHITTY_REGISTER_URL:-https://register.chitty.cc}"
TOKEN="${CHITTY_REGISTER_TOKEN:?CHITTY_REGISTER_TOKEN is required}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if already registered
STATUS=$(curl -sS -w "%{http_code}" -o /tmp/ch1tty-compliance.json \
  -H "Authorization: Bearer ${TOKEN}" \
  "${REGISTER_URL}/api/v1/compliance/ch1tty" 2>/dev/null || true)

if [ "$STATUS" = "200" ]; then
  echo "ch1tty is already registered:"
  cat /tmp/ch1tty-compliance.json | jq .
  exit 0
fi

echo "Registering ch1tty with ${REGISTER_URL}..."
curl -sS -X POST "${REGISTER_URL}/api/v1/register" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d @"${SCRIPT_DIR}/../register.json" | jq .
