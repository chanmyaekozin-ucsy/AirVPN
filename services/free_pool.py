"""Shared-pool free catalog: per-device VLESS keys, no login."""
from __future__ import annotations

import hashlib
import logging
import time
from typing import Any

import database as db
from services.catalog_usage import (
    _server_for_host,
    _usage_bytes_by_uuid,
    invalidate_catalog_usage_cache,
)
from vps.panel_client import PanelClient, PanelError, _use_mock_vpn, build_vless_url
from vpn_servers import get_server

logger = logging.getLogger(__name__)

# parent_id → (monotonic_ts, userinfo)
_POOL_CACHE: dict[str, tuple[float, dict[str, int]]] = {}
_POOL_CACHE_TTL_SEC = 20.0


def normalize_device_id(raw: str | None) -> str:
    did = (raw or "").strip()[:128]
    if len(did) < 8:
        return ""
    return did


def _stable_tg_id(device_id: str, parent_id: str, vpn_server_id: str) -> int:
    digest = hashlib.sha256(
        f"{device_id}|{parent_id}|{vpn_server_id}".encode("utf-8")
    ).hexdigest()
    # Positive 31-bit-ish int for panel remarks (avoid 0)
    return (int(digest[:8], 16) % 2_000_000_000) + 1


def _panel_email(device_id: str, parent_id: str, vpn_server_id: str) -> str:
    digest = hashlib.sha1(
        f"{device_id}|{parent_id}|{vpn_server_id}".encode("utf-8")
    ).hexdigest()[:14]
    return f"fd_{digest}"


def _expiry_days_from_row(row: dict[str, Any]) -> int:
    expire_at = row.get("manual_expire_at")
    if expire_at is not None:
        try:
            left = int(expire_at) - int(time.time())
            if left <= 0:
                return 1
            return max(1, (left + 86_399) // 86_400)
        except (TypeError, ValueError):
            pass
    return 365


def pool_total_bytes(row: dict[str, Any]) -> int:
    try:
        return max(0, int(row.get("manual_total_bytes") or 0))
    except (TypeError, ValueError):
        return 0


def vpn_server_for_node(node: dict[str, Any]):
    """Map a catalog display node (share URI) to a configured VPN panel."""
    host = (node.get("host") or "").strip().lower()
    if not host:
        from services.catalog_usage import _host_from_uri

        host = (_host_from_uri(node.get("uri") or "") or "").lower()
    return _server_for_host(host or None)


def node_supports_device_pool(node: dict[str, Any]) -> bool:
    uri = (node.get("uri") or "").strip().lower()
    if not uri.startswith("vless://"):
        return False
    return vpn_server_for_node(node) is not None


async def fetch_pool_userinfo(
    parent_id: str,
    *,
    force: bool = False,
) -> dict[str, int]:
    """
    Sum live panel traffic for all per-device keys in this free catalog parent.
    Falls back to empty zeros when none exist yet.
    """
    now = time.monotonic()
    cached = _POOL_CACHE.get(parent_id)
    if not force and cached and now - cached[0] < _POOL_CACHE_TTL_SEC:
        return dict(cached[1])

    empty = {"upload": 0, "download": 0, "total": 0, "expire": 0}
    rows = await db.list_free_device_keys_for_parent(parent_id)
    if not rows:
        _POOL_CACHE[parent_id] = (now, empty)
        return dict(empty)

    by_server: dict[str, tuple[Any, set[str]]] = {}
    for row in rows:
        sid = (row.get("vpn_server_id") or "").strip().lower()
        uid = (row.get("client_uuid") or "").strip()
        if not sid or not uid:
            continue
        server = get_server(sid)
        if not server:
            continue
        if sid not in by_server:
            by_server[sid] = (server, set())
        by_server[sid][1].add(uid)

    up_total = 0
    down_total = 0
    for _sid, (server, uuids) in by_server.items():
        usage = await _usage_bytes_by_uuid(server, uuids)
        for up, down in usage.values():
            up_total += up
            down_total += down

    info = {
        "upload": int(up_total),
        "download": int(down_total),
        "total": 0,
        "expire": 0,
    }
    _POOL_CACHE[parent_id] = (now, info)
    return dict(info)


def invalidate_pool_usage_cache(parent_id: str | None = None) -> None:
    if parent_id:
        _POOL_CACHE.pop(parent_id, None)
    else:
        _POOL_CACHE.clear()
    invalidate_catalog_usage_cache(parent_id)


async def ensure_device_vless(
    *,
    device_id: str,
    parent_id: str,
    node: dict[str, Any],
    catalog_row: dict[str, Any],
    pool_used_bytes: int,
) -> str:
    """
    Create or refresh a per-device VLESS client on the node's panel.
    Panel totalGB is set to this_device_used + pool_remaining so abuse is capped
    near the shared pool ceiling.
    """
    did = normalize_device_id(device_id)
    if not did:
        raise ValueError("device_id required")

    server = vpn_server_for_node(node)
    if not server:
        raise PanelError("No VPN panel for this free node")

    sid = server.id
    total_pool = pool_total_bytes(catalog_row)
    remaining = max(0, total_pool - max(0, int(pool_used_bytes))) if total_pool > 0 else 0
    days = _expiry_days_from_row(catalog_row)
    email = _panel_email(did, parent_id, sid)
    tg_id = _stable_tg_id(did, parent_id, sid)
    remark = f"AirVPN-FreeDev-{sid}"

    existing = await db.get_free_device_key(did, parent_id, sid)
    this_used = 0
    if existing and existing.get("client_uuid"):
        usage = await _usage_bytes_by_uuid(server, {existing["client_uuid"]})
        up, down = usage.get(existing["client_uuid"], (0, 0))
        this_used = int(up) + int(down)
        # Pool used already includes this device; remaining is for everyone else + headroom
        if total_pool > 0:
            remaining = max(0, total_pool - max(0, int(pool_used_bytes)))

    # Client may consume up to what's left in the pool (plus its own already-used).
    if total_pool > 0:
        client_bytes = max(this_used + remaining, this_used + 1)
    else:
        # No pool ceiling configured — generous per-device cap.
        client_bytes = 50 * 1024 * 1024 * 1024

    if _use_mock_vpn(server):
        import uuid as uuid_mod

        uid = (existing or {}).get("client_uuid") or str(uuid_mod.uuid4())
        key = build_vless_url(
            uuid=uid,
            host=server.vps_host or "your-vps.example.com",
            port=server.vps_port,
            remark=remark,
            server=server,
        )
        await db.upsert_free_device_key(
            device_id=did,
            parent_id=parent_id,
            vpn_server_id=sid,
            client_uuid=uid,
            panel_email=email,
            vless_key=key,
        )
        invalidate_pool_usage_cache(parent_id)
        return key

    client = PanelClient(server)
    try:
        uid, panel_email, key = await client.add_or_update_client(
            email=email,
            telegram_id=tg_id,
            total_bytes=int(client_bytes),
            expiry_days=int(days),
            remark=remark,
        )
    finally:
        await client.close()

    await db.upsert_free_device_key(
        device_id=did,
        parent_id=parent_id,
        vpn_server_id=sid,
        client_uuid=uid,
        panel_email=panel_email,
        vless_key=key,
    )
    invalidate_pool_usage_cache(parent_id)
    return key
