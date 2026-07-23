"""Admin REST API for the AirVPN Admin Android app."""
from __future__ import annotations

import logging
import re
import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from telegram import Bot

import config
import database as db
from database import mmt_now
from services.admin_stats import fetch_admin_stats
from vpn_servers import ensure_vpn_nodes_seeded, list_servers, reload_servers_from_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/admin", tags=["admin"])

_ROOT = Path(__file__).resolve().parent.parent
_ADS_DIR = Path(getattr(config, "MOBILE_ADS_DIR", str(_ROOT / "data" / "ads")))
try:
    _ADS_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

_SAFE_NAME = re.compile(r"[^a-zA-Z0-9._-]+")


def _parse_expires(value: Any) -> datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=mmt_now().tzinfo)
    return dt


def _days_left(expires_at: Any) -> int | None:
    exp = _parse_expires(expires_at)
    if not exp:
        return None
    delta = exp - mmt_now()
    return int(delta.total_seconds() // 86400)


# ─── Auth models / deps ──────────────────────────────────────────────────────


class AdminLoginBody(BaseModel):
    telegram_id: int = Field(gt=0)
    code: str = Field(min_length=4, max_length=12)


class RejectBody(BaseModel):
    reason: str = Field(default="Rejected by admin", min_length=1, max_length=500)


class PaymentAccountBody(BaseModel):
    method: str = Field(default="KBZPay", min_length=1, max_length=64)
    account_number: str = Field(min_length=1, max_length=64)
    account_name: str = Field(min_length=1, max_length=128)
    is_active: bool = True


class PlanBody(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    data_gb: float = Field(gt=0)
    price_ks: int = Field(ge=0)
    duration_days: int = Field(gt=0)
    server_id: str = Field(min_length=1, max_length=32)
    sort_order: int = 0
    is_active: bool = True


class VpnNodeBody(BaseModel):
    id: str = Field(min_length=1, max_length=32)
    name_en: str = Field(min_length=1, max_length=128)
    name_my: str = Field(default="", max_length=128)
    panel_url: str = Field(default="", max_length=512)
    panel_username: str = Field(default="", max_length=128)
    panel_password: str = Field(default="", max_length=256)
    panel_inbound_id: int = Field(default=1, ge=1)
    panel_verify_ssl: bool = True
    vps_host: str = Field(default="", max_length=255)
    vps_port: int = Field(default=443, ge=1, le=65535)
    vless_security: str = Field(default="reality", max_length=32)
    vless_flow: str = Field(default="xtls-rprx-vision", max_length=64)
    vless_sni: str = Field(default="", max_length=255)
    vless_fp: str = Field(default="chrome", max_length=64)
    vless_pbk: str = Field(default="", max_length=256)
    vless_sid: str = Field(default="", max_length=64)
    vless_spx: str = Field(default="/", max_length=128)
    enabled: bool = True
    sort_order: int = 0


class BanBody(BaseModel):
    banned: bool = True


class SubAdjustBody(BaseModel):
    days_delta: int = 0
    data_gb_delta: float = 0.0
    # Absolute setters (Users screen) — applied after deltas when both sent
    set_data_gb: Optional[float] = Field(default=None, ge=0.001)
    set_days_left: Optional[int] = Field(default=None, ge=0)


class ReplaceKeyBody(BaseModel):
    """Empty share_uri → provision a new panel key. Otherwise paste a vless:// (or ss://) share."""
    share_uri: Optional[str] = Field(default=None, max_length=8192)


class ManualSubBody(BaseModel):
    telegram_id: int = Field(gt=0)
    server_id: str = Field(default="sg", min_length=1, max_length=32)
    data_gb: float = Field(gt=0)
    days: int = Field(gt=0)
    plan_id: Optional[int] = None
    notify: bool = False


class CatalogIssueKeyBody(BaseModel):
    """Provision a VLESS client on a VPN node (enabled or disabled) for catalog use."""
    server_id: str = Field(min_length=1, max_length=32)
    data_gb: float = Field(default=50.0, gt=0)
    days: int = Field(default=30, gt=0)
    remark: str = Field(default="", max_length=64)


class MobileServerBody(BaseModel):
    public_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    region: str = Field(default="", max_length=16)
    protocol: str = Field(default="vless", max_length=32)
    tier: str = Field(default="free", max_length=16)
    vpn_server_id: Optional[str] = Field(default=None, max_length=32)
    plan_id: Optional[int] = None
    config_uri: Optional[str] = None
    nodes_text: Optional[str] = Field(default=None, max_length=100_000)
    # Manual free-sub usage (bytes). Prefer data_gb helpers from admin UI.
    manual_total_bytes: Optional[int] = Field(default=None, ge=0)
    manual_upload_bytes: Optional[int] = Field(default=None, ge=0)
    manual_download_bytes: Optional[int] = Field(default=None, ge=0)
    manual_expire_at: Optional[int] = Field(default=None, ge=0)  # unix seconds
    manual_data_gb: Optional[float] = Field(default=None, ge=0)
    manual_used_gb: Optional[float] = Field(default=None, ge=0)
    list_when_disabled: bool = False
    enabled: bool = True
    sort_order: int = 0


def _gb_to_bytes(gb: float | None) -> int | None:
    if gb is None:
        return None
    return int(float(gb) * 1024 * 1024 * 1024)


def _bytes_to_gb(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return 0.0
    return round(n / (1024 * 1024 * 1024), 3)


class AdBody(BaseModel):
    public_id: str = Field(min_length=1, max_length=64)
    placement: str = Field(default="banner", max_length=16)
    image_url: str = Field(min_length=1, max_length=1024)
    click_url: str = Field(default="", max_length=1024)
    title: str = Field(default="", max_length=128)
    image_width: int = Field(default=0, ge=0)
    image_height: int = Field(default=0, ge=0)
    enabled: bool = True
    sort_order: int = 0


class BroadcastBody(BaseModel):
    audience: str = Field(default="all", min_length=2, max_length=16)
    message: str = Field(min_length=1, max_length=3500)


class AppConfigBody(BaseModel):
    """Admin-editable mobile client config (updates + maintenance + download links)."""
    min_version_code: int = Field(default=1, ge=1)
    latest_version_code: int = Field(default=1, ge=1)
    latest_version_name: str = Field(default="1.0.0", max_length=32)
    force_update: bool = False
    changelog: str = Field(default="", max_length=4000)
    maintenance: bool = False
    maintenance_message: str = Field(default="", max_length=1000)
    telegram_url: str = Field(default="", max_length=512)
    play_url: str = Field(default="", max_length=512)
    update_url: str = Field(default="", max_length=512)
    buy_url: str = Field(default="", max_length=512)
    privacy_url: str = Field(default="", max_length=512)


class AdPatchBody(BaseModel):
    placement: Optional[str] = Field(default=None, max_length=16)
    image_url: Optional[str] = Field(default=None, max_length=1024)
    click_url: Optional[str] = Field(default=None, max_length=1024)
    title: Optional[str] = Field(default=None, max_length=128)
    image_width: Optional[int] = Field(default=None, ge=0)
    image_height: Optional[int] = Field(default=None, ge=0)
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization")
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization")
    return parts[1].strip()


async def require_admin(
    authorization: Optional[str] = Header(default=None),
) -> int:
    token = _extract_bearer(authorization)
    telegram_id = await db.resolve_admin_session(token)
    if telegram_id is None or telegram_id not in config.ADMIN_TELEGRAM_IDS:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return telegram_id


def _bot() -> Bot:
    if not config.BOT_TOKEN:
        raise HTTPException(status_code=503, detail="Bot token not configured")
    return Bot(token=config.BOT_TOKEN)


def _serialize_payment(row: dict[str, Any]) -> dict[str, Any]:
    has_receipt = bool((row.get("receipt_file_id") or "").strip())
    limit_gb = row.get("sub_data_limit_gb")
    used_gb = row.get("sub_data_used_gb")
    bonus_mb = float(row.get("sub_bonus_data_mb") or 0)
    data_left_gb: float | None = None
    if limit_gb is not None:
        total = float(limit_gb) + (bonus_mb / 1024.0)
        used = float(used_gb or 0)
        data_left_gb = round(max(0.0, total - used), 3)

    expires_at = row.get("sub_expires_at")
    days_left = _days_left(expires_at) if expires_at else None

    return {
        "id": row["id"],
        "status": row.get("status"),
        "method": row.get("method"),
        "amount_ks": row.get("amount_ks"),
        "server_id": row.get("server_id") or "sg",
        "plan_title": row.get("plan_title"),
        "data_gb": row.get("data_gb"),
        "duration_days": row.get("duration_days"),
        "telegram_id": row.get("telegram_id"),
        "username": row.get("username"),
        "first_name": row.get("first_name"),
        "receipt_tx_id": row.get("receipt_tx_id"),
        "receipt_note": row.get("receipt_note"),
        "has_receipt": has_receipt,
        "receipt_url": f"/v1/admin/payments/{row['id']}/receipt" if has_receipt else None,
        "reject_reason": row.get("reject_reason"),
        "verify_status": row.get("verify_status"),
        "verify_message": row.get("verify_message"),
        "auto_verified": bool(row.get("auto_verified")),
        "created_at": row.get("created_at"),
        "processed_at": row.get("processed_at"),
        "processed_by": row.get("processed_by"),
        "subscription_id": row.get("subscription_id"),
        "sub_data_limit_gb": float(limit_gb) if limit_gb is not None else None,
        "sub_data_used_gb": round(float(used_gb or 0), 3) if limit_gb is not None else None,
        "sub_data_left_gb": data_left_gb,
        "sub_expires_at": expires_at,
        "sub_days_left": days_left,
        "sub_is_active": bool(row.get("sub_is_active")) if row.get("subscription_id") else None,
    }


def _serialize_plan(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "title": row.get("title") or "",
        "data_gb": float(row.get("data_gb") or 0),
        "price_ks": int(row.get("price_ks") or 0),
        "duration_days": int(row.get("duration_days") or 0),
        "server_id": (row.get("server_id") or "sg"),
        "sort_order": int(row.get("sort_order") or 0),
        "is_active": bool(row.get("is_active")),
    }


def _serialize_ad(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("public_id"),
        "placement": row.get("placement"),
        "title": row.get("title") or "",
        "image_url": row.get("image_url"),
        "click_url": row.get("click_url") or "",
        "image_width": int(row.get("image_width") or 0),
        "image_height": int(row.get("image_height") or 0),
        "enabled": bool(row.get("enabled")),
        "sort_order": int(row.get("sort_order") or 0),
        "created_at": row.get("created_at"),
    }


def _serialize_mobile_server(row: dict[str, Any]) -> dict[str, Any]:
    used = int(row.get("manual_upload_bytes") or 0) + int(row.get("manual_download_bytes") or 0)
    return {
        "id": row.get("public_id"),
        "name": row.get("name"),
        "region": row.get("region") or "",
        "protocol": row.get("protocol") or "vless",
        "tier": row.get("tier") or "free",
        "vpn_server_id": row.get("vpn_server_id"),
        "plan_id": row.get("plan_id"),
        "config_uri": row.get("config_uri"),
        "nodes_text": row.get("nodes_text") or "",
        "manual_total_bytes": row.get("manual_total_bytes"),
        "manual_upload_bytes": row.get("manual_upload_bytes"),
        "manual_download_bytes": row.get("manual_download_bytes"),
        "manual_expire_at": row.get("manual_expire_at"),
        "manual_data_gb": _bytes_to_gb(row.get("manual_total_bytes")),
        "manual_used_gb": _bytes_to_gb(used) if used or row.get("manual_total_bytes") is not None else None,
        "list_when_disabled": bool(row.get("list_when_disabled")),
        "enabled": bool(row.get("enabled")),
        "sort_order": int(row.get("sort_order") or 0),
        "plan_title": row.get("plan_title"),
        "plan_price_ks": row.get("plan_price_ks"),
        "plan_data_gb": row.get("plan_data_gb"),
        "plan_duration_days": row.get("plan_duration_days"),
    }


# ─── Auth ────────────────────────────────────────────────────────────────────


@router.post("/auth/login")
async def admin_login(body: AdminLoginBody) -> dict[str, Any]:
    if body.telegram_id not in config.ADMIN_TELEGRAM_IDS:
        raise HTTPException(status_code=403, detail="Not an admin")
    code = body.code.strip()
    if not await db.consume_admin_login_otp(body.telegram_id, code):
        raise HTTPException(status_code=401, detail="Invalid or expired code")
    token = secrets.token_urlsafe(32)
    await db.create_admin_session(body.telegram_id, token, ttl_days=30)
    return {
        "admin_token": token,
        "telegram_id": body.telegram_id,
        "expires_in_days": 30,
    }


@router.post("/auth/logout")
async def admin_logout(
    authorization: Optional[str] = Header(default=None),
) -> dict[str, str]:
    token = _extract_bearer(authorization)
    await db.revoke_admin_session(token)
    return {"status": "ok"}


@router.get("/me")
async def admin_me(admin_id: int = Depends(require_admin)) -> dict[str, Any]:
    return {"telegram_id": admin_id, "role": "admin"}


# ─── Stats ───────────────────────────────────────────────────────────────────


@router.get("/stats")
async def admin_stats(_admin_id: int = Depends(require_admin)) -> dict[str, Any]:
    return await fetch_admin_stats()


# ─── VPN nodes (DB) + plans (DB) ──────────────────────────────────────────────


def _serialize_vpn_node(row: dict[str, Any], *, plan_count: int = 0) -> dict[str, Any]:
    password = (row.get("panel_password") or "").strip()
    pbk = (row.get("vless_pbk") or "").strip()
    return {
        "id": row["id"],
        "name_en": row.get("name_en") or "",
        "name_my": row.get("name_my") or "",
        "panel_url": row.get("panel_url") or "",
        "panel_username": row.get("panel_username") or "",
        "panel_password_set": bool(password),
        "panel_inbound_id": int(row.get("panel_inbound_id") or 1),
        "panel_verify_ssl": bool(row.get("panel_verify_ssl", 1)),
        "vps_host": row.get("vps_host") or "",
        "vps_port": int(row.get("vps_port") or 443),
        "vless_security": row.get("vless_security") or "reality",
        "vless_flow": row.get("vless_flow") or "xtls-rprx-vision",
        "vless_sni": row.get("vless_sni") or "",
        "vless_fp": row.get("vless_fp") or "chrome",
        "vless_pbk_set": bool(pbk),
        "vless_sid": row.get("vless_sid") or "",
        "vless_spx": row.get("vless_spx") or "/",
        "enabled": bool(row.get("enabled", 1)),
        "sort_order": int(row.get("sort_order") or 0),
        "panel_configured": bool((row.get("panel_url") or "").strip() and (row.get("vps_host") or "").strip()),
        "plan_count": plan_count,
        "source": "db",
    }


@router.get("/servers")
async def admin_list_servers(_admin_id: int = Depends(require_admin)) -> dict[str, Any]:
    await reload_servers_from_db()
    rows = await db.list_vpn_nodes(enabled_only=False)
    if not rows:
        # Env-only fallback (before first seed)
        servers = []
        for s in list_servers(include_disabled=True):
            servers.append(
                {
                    "id": s.id,
                    "name_en": s.name_en,
                    "name_my": s.name_my,
                    "panel_url": s.panel_url,
                    "panel_username": s.panel_username,
                    "panel_password_set": bool(s.panel_password),
                    "panel_inbound_id": s.panel_inbound_id,
                    "panel_verify_ssl": s.panel_verify_ssl,
                    "vps_host": s.vps_host,
                    "vps_port": s.vps_port,
                    "vless_security": s.vless_security,
                    "vless_flow": s.vless_flow,
                    "vless_sni": s.vless_sni,
                    "vless_fp": s.vless_fp,
                    "vless_pbk_set": bool(s.vless_pbk),
                    "vless_sid": s.vless_sid,
                    "vless_spx": s.vless_spx,
                    "enabled": s.enabled,
                    "sort_order": s.sort_order,
                    "panel_configured": s.is_configured(),
                    "plan_count": len(s.plans),
                    "source": s.source,
                }
            )
        return {"servers": servers}

    servers = []
    for row in rows:
        plans = await db.list_plans(server_id=row["id"], include_inactive=True)
        servers.append(_serialize_vpn_node(row, plan_count=len(plans)))
    return {"servers": servers}


@router.post("/servers")
async def admin_upsert_server(
    body: VpnNodeBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    try:
        row = await db.upsert_vpn_node(
            node_id=body.id,
            name_en=body.name_en,
            name_my=body.name_my,
            panel_url=body.panel_url,
            panel_username=body.panel_username,
            panel_password=body.panel_password,
            panel_inbound_id=body.panel_inbound_id,
            panel_verify_ssl=body.panel_verify_ssl,
            vps_host=body.vps_host,
            vps_port=body.vps_port,
            vless_security=body.vless_security,
            vless_flow=body.vless_flow,
            vless_sni=body.vless_sni,
            vless_fp=body.vless_fp,
            vless_pbk=body.vless_pbk,
            vless_sid=body.vless_sid,
            vless_spx=body.vless_spx,
            enabled=body.enabled,
            sort_order=body.sort_order,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await reload_servers_from_db()
    plans = await db.list_plans(server_id=row["id"], include_inactive=True)
    return {"server": _serialize_vpn_node(row, plan_count=len(plans))}


@router.post("/servers/{server_id}/enabled")
async def admin_set_server_enabled(
    server_id: str,
    enabled: bool = True,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    ok = await db.set_vpn_node_enabled(server_id, enabled)
    if not ok:
        raise HTTPException(status_code=404, detail="Server not found")
    await reload_servers_from_db()
    return {"status": "ok", "id": server_id.strip().lower(), "enabled": enabled}


@router.delete("/servers/{server_id}")
async def admin_delete_server(
    server_id: str,
    _admin_id: int = Depends(require_admin),
) -> dict[str, str]:
    sid = server_id.strip().lower()
    active_plans = await db.list_plans(server_id=sid, include_inactive=False)
    if active_plans:
        raise HTTPException(
            status_code=400,
            detail="Disable or remove active plans for this node first",
        )
    ok = await db.delete_vpn_node(sid)
    if not ok:
        raise HTTPException(status_code=404, detail="Server not found")
    await reload_servers_from_db()
    return {"status": "ok"}


@router.get("/plans")
async def admin_list_plans(
    server_id: Optional[str] = None,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    rows = await db.list_plans(server_id=server_id, include_inactive=True)
    return {"plans": [_serialize_plan(r) for r in rows]}


@router.post("/plans")
async def admin_create_plan(
    body: PlanBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    row = await db.upsert_plan(
        title=body.title,
        data_gb=body.data_gb,
        price_ks=body.price_ks,
        duration_days=body.duration_days,
        server_id=body.server_id,
        sort_order=body.sort_order,
        is_active=body.is_active,
    )
    return {"plan": _serialize_plan(row)}


@router.patch("/plans/{plan_id}")
async def admin_update_plan(
    plan_id: int,
    body: PlanBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    existing = await db.get_plan(plan_id)
    if not existing or existing.get("is_free"):
        raise HTTPException(status_code=404, detail="Plan not found")
    row = await db.upsert_plan(
        plan_id=plan_id,
        title=body.title,
        data_gb=body.data_gb,
        price_ks=body.price_ks,
        duration_days=body.duration_days,
        server_id=body.server_id,
        sort_order=body.sort_order,
        is_active=body.is_active,
    )
    return {"plan": _serialize_plan(row)}


@router.post("/plans/{plan_id}/active")
async def admin_set_plan_active(
    plan_id: int,
    active: bool = True,
    _admin_id: int = Depends(require_admin),
) -> dict[str, str]:
    ok = await db.set_plan_active(plan_id, active)
    if not ok:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"status": "ok"}


@router.delete("/plans/{plan_id}")
async def admin_delete_plan(
    plan_id: int,
    _admin_id: int = Depends(require_admin),
) -> dict[str, str]:
    ok = await db.delete_plan(plan_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"status": "ok"}


# ─── Payment accounts ────────────────────────────────────────────────────────


@router.get("/payment-accounts")
async def admin_list_accounts(
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    rows = await db.list_payment_accounts_all(active_only=False)
    return {
        "accounts": [
            {
                "id": r["id"],
                "method": r["method"],
                "account_number": r["account_number"],
                "account_name": r["account_name"],
                "is_active": bool(r["is_active"]),
            }
            for r in rows
        ]
    }


@router.post("/payment-accounts")
async def admin_create_account(
    body: PaymentAccountBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    row = await db.upsert_payment_account(
        method=body.method,
        account_number=body.account_number,
        account_name=body.account_name,
        is_active=body.is_active,
    )
    return {"account": row}


@router.patch("/payment-accounts/{account_id}")
async def admin_update_account(
    account_id: int,
    body: PaymentAccountBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    existing = await db.get_payment_account(account_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Account not found")
    row = await db.upsert_payment_account(
        account_id=account_id,
        method=body.method,
        account_number=body.account_number,
        account_name=body.account_name,
        is_active=body.is_active,
    )
    return {"account": row}


@router.post("/payment-accounts/{account_id}/active")
async def admin_set_account_active(
    account_id: int,
    active: bool = True,
    _admin_id: int = Depends(require_admin),
) -> dict[str, str]:
    ok = await db.set_payment_account_active(account_id, active)
    if not ok:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"status": "ok"}


# ─── Payments ────────────────────────────────────────────────────────────────


@router.get("/payments")
async def admin_list_payments(
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    result = await db.list_payments(status=status, page=page, per_page=per_page)
    result["items"] = [_serialize_payment(r) for r in result["items"]]
    return result


@router.get("/payments/{payment_id}")
async def admin_get_payment(
    payment_id: int,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    row = await db.get_payment(payment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Payment not found")
    return {"payment": _serialize_payment(row)}


@router.get("/payments/{payment_id}/receipt")
async def admin_payment_receipt(
    payment_id: int,
    _admin_id: int = Depends(require_admin),
) -> Response:
    """Proxy Telegram receipt photo for the Admin app."""
    row = await db.get_payment(payment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Payment not found")
    file_id = (row.get("receipt_file_id") or "").strip()
    if not file_id:
        raise HTTPException(status_code=404, detail="No receipt screenshot")
    try:
        bot = _bot()
        tg_file = await bot.get_file(file_id)
        data = bytes(await tg_file.download_as_bytearray())
    except Exception as exc:
        logger.exception("receipt download failed for payment %s", payment_id)
        raise HTTPException(status_code=502, detail=f"Could not fetch receipt: {exc}") from exc
    if not data:
        raise HTTPException(status_code=404, detail="Empty receipt file")
    media = "image/jpeg"
    path = (getattr(tg_file, "file_path", None) or "").lower()
    if path.endswith(".png"):
        media = "image/png"
    elif path.endswith(".webp"):
        media = "image/webp"
    return Response(
        content=data,
        media_type=media,
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post("/payments/{payment_id}/approve")
async def admin_approve_payment(
    payment_id: int,
    admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    from services.payment_approve import approve_and_deliver

    ok, msg = await approve_and_deliver(
        _bot(),
        payment_id,
        processed_by=admin_id,
        auto=False,
    )
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    row = await db.get_payment(payment_id)
    return {"status": "ok", "message": msg, "payment": _serialize_payment(row) if row else None}


@router.post("/payments/{payment_id}/reject")
async def admin_reject_payment(
    payment_id: int,
    body: RejectBody,
    admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    from handlers.group_payment import reject_payment_from_group

    payment = await db.get_payment(payment_id)
    if not payment or payment["status"] != "pending":
        raise HTTPException(status_code=400, detail="Payment not pending")
    try:
        await reject_payment_from_group(_bot(), payment_id, admin_id, body.reason)
    except Exception:
        logger.exception("reject_payment_from_group failed; falling back to DB reject")
        await db.reject_payment(payment_id, admin_id, body.reason)
    row = await db.get_payment(payment_id)
    return {"status": "ok", "payment": _serialize_payment(row) if row else None}


# ─── Users ───────────────────────────────────────────────────────────────────


@router.get("/users")
async def admin_list_users(
    q: str = "",
    page: int = 1,
    per_page: int = 20,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    return await db.search_users(q=q, page=page, per_page=per_page)


@router.post("/users/{telegram_id}/ban")
async def admin_ban_user(
    telegram_id: int,
    body: BanBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    ok = await db.set_user_banned(telegram_id, body.banned)
    if not ok:
        # Create user row if missing so ban sticks for future contact
        await db.get_or_create_user(telegram_id)
        ok = await db.set_user_banned(telegram_id, body.banned)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found")
    return {"telegram_id": telegram_id, "banned": body.banned}


# ─── Subscription power tools ────────────────────────────────────────────────


@router.get("/users/{telegram_id}/subscriptions")
async def admin_user_subscriptions(
    telegram_id: int,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    from services.admin_subs import list_user_subscriptions

    items = await list_user_subscriptions(telegram_id)
    return {"telegram_id": telegram_id, "subscriptions": items}


@router.post("/subscriptions/{sub_id}/adjust")
async def admin_adjust_subscription(
    sub_id: int,
    body: SubAdjustBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    from services.admin_subs import adjust_subscription

    try:
        sub = await adjust_subscription(
            sub_id,
            days_delta=body.days_delta,
            data_gb_delta=body.data_gb_delta,
            set_data_gb=body.set_data_gb,
            set_days_left=body.set_days_left,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("adjust_subscription failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"status": "ok", "subscription": sub}


@router.post("/subscriptions/{sub_id}/replace-key")
async def admin_replace_subscription_key(
    sub_id: int,
    body: ReplaceKeyBody = ReplaceKeyBody(),
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    from services.admin_subs import replace_subscription_key

    share = (body.share_uri or "").strip() or None
    try:
        sub = await replace_subscription_key(sub_id, share_uri=share)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("replace_subscription_key failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"status": "ok", "subscription": sub}


@router.post("/subscriptions/{sub_id}/remove-key")
async def admin_remove_subscription_key(
    sub_id: int,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    from services.admin_subs import remove_subscription_key

    try:
        sub = await remove_subscription_key(sub_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("remove_subscription_key failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"status": "ok", "subscription": sub}


@router.post("/subscriptions/create")
async def admin_create_subscription(
    body: ManualSubBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    from services.admin_subs import create_manual_subscription

    try:
        sub = await create_manual_subscription(
            telegram_id=body.telegram_id,
            server_id=body.server_id,
            data_gb=body.data_gb,
            days=body.days,
            plan_id=body.plan_id,
            notify=body.notify,
            bot=_bot() if body.notify else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("create_manual_subscription failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"status": "ok", "subscription": sub}


# ─── Mobile catalog ──────────────────────────────────────────────────────────


@router.post("/catalog/issue-key")
async def admin_catalog_issue_key(
    body: CatalogIssueKeyBody,
    admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    """
    Create a panel VLESS client on any configured VPN node (including disabled)
    and return the share URI for pasting into a catalog free server.
    """
    from vpn_servers import get_server
    from vps.panel_client import PanelError, provision_vless

    await reload_servers_from_db()
    sid = body.server_id.strip().lower()
    server = get_server(sid)
    if not server:
        raise HTTPException(status_code=404, detail=f"VPN node not found: {sid}")
    if not (server.panel_url or "").strip() or not (server.vps_host or "").strip():
        raise HTTPException(
            status_code=400,
            detail=f"Node {sid} is not fully configured (panel URL / VPS host)",
        )

    remark = (body.remark or "").strip() or f"AirVPN-Catalog-{sid}"
    try:
        uid, email, vless_key = await provision_vless(
            admin_id,
            float(body.data_gb),
            int(body.days),
            server_id=sid,
        )
    except PanelError as exc:
        raise HTTPException(status_code=502, detail=f"Panel error: {exc}") from exc
    except Exception as exc:
        logger.exception("catalog issue-key failed node=%s", sid)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "server_id": sid,
        "enabled": bool(server.enabled),
        "vless_key": vless_key,
        "uuid": uid,
        "panel_email": email,
        "data_gb": float(body.data_gb),
        "days": int(body.days),
        "remark": remark,
    }


@router.get("/catalog")
async def admin_list_catalog(
    page: int = 1,
    per_page: int = 20,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    result = await db.list_mobile_servers(enabled_only=False, page=page, per_page=per_page)
    assert isinstance(result, dict)
    result["servers"] = [_serialize_mobile_server(r) for r in result.pop("items")]
    return result


@router.post("/catalog")
async def admin_upsert_catalog(
    body: MobileServerBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    tier = (body.tier or "free").strip().lower()
    config_uri = (body.config_uri or "").strip() or None
    nodes_text = (body.nodes_text or "").strip() or None
    if tier == "free":
        # Prefer Available nodes as the free sub body. Fold a lone share URI into nodes.
        share = config_uri or ""
        share_low = share.lower()
        if share_low.startswith("vless://") or share_low.startswith("ss://"):
            if nodes_text:
                if share not in nodes_text:
                    nodes_text = f"{share}\n{nodes_text}"
                config_uri = None
            elif "\n" in share or share.count("vless://") + share.count("ss://") > 1:
                nodes_text = share
                config_uri = None
        has_share = False
        if config_uri:
            low = config_uri.lower()
            has_share = (
                low.startswith("vless://")
                or low.startswith("ss://")
                or low.startswith("http://")
                or low.startswith("https://")
            )
            if not has_share:
                raise HTTPException(
                    status_code=400,
                    detail="config_uri must be vless://, ss://, or an http(s) subscription URL",
                )
        has_nodes = bool(nodes_text and ("vless://" in nodes_text.lower() or "ss://" in nodes_text.lower()))
        if not has_share and not has_nodes:
            raise HTTPException(
                status_code=400,
                detail="Free servers need a config_uri and/or nodes_text (vless:// / ss:// lines)",
            )

    total_bytes = body.manual_total_bytes
    if body.manual_data_gb is not None:
        total_bytes = _gb_to_bytes(body.manual_data_gb)
    used_bytes = None
    if body.manual_used_gb is not None:
        used_bytes = _gb_to_bytes(body.manual_used_gb)
    upload_bytes = body.manual_upload_bytes
    download_bytes = body.manual_download_bytes
    if used_bytes is not None:
        # Store used entirely in download for simplicity when admin sets used GB
        upload_bytes = 0
        download_bytes = used_bytes

    row = await db.upsert_mobile_server(
        public_id=body.public_id,
        name=body.name,
        region=body.region,
        protocol=body.protocol,
        tier=tier,
        vpn_server_id=body.vpn_server_id,
        plan_id=body.plan_id,
        config_uri=config_uri,
        nodes_text=nodes_text,
        manual_total_bytes=total_bytes,
        manual_upload_bytes=upload_bytes,
        manual_download_bytes=download_bytes,
        manual_expire_at=body.manual_expire_at,
        list_when_disabled=body.list_when_disabled,
        enabled=body.enabled,
        sort_order=body.sort_order,
    )
    try:
        from services.sub_link import invalidate_subscription_cache

        invalidate_subscription_cache(body.public_id)
    except Exception:
        pass
    return {"server": _serialize_mobile_server(row)}


@router.post("/catalog/{public_id}/enabled")
async def admin_set_catalog_enabled(
    public_id: str,
    enabled: bool = True,
    _admin_id: int = Depends(require_admin),
) -> dict[str, str]:
    ok = await db.set_mobile_server_enabled(public_id, enabled)
    if not ok:
        raise HTTPException(status_code=404, detail="Server not found")
    return {"status": "ok"}


@router.delete("/catalog/{public_id}")
async def admin_delete_catalog(
    public_id: str,
    _admin_id: int = Depends(require_admin),
) -> dict[str, str]:
    ok = await db.delete_mobile_server(public_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Server not found")
    try:
        from services.sub_link import invalidate_subscription_cache

        invalidate_subscription_cache(public_id)
    except Exception:
        pass
    return {"status": "ok"}


# ─── Ads manager ─────────────────────────────────────────────────────────────


@router.get("/ads")
async def admin_list_ads(
    page: int = 1,
    per_page: int = 20,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    result = await db.list_mobile_ads(enabled_only=False, page=page, per_page=per_page)
    assert isinstance(result, dict)
    result["ads"] = [_serialize_ad(r) for r in result.pop("items")]
    return result


@router.post("/ads")
async def admin_upsert_ad(
    body: AdBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    placement = body.placement.lower().strip()
    if placement not in ("banner", "dialog"):
        raise HTTPException(status_code=400, detail="placement must be banner or dialog")
    row = await db.upsert_mobile_ad(
        public_id=body.public_id,
        placement=placement,
        image_url=body.image_url,
        click_url=body.click_url,
        title=body.title,
        image_width=body.image_width,
        image_height=body.image_height,
        enabled=body.enabled,
        sort_order=body.sort_order,
    )
    return {"ad": _serialize_ad(row)}


@router.patch("/ads/{public_id}")
async def admin_patch_ad(
    public_id: str,
    body: AdPatchBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    existing = await db.get_mobile_ad(public_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Ad not found")
    placement = (body.placement or existing["placement"] or "banner").lower()
    if placement not in ("banner", "dialog"):
        raise HTTPException(status_code=400, detail="placement must be banner or dialog")
    row = await db.upsert_mobile_ad(
        public_id=public_id,
        placement=placement,
        image_url=body.image_url if body.image_url is not None else existing["image_url"],
        click_url=body.click_url if body.click_url is not None else (existing.get("click_url") or ""),
        title=body.title if body.title is not None else (existing.get("title") or ""),
        image_width=body.image_width if body.image_width is not None else int(existing.get("image_width") or 0),
        image_height=body.image_height if body.image_height is not None else int(existing.get("image_height") or 0),
        enabled=body.enabled if body.enabled is not None else bool(existing.get("enabled")),
        sort_order=body.sort_order if body.sort_order is not None else int(existing.get("sort_order") or 0),
    )
    return {"ad": _serialize_ad(row)}


@router.delete("/ads/{public_id}")
async def admin_delete_ad(
    public_id: str,
    _admin_id: int = Depends(require_admin),
) -> dict[str, str]:
    ok = await db.delete_mobile_ad(public_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Ad not found")
    return {"status": "ok"}


@router.post("/ads/upload")
async def admin_upload_ad_image(
    file: UploadFile = File(...),
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    from utils.image_meta import describe_image, sniff_image_ext

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    raw_name = file.filename or "ad.bin"
    ext = Path(raw_name).suffix.lower()
    sniffed = sniff_image_ext(data)
    if sniffed:
        ext = sniffed
    elif ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        # Also accept content-type when filename has no/wrong extension
        ctype = (file.content_type or "").lower()
        ctype_map = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/webp": ".webp",
            "image/gif": ".gif",
        }
        ext = ctype_map.get(ctype, "")
    if ext == ".jpeg":
        ext = ".jpg"
    if ext not in (".png", ".jpg", ".webp", ".gif"):
        raise HTTPException(status_code=400, detail="Unsupported image type")

    meta = describe_image(data)
    stem = _SAFE_NAME.sub("-", Path(raw_name).stem)[:40] or "ad"
    if stem.endswith(".bin") or stem.startswith("ad-upload"):
        stem = "ad"
    filename = f"{stem}-{uuid.uuid4().hex[:8]}{ext}"
    dest = _ADS_DIR / filename
    dest.write_bytes(data)
    return {
        "image_url": f"/ads/{filename}",
        "filename": filename,
        "image_width": int(meta.get("width") or 0),
        "image_height": int(meta.get("height") or 0),
    }


# ─── Telegram broadcast notifications ────────────────────────────────────────


def _serialize_notification(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "audience": row.get("audience") or "all",
        "message": row.get("message") or "",
        "sent_by": row.get("sent_by"),
        "sent_count": int(row.get("sent_count") or 0),
        "failed_count": int(row.get("failed_count") or 0),
        "created_at": row.get("created_at"),
    }


@router.get("/notifications")
async def admin_list_notifications(
    limit: int = 20,
    admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    _ = admin_id
    lim = max(1, min(50, limit))
    rows = await db.get_recent_notifications(lim)
    counts = await db.count_broadcast_audiences()
    return {
        "audiences": counts,
        "notifications": [_serialize_notification(r) for r in rows],
    }


@router.post("/notifications/broadcast")
async def admin_broadcast_notification(
    body: BroadcastBody,
    admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    from services.notify import broadcast_notification, normalize_audience

    try:
        audience = normalize_audience(body.audience)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    try:
        notif_id, sent, failed = await broadcast_notification(
            _bot(),
            audience,
            message,
            admin_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("broadcast failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "status": "ok",
        "id": notif_id,
        "audience": audience,
        "sent": sent,
        "failed": failed,
        "targets": sent + failed,
    }


# ─── Mobile app config (updates / maintenance / download links) ───────────────


def _serialize_app_config(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "min_version_code": int(row.get("min_version_code") or 1),
        "latest_version_code": int(row.get("latest_version_code") or 1),
        "latest_version_name": str(row.get("latest_version_name") or "1.0.0"),
        "force_update": bool(row.get("force_update")),
        "changelog": str(row.get("changelog") or ""),
        "maintenance": bool(row.get("maintenance")),
        "maintenance_message": str(row.get("maintenance_message") or ""),
        "telegram_url": str(row.get("telegram_url") or ""),
        "play_url": str(row.get("play_url") or ""),
        "update_url": str(row.get("update_url") or ""),
        "buy_url": str(row.get("buy_url") or ""),
        "privacy_url": str(row.get("privacy_url") or ""),
        "updated_at": row.get("updated_at"),
    }


@router.get("/app-config")
async def admin_get_app_config(
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    row = await db.get_mobile_app_settings()
    return {"config": _serialize_app_config(row)}


@router.put("/app-config")
async def admin_put_app_config(
    body: AppConfigBody,
    _admin_id: int = Depends(require_admin),
) -> dict[str, Any]:
    row = await db.upsert_mobile_app_settings(
        min_version_code=body.min_version_code,
        latest_version_code=body.latest_version_code,
        latest_version_name=body.latest_version_name,
        force_update=body.force_update,
        changelog=body.changelog,
        maintenance=body.maintenance,
        maintenance_message=body.maintenance_message,
        telegram_url=body.telegram_url,
        play_url=body.play_url,
        update_url=body.update_url,
        buy_url=body.buy_url,
        privacy_url=body.privacy_url,
    )
    return {"status": "ok", "config": _serialize_app_config(row)}


async def ensure_admin_seed() -> None:
    """Seed missing VPN nodes from .env; seed plans when the catalog is empty."""
    try:
        await ensure_vpn_nodes_seeded()
    except Exception:
        logger.exception("Failed to seed VPN nodes from env")
    try:
        # Always safe: upserts by server_id + sort_order; activates env tiers
        await db.sync_plans_from_env()
    except Exception:
        logger.exception("Failed to sync plans from env")
