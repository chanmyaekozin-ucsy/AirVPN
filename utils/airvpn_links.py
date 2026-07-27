"""AirVPN app download + deep-link helpers for Telegram (http/https buttons only)."""
from __future__ import annotations

from urllib.parse import quote

import config
import database as db

# Telegram inline URL buttons max length
_TELEGRAM_URL_MAX = 2000

DEFAULT_APP_DOWNLOAD_URL = "https://t.me/worldcup2026_myanmarLive/1222"


def import_bridge_url(payload: str) -> str | None:
    """
    HTTPS page that opens airvpn://import?url=… (Telegram cannot use custom schemes).
    Returns None when the resulting URL would exceed Telegram's button limit.
    """
    raw = (payload or "").strip()
    if not raw:
        return None
    base = (config.MOBILE_API_PUBLIC_BASE or "").rstrip("/")
    if not base:
        return None
    url = f"{base}/app/import?url={quote(raw, safe='')}"
    if len(url) > _TELEGRAM_URL_MAX:
        return None
    return url


async def resolve_app_download_url() -> str:
    """
    APK / app post link: Admin App Config (update_url) → env → default Telegram post.
    """
    try:
        settings = await db.get_mobile_app_settings()
        for key in ("update_url", "play_url"):
            val = str(settings.get(key) or "").strip()
            if val.startswith("http://") or val.startswith("https://"):
                return val
    except Exception:
        pass
    return (
        config.AIRVPN_UPDATE_URL
        or config.AIRVPN_PLAY_URL
        or DEFAULT_APP_DOWNLOAD_URL
    )
