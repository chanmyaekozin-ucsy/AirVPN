#!/bin/sh
set -e

# Public HTTP port (Coolify / Docker maps this). Must be api.app — not sub_server alone —
# so /v1/*, /admin/login, and /sub/* all work on airvpn.flash-myanmar.com.
HTTP_PORT="${MOBILE_API_PORT:-${SUB_SERVER_PORT:-8080}}"
HTTP_HOST="${MOBILE_API_HOST:-${SUB_SERVER_HOST:-0.0.0.0}}"

echo "Starting AirVPN mobile API on ${HTTP_HOST}:${HTTP_PORT}..."
python -m uvicorn api.app:app \
  --host "$HTTP_HOST" \
  --port "$HTTP_PORT" \
  --log-level info &

exec python bot.py
