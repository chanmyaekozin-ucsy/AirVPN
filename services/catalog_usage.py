"""Live traffic for free-catalog nodes provisioned on AirVPN panels."""
from __future__ import annotations

import logging
import re
import time
from collections import defaultdict
from typing import Any
from urllib.parse import unquote, urlparse

from vps.panel_client import PanelClient, PanelError
from vpn_servers import list_servers

logger = logging.getLogger(__name__)

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

# parent_id → (monotonic_ts, userinfo)
_CACHE: dict[str, tuple[float, dict[str, int]]] = {}
_CACHE_TTL_SEC = 30.0


def _uuid_from_uri(uri: str) -> str | None:
    raw = (uri or "").strip()
    low = raw.lower()
    if not low.startswith("vless://"):
        return None
    rest = raw[8:]
    at = rest.find("@")
    candidate = unquote(rest[:at] if at > 0 else rest.split("?", 1)[0].split("#", 1)[0])
    if _UUID_RE.match(candidate):
        return candidate
    return None


def _host_from_uri(uri: str) -> str | None:
    try:
        parsed = urlparse((uri or "").strip())
        return (parsed.hostname or "").strip().lower() or None
    except Exception:
        return None


def _server_for_host(host: str | None):
    if not host:
        return None
    h = host.lower()
    for s in list_servers(include_disabled=True):
        vh = (s.vps_host or "").strip().lower()
        if vh and vh == h:
            return s
    return None


async def _usage_bytes_by_uuid(server, uuids: set[str]) -> dict[str, tuple[int, int]]:
    """Return uuid → (up_bytes, down_bytes) from inbound clientStats / traffics API."""
    if not uuids or not server or not server.panel_url:
        return {}
    out: dict[str, tuple[int, int]] = {}
    client = PanelClient(server)
    try:
        from vps.panel_client import _parse_json_field

        inbound = await client.get_inbound()
        settings = _parse_json_field(inbound.get("settings"), field="settings")
        clients = settings.get("clients") or []
        email_by_uuid: dict[str, str] = {}
        for c in clients:
            uid = str(c.get("id") or "").strip()
            em = (c.get("email") or "").strip()
            if uid in uuids and em:
                email_by_uuid[uid] = em

        # Prefer clientStats keyed by email (3x-ui stores numeric id there, not UUID)
        stats_by_email: dict[str, tuple[int, int]] = {}
        for stat in inbound.get("clientStats") or []:
            em = (stat.get("email") or "").strip()
            if not em:
                continue
            stats_by_email[em] = (int(stat.get("up") or 0), int(stat.get("down") or 0))

        for uid, email in email_by_uuid.items():
            if email in stats_by_email:
                out[uid] = stats_by_email[email]
                continue
            record = await client.get_client_traffic_record(email)
            if record:
                out[uid] = (int(record.get("up") or 0), int(record.get("down") or 0))
    except PanelError:
        logger.exception("catalog usage panel error server=%s", getattr(server, "id", "?"))
    except Exception:
        logger.exception("catalog usage unexpected server=%s", getattr(server, "id", "?"))
    finally:
        await client.close()
    return out


async def fetch_catalog_nodes_userinfo(
    *,
    parent_id: str,
    nodes: list[dict[str, Any]],
    force: bool = False,
) -> dict[str, int]:
    """
    Aggregate live up/down bytes for catalog share URIs from matching panels.
    Cached briefly so /v1/servers stays light.
    """
    now = time.monotonic()
    cached = _CACHE.get(parent_id)
    if not force and cached and now - cached[0] < _CACHE_TTL_SEC:
        return dict(cached[1])

    empty = {"upload": 0, "download": 0, "total": 0, "expire": 0}
    if not nodes:
        _CACHE[parent_id] = (now, empty)
        return dict(empty)

    by_server: dict[str, tuple[Any, set[str]]] = {}
    for node in nodes:
        uri = (node.get("uri") or "").strip()
        uid = _uuid_from_uri(uri)
        if not uid:
            continue
        host = node.get("host") or _host_from_uri(uri)
        server = _server_for_host(str(host) if host else None)
        if not server:
            continue
        sid = server.id
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
    _CACHE[parent_id] = (now, info)
    return dict(info)


def invalidate_catalog_usage_cache(parent_id: str | None = None) -> None:
    if parent_id:
        _CACHE.pop(parent_id, None)
    else:
        _CACHE.clear()
