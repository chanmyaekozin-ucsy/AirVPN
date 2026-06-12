"""Per-user VPN subscription links for client apps (v2rayNG, Hiddify, etc.)."""
from __future__ import annotations

import base64
import logging
from datetime import datetime, timezone

import config
import database as db
from services.usage_sync import sync_subscriptions_usage

logger = logging.getLogger(__name__)


def subscription_limit_gb(sub: dict) -> float:
    bonus_gb = sub.get("bonus_data_mb", 0) / 1024
    return sub["data_limit_gb"] + bonus_gb


def build_subscription_url(sub_token: str) -> str | None:
    if not config.SUB_PUBLIC_BASE_URL or not sub_token:
        return None
    return f"{config.SUB_PUBLIC_BASE_URL}/sub/{sub_token}"


def user_subscription_url(user: dict) -> str | None:
    return build_subscription_url(user.get("sub_token") or "")


async def fetch_user_subscription_payload(
    sub_token: str,
) -> tuple[str, dict[str, str]] | None:
    """
    Build base64 subscription body and response headers.
    Returns None when token is invalid or user has no active keys.
    """
    user = await db.get_user_by_sub_token(sub_token)
    if not user:
        return None

    subs = await db.get_all_active_subscriptions(user["id"])
    if not subs:
        return None

    try:
        subs = await sync_subscriptions_usage(subs)
    except Exception:
        logger.exception("Subscription usage sync failed for user %s", user["id"])

    lines = [s["vless_key"] for s in subs if s.get("vless_key")]
    if not lines:
        return None

    body = base64.b64encode("\n".join(lines).encode()).decode()
    headers = _subscription_headers(subs)
    return body, headers


def _subscription_headers(subs: list[dict]) -> dict[str, str]:
    used_bytes = 0
    total_bytes = 0
    expire_unix = 0

    for sub in subs:
        used_bytes += int(sub.get("data_used_gb", 0) * 1024**3)
        total_bytes += int(subscription_limit_gb(sub) * 1024**3)
        try:
            exp = datetime.fromisoformat(sub["expires_at"])
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=db.MMT)
            ts = int(exp.timestamp())
            expire_unix = max(expire_unix, ts)
        except (TypeError, ValueError):
            pass

    userinfo = (
        f"upload=0; download={used_bytes}; total={total_bytes}; expire={expire_unix}"
    )
    return {
        "Content-Type": "text/plain; charset=utf-8",
        "subscription-userinfo": userinfo,
        "Profile-Update-Interval": "12",
        "Profile-Title": "AirVPN",
    }
