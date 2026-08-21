#!/bin/sh
set -e

# Ensure persistent data directories exist
mkdir -p /app/data /app/data/uploads 2>/dev/null || true

# If running as root (initial container boot), adjust mounted volume permissions and drop privileges to node
if [ "$(id -u)" = "0" ]; then
    chown -R node:node /app/data 2>/dev/null || true
    chmod -R 775 /app/data 2>/dev/null || true
    exec su-exec node "$@"
else
    exec "$@"
fi
