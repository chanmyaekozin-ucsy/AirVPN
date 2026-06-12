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
    && chown -R appuser:appuser /app /data

USER appuser

ENV ENV=production \
    DEV_MOCK_VPN=false \
    SQLITE_PATH=/data/airvpn.sqlite3 \
    KBZ_SESSION_PATH=/data/kbz_session.json

# Mount a persistent volume at /data in Coolify (SQLite + KBZ session).
CMD ["python", "bot.py"]
