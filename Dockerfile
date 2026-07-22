# AirVPN — Telegram bot (Coolify / Docker)
FROM python:3.11-slim-bookworm

WORKDIR /app

# OpenCV (receipt QR) runtime deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /data \
    && chmod +x /app/entrypoint.sh \
    && chown -R appuser:appuser /app /data

USER appuser

EXPOSE 8080

ENV ENV=production \
    DEV_MOCK_VPN=false \
    SQLITE_PATH=/data/airvpn.sqlite3 \
    KBZ_SESSION_PATH=/data/kbz/kbz_session.json \
    SUB_SERVER_PORT=8080 \
    MOBILE_API_PORT=8080 \
    MOBILE_API_PUBLIC_BASE=https://airvpn.flash-myanmar.com

# Mount:
#   - private volume at /data for SQLite (airvpn.sqlite3)
#   - shared host path /data/kbz → /data/kbz for merchant kbz_session.json
#     (same file as Cloud Game Shop + Donimate Payment Manager)
# Expose port 8080 for mobile API (/v1/*, /admin/login) + subscription (/sub/...).
# Set SUB_PUBLIC_BASE_URL for subscription links.
CMD ["/app/entrypoint.sh"]
