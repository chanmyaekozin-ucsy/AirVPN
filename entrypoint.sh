#!/bin/sh
set -e

if [ -n "$SUB_PUBLIC_BASE_URL" ]; then
  echo "Starting subscription server on port ${SUB_SERVER_PORT:-8080}..."
  python -m uvicorn sub_server:app \
    --host "${SUB_SERVER_HOST:-0.0.0.0}" \
    --port "${SUB_SERVER_PORT:-8080}" \
    --log-level info &
fi

exec python bot.py
