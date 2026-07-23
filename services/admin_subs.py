"""Admin power tools: adjust / replace / manually create subscriptions."""
from __future__ import annotations

import logging
import math
import re
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import unquote

import database as db
from services.key_replacement import delete_panel_client
from services.subscription import build_subscription_url, subscription_limit_gb
from services.usage_sync import sync_subscriptions_usage
from vps.panel_client import PanelClient, PanelError, provision_migrated_vless, provision_vless
from vpn_servers import get_server

logger = logging.getLogger(__name__)

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _parse_expires(value: str) -> datetime:
    exp = datetime.fromisoformat(value)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=db.MMT)
    return exp


def _normalize_share_uri(raw: str) -> str:
    uri = (raw or "").strip()
    # Allow accidental wrapping / multi-line paste — take first share line
    for line in uri.splitlines():
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        low = t.lower()
        if low.startswith("vless://") or low.startswith("ss://"):
            return t
        for part in re.split(r"\s+", t):
            pl = part.lower()
            if pl.startswith("vless://") or pl.startswith("ss://"):
                return part
    raise ValueError("Paste a vless:// or ss:// share key")


def _uuid_from_share_uri(uri: str) -> str:
    low = uri.lower()
    if low.startswith("vless://"):
        # vless://uuid@host:port?...#name
        rest = uri[8:]
        at = rest.find("@")
        candidate = unquote(rest[:at] if at > 0 else rest.split("?", 1)[0].split("#", 1)[0])
        if _UUID_RE.match(candidate):
            return candidate
        raise ValueError("vless:// share key is missing a valid UUID")
    if low.startswith("ss://"):
        # No stable UUID — keep a deterministic placeholder so DB NOT NULL holds
        return str(uuid_lib.uuid5(uuid_lib.NAMESPACE_URL, uri.strip()))
    raise ValueError("Unsupported share key")


def _serialize_sub(row: dict[str, Any]) -> dict[str, Any]:
    limit = subscription_limit_gb(row)
    used = float(row.get("data_used_gb") or 0)
    left = max(0.0, limit - used)
    expires_at = row.get("expires_at")
    days_left = None
    if expires_at:
        try:
            delta = _parse_expires(str(expires_at)) - db.mmt_now()
            days_left = int(delta.total_seconds() // 86400)
        except (TypeError, ValueError):
            days_left = None
    sub_url = build_subscription_url(row.get("sub_token") or "")
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "telegram_id": row.get("telegram_id"),
        "username": row.get("username"),
        "first_name": row.get("first_name"),
        "plan_id": row.get("plan_id"),
        "plan_title": row.get("plan_title"),
        "server_id": row.get("server_id") or "sg",
        "is_free": bool(row.get("is_free")),
        "is_active": bool(row.get("is_active")),
        "payment_id": row.get("payment_id"),
        "data_limit_gb": round(float(row.get("data_limit_gb") or 0), 3),
        "bonus_data_mb": int(row.get("bonus_data_mb") or 0),
        "data_used_gb": round(used, 3),
        "data_left_gb": round(left, 3),
        "expires_at": expires_at,
        "days_left": days_left,
        "vless_key": row.get("vless_key"),
        "panel_email": row.get("panel_email"),
        "subscription_url": sub_url,
        "created_at": row.get("created_at"),
    }


async def list_user_subscriptions(telegram_id: int) -> list[dict[str, Any]]:
    rows = await db.list_subscriptions_for_telegram(telegram_id)
    if rows:
        try:
            synced = await sync_subscriptions_usage(rows)
            # re-attach user fields lost by sync if any
            by_id = {r["id"]: r for r in rows}
            for s in synced:
                base = by_id.get(s["id"], {})
                for k in ("telegram_id", "username", "first_name", "sub_token", "plan_title"):
                    if k not in s or s.get(k) is None:
                        s[k] = base.get(k)
            rows = synced
        except Exception:
            logger.exception("usage sync failed for tg=%s", telegram_id)
    return [_serialize_sub(r) for r in rows]


async def _push_panel_limits(sub: dict[str, Any], *, total_gb: float, expires_at: str) -> None:
    """Best-effort update of 3x-ui client quota + expiry."""
    email = (sub.get("panel_email") or "").strip()
    if not email:
        return
    server = get_server(sub.get("server_id") or "sg")
    if not server or not server.panel_url:
        return
    try:
        exp = _parse_expires(expires_at)
        days = max(1, int(math.ceil((exp - db.mmt_now()).total_seconds() / 86400)))
        total_bytes = max(1024 * 1024, int(total_gb * (1024**3)))
        client = PanelClient(server)
        try:
            await client.add_or_update_client(
                email=email,
                telegram_id=int(sub.get("telegram_id") or 0),
                total_bytes=total_bytes,
                expiry_days=days,
                remark=f"AirVPN-{sub.get('telegram_id')}",
            )
        finally:
            await client.close()
    except PanelError:
        logger.exception("panel adjust failed sub=%s", sub.get("id"))
        raise
    except Exception:
        logger.exception("panel adjust unexpected sub=%s", sub.get("id"))
        raise


