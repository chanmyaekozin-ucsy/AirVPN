"""Move a paid subscription to another VPN server with quota + expiry preserved."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import config
import database as db
from services.subscription import subscription_limit_gb
from services.usage_sync import sync_subscriptions_usage
from vps.panel_client import PanelClient, PanelError, provision_migrated_vless
from vpn_servers import get_server

logger = logging.getLogger(__name__)

MIN_REMAINING_BYTES = 1024 * 1024  # 1 MB


async def delete_panel_client(sub: dict) -> bool:
    email = sub.get("panel_email")
    client_uuid = sub.get("vless_uuid")
    if not email or not client_uuid:
        return True
    if config.DEV_MOCK_VPN:
        return True

    server = get_server(sub.get("server_id"))
    if not server or not server.panel_url:
        return False

    client = PanelClient(server)
    try:
        return await client.delete_client(email, client_uuid)
    except PanelError:
        logger.exception(
            "Failed to delete panel client %s on %s", email, server.id
        )
        return False
    finally:
        await client.close()


async def compute_remaining_quota(sub: dict) -> tuple[float, str] | None:
    """Return (remaining_gb, expires_at) or None if expired / no data left."""
    synced = await sync_subscriptions_usage([sub])
    sub = synced[0]
    limit_gb = subscription_limit_gb(sub)
    used_gb = float(sub.get("data_used_gb") or 0)
    remaining_gb = limit_gb - used_gb
    if remaining_gb * (1024**3) < MIN_REMAINING_BYTES:
        return None

    expires_at = sub.get("expires_at") or ""
    try:
        exp = datetime.fromisoformat(expires_at)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=db.MMT)
        if exp <= db.mmt_now():
            return None
    except (TypeError, ValueError):
        return None

    return round(remaining_gb, 4), expires_at


def _expiry_ms(expires_at: str) -> int:
    exp = datetime.fromisoformat(expires_at)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=db.MMT)
    return int(exp.astimezone(timezone.utc).timestamp() * 1000)


async def replace_subscription_server(
    sub: dict,
    telegram_id: int,
    target_server_id: str,
    feedback: str,
) -> tuple[bool, str, dict | None]:
    """
    Provision on target server, delete old panel client, update DB.
    Returns (ok, message_key_or_error, updated_sub_dict).
    """
    from_server = (sub.get("server_id") or "sg").strip().lower()
    target_server_id = target_server_id.strip().lower()
    if from_server == target_server_id:
        return False, "replace_same_server", None

    target = get_server(target_server_id)
    if not target or not target.is_configured():
        return False, "replace_server_unavailable", None

    quota = await compute_remaining_quota(sub)
    if not quota:
        return False, "replace_no_quota", None

    remaining_gb, expires_at = quota
    total_bytes = max(MIN_REMAINING_BYTES, int(remaining_gb * 1024**3))
    expiry_ms = _expiry_ms(expires_at)

    try:
        uid, email, vless_key = await provision_migrated_vless(
            telegram_id,
            total_bytes,
            expiry_ms,
            target_server_id,
        )
    except PanelError as exc:
        logger.exception(
            "Key replace provision failed sub=%s -> %s",
            sub.get("id"),
            target_server_id,
        )
        return False, str(exc), None

    deleted = await delete_panel_client(sub)
    if not deleted:
        logger.warning(
            "Old panel client not deleted sub=%s server=%s",
            sub.get("id"),
            from_server,
        )

    await db.update_subscription_after_server_change(
        sub["id"],
        server_id=target_server_id,
        vless_uuid=uid,
        vless_key=vless_key,
        panel_email=email,
        data_limit_gb=remaining_gb,
        expires_at=expires_at,
    )
    await db.log_key_replacement(
        sub["user_id"],
        sub["id"],
        from_server=from_server,
        to_server=target_server_id,
        feedback=feedback,
        remaining_gb=remaining_gb,
        expires_at=expires_at,
    )

    updated = await db.get_subscription_by_id(sub["id"])
    return True, "replace_ok", updated


async def notify_replacement(
    bot,
    *,
    telegram_id: int,
    username: str | None,
    sub_id: int,
    from_server: str,
    to_server: str,
    feedback: str,
    remaining_gb: float,
) -> None:
    if not config.PAYMENTS_PROOFS_GROUP_ID:
        return
    user_line = f"@{username}" if username else "—"
    text = (
        f"Key replacement #{sub_id}\n"
        f"User: {telegram_id} ({user_line})\n"
        f"Server: {from_server} → {to_server}\n"
        f"Remaining: {remaining_gb:.2f} GB\n"
        f"Feedback: {feedback}"
    )
    try:
        await bot.send_message(config.PAYMENTS_PROOFS_GROUP_ID, text)
    except Exception:
        logger.exception("Failed to notify group about key replacement")