async def adjust_subscription(
    sub_id: int,
    *,
    days_delta: int = 0,
    data_gb_delta: float = 0.0,
    set_data_gb: float | None = None,
    set_days_left: int | None = None,
) -> dict[str, Any]:
    if (
        days_delta == 0
        and abs(data_gb_delta) < 1e-9
        and set_data_gb is None
        and set_days_left is None
    ):
        raise ValueError("Nothing to adjust")

    sub = await db.get_subscription_by_id(sub_id)
    if not sub:
        raise LookupError("Subscription not found")

    # Sync usage first so leftover math is accurate
    try:
        synced = await sync_subscriptions_usage([sub])
        sub = {**sub, **synced[0]}
    except Exception:
        logger.exception("usage sync before adjust failed sub=%s", sub_id)

    expires_at = str(sub.get("expires_at") or db.mmt_now().isoformat())
    exp = _parse_expires(expires_at)
    if set_days_left is not None:
        # Absolute: expire after N full days from now (0 → expire now)
        exp = db.mmt_now() + timedelta(days=int(set_days_left))
    elif days_delta:
        exp = exp + timedelta(days=int(days_delta))
    # Keep at least 1 hour ahead of now if still active intent
    if exp <= db.mmt_now() and (
        (set_days_left is not None and set_days_left > 0)
        or (set_days_left is None and days_delta >= 0)
    ):
        exp = db.mmt_now() + timedelta(hours=1)
    new_expires = exp.isoformat()

    limit = float(sub.get("data_limit_gb") or 0)
    bonus_mb = int(sub.get("bonus_data_mb") or 0)
    if set_data_gb is not None:
        # Absolute total quota → store in data_limit_gb, clear bonus
        limit = max(0.001, float(set_data_gb))
        bonus_mb = 0
    elif data_gb_delta:
        # Prefer adjusting bonus for small tweaks; large adds go to limit
        if abs(data_gb_delta) < 5 and data_gb_delta != int(data_gb_delta):
            bonus_mb = max(0, bonus_mb + int(round(data_gb_delta * 1024)))
        else:
            limit = max(0.001, limit + float(data_gb_delta))

    updated = await db.update_subscription_quota(
        sub_id,
        data_limit_gb=limit,
        bonus_data_mb=bonus_mb,
        expires_at=new_expires,
        is_active=(
            exp > db.mmt_now()
            if (set_days_left is not None or days_delta)
            else (True if exp > db.mmt_now() else bool(sub.get("is_active")))
        ),
    )
    if not updated:
        raise RuntimeError("Update failed")

    total_gb = subscription_limit_gb(updated)
    try:
        await _push_panel_limits(updated, total_gb=total_gb, expires_at=new_expires)
    except PanelError as exc:
        # DB already updated; report soft failure
        logger.warning("DB adjusted but panel sync failed: %s", exc)

    return _serialize_sub(updated)


async def replace_subscription_key(
    sub_id: int,
    *,
    share_uri: str | None = None,
) -> dict[str, Any]:
    """
    Replace the share key on a subscription.
    - share_uri set → paste external/manual vless:// or ss:// (no panel provision)
    - share_uri empty → provision a fresh VLESS on the same server (paid only)
    Keeps remaining GB + expiry.
    """
    sub = await db.get_subscription_by_id(sub_id)
    if not sub:
        raise LookupError("Subscription not found")

    pasted = (share_uri or "").strip()
    if pasted:
        return await _replace_with_pasted_share(sub, pasted)

    if sub.get("is_free"):
        raise ValueError("Paste a share key for free subs, or use daily gift flow")

    try:
        synced = await sync_subscriptions_usage([sub])
        sub = {**sub, **synced[0]}
    except Exception:
        logger.exception("usage sync before replace failed sub=%s", sub_id)

    limit = subscription_limit_gb(sub)
    used = float(sub.get("data_used_gb") or 0)
    remaining = max(0.001, limit - used)
    expires_at = str(sub.get("expires_at") or "")
    exp = _parse_expires(expires_at)
    if exp <= db.mmt_now():
        raise ValueError("Subscription already expired")

    telegram_id = int(sub["telegram_id"])
    server_id = (sub.get("server_id") or "sg").strip()
    expiry_ms = int(exp.astimezone(timezone.utc).timestamp() * 1000)
    total_bytes = max(1024 * 1024, int(remaining * (1024**3)))

    await delete_panel_client(sub)

    try:
        uid, email, vless_key = await provision_migrated_vless(
            telegram_id,
            total_bytes,
            expiry_ms,
            server_id,
        )
    except PanelError as exc:
        raise RuntimeError(f"Panel provisioning failed: {exc}") from exc

    updated = await db.update_subscription_quota(
        sub_id,
        data_limit_gb=remaining,
        bonus_data_mb=0,
        expires_at=expires_at,
        vless_uuid=uid,
        vless_key=vless_key,
        panel_email=email,
        is_active=True,
    )
    await db.update_subscription_usage(sub_id, 0.0)
    updated = await db.get_subscription_by_id(sub_id)
    if not updated:
        raise RuntimeError("Replace succeeded but reload failed")
    return _serialize_sub(updated)


async def _replace_with_pasted_share(sub: dict[str, Any], raw: str) -> dict[str, Any]:
    """Store a pasted share key; remove old panel client if any."""
    uri = _normalize_share_uri(raw)
    uid = _uuid_from_share_uri(uri)
    sub_id = int(sub["id"])

    await delete_panel_client(sub)

    updated = await db.update_subscription_quota(
        sub_id,
        vless_uuid=uid,
        vless_key=uri,
        panel_email="",
        is_active=True,
    )
    if not updated:
        raise RuntimeError("Replace with pasted key failed")
    return _serialize_sub(updated)


async def remove_subscription_key(sub_id: int) -> dict[str, Any]:
    """
    Deactivate a subscription and delete its panel client.
    The share key disappears from the user's /sub/{token} link.
    """
    sub = await db.get_subscription_by_id(sub_id)
    if not sub:
        raise LookupError("Subscription not found")
    if not sub.get("is_active") and not (sub.get("vless_key") or "").strip():
        raise ValueError("Key already removed")

    await delete_panel_client(sub)

    updated = await db.update_subscription_quota(
        sub_id,
        is_active=False,
        vless_key="",
        panel_email="",
    )
    if not updated:
        raise RuntimeError("Remove failed")
    return _serialize_sub(updated)


async def create_manual_subscription(
    *,
    telegram_id: int,
    server_id: str,
    data_gb: float,
    days: int,
    plan_id: int | None = None,
    notify: bool = False,
    bot: Any | None = None,
) -> dict[str, Any]:
    if telegram_id <= 0:
        raise ValueError("telegram_id required")
    if data_gb <= 0:
        raise ValueError("data_gb must be > 0")
    if days <= 0:
        raise ValueError("days must be > 0")

    server_id = (server_id or "sg").strip().lower()
    if not get_server(server_id):
        raise ValueError(f"Unknown server_id: {server_id}")

    user = await db.get_or_create_user(telegram_id)
    if plan_id is None:
        plans = await db.list_plans(server_id=server_id, include_inactive=False)
        if not plans:
            plans = await db.list_plans(include_inactive=False)
        if not plans:
            raise ValueError("No plans configured — create a plan first")
        plan_id = int(plans[0]["id"])
    else:
        plan = await db.get_plan(plan_id)
        if not plan:
            raise ValueError("Plan not found")

    try:
        uid, email, vless_key = await provision_vless(
            telegram_id,
            data_gb,
            days,
            server_id=server_id,
        )
    except PanelError as exc:
        raise RuntimeError(f"Panel provisioning failed: {exc}") from exc

    expires_at = (db.mmt_now() + timedelta(days=days)).isoformat()
    row = await db.create_manual_subscription(
        user_id=user["id"],
        plan_id=int(plan_id),
        server_id=server_id,
        vless_uuid=uid,
        vless_key=vless_key,
        panel_email=email,
        data_limit_gb=float(data_gb),
        expires_at=expires_at,
    )
    row = {
        **row,
        "telegram_id": telegram_id,
        "username": user.get("username"),
        "first_name": user.get("first_name"),
        "sub_token": user.get("sub_token"),
    }

    if notify and bot is not None:
        try:
            from locales import t
            from utils.formatting import md2
            from utils.vless_delivery import deliver_vpn_access

            lang = user.get("language") or "my"
            summary = t(
                lang,
                "pay_approved_user",
                plan=md2(row.get("plan_title") or "Manual"),
                data_gb=md2(data_gb),
                days=days,
            )
            await deliver_vpn_access(
                bot=bot,
                chat_id=telegram_id,
                lang=lang,
                user=user,
                vless_key=vless_key,
                prefix_text=summary,
                sub_id=row["id"],
            )
        except Exception:
            logger.exception("notify user after manual create failed tg=%s", telegram_id)

    return _serialize_sub(row)
