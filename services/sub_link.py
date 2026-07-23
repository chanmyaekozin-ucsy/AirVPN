"""Fetch and parse VPN subscription links (base64 / plain vless|ss lines)."""
from __future__ import annotations

import base64
import hashlib
import logging
import re
from typing import Any
from urllib.parse import unquote, urlparse

import httpx

logger = logging.getLogger(__name__)

_NODE_SEP = "::"
_UA = "AirVPN/1.0 (MobileAPI)"
_CACHE_TTL_SEC = 300.0
_sub_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def invalidate_subscription_cache(parent_id: str | None = None) -> None:
    if parent_id:
        _sub_cache.pop(parent_id, None)
    else:
        _sub_cache.clear()


def get_cached_subscription_nodes(
    parent_id: str,
    *,
    allow_stale: bool = False,
) -> list[dict[str, Any]] | None:
    import time

    cached = _sub_cache.get(parent_id)
    if not cached:
        return None
    fetched_at, nodes = cached
    if time.time() - fetched_at >= _CACHE_TTL_SEC and not allow_stale:
        return None
    return nodes


def put_cached_subscription_nodes(parent_id: str, nodes: list[dict[str, Any]]) -> None:
    import time

    _sub_cache[parent_id] = (time.time(), nodes)


def is_subscription_url(uri: str | None) -> bool:
    t = (uri or "").strip().lower()
    return t.startswith("http://") or t.startswith("https://")


def is_share_uri(uri: str | None) -> bool:
    t = (uri or "").strip().lower()
    return t.startswith("vless://") or t.startswith("ss://") or t.startswith("vmess://")


def node_public_id(parent_id: str, share_uri: str) -> str:
    digest = hashlib.sha1(share_uri.strip().encode("utf-8")).hexdigest()[:10]
    return f"{parent_id}{_NODE_SEP}{digest}"


def split_node_public_id(server_id: str) -> tuple[str, str | None]:
    """Return (parent_public_id, node_key_or_None)."""
    sid = (server_id or "").strip()
    if _NODE_SEP not in sid:
        return sid, None
    parent, key = sid.split(_NODE_SEP, 1)
    return parent, key or None


def _decode_body(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="ignore").strip()
    lower = text.lower()
    if "vless://" in lower or "ss://" in lower or "vmess://" in lower:
        return text
    compact = re.sub(r"\s+", "", text)
    for decoder in (
        lambda s: base64.b64decode(s + "=" * ((4 - len(s) % 4) % 4)),
        lambda s: base64.urlsafe_b64decode(s + "=" * ((4 - len(s) % 4) % 4)),
    ):
        try:
            decoded = decoder(compact).decode("utf-8", errors="ignore")
            if "://" in decoded:
                return decoded
        except Exception:
            continue
    return text


def _fragment_name(uri: str) -> str:
    try:
        frag = urlparse(uri).fragment
        if frag:
            return unquote(frag).strip()
    except Exception:
        pass
    return ""


def _endpoint(uri: str) -> tuple[str | None, int]:
    try:
        p = urlparse(uri.strip())
        host = p.hostname
        port = int(p.port) if p.port else 0
        if not port and p.scheme.lower() == "ss":
            # ss://method:pass@host:port — port on netloc
            pass
        return host, port
    except Exception:
        return None, 0


def parse_subscription_nodes(
    text: str,
    *,
    parent_id: str,
    parent_name: str,
    parent_region: str = "",
) -> list[dict[str, Any]]:
    """Parse share URIs into node dicts with stable public ids."""
    raw = text or ""
    nodes = _parse_share_lines(
        raw,
        parent_id=parent_id,
        parent_name=parent_name,
        parent_region=parent_region,
    )
    if nodes:
        return nodes
    # Body may still be base64 even if it lacked obvious URI markers
    decoded = _decode_body(raw.encode("utf-8", errors="ignore"))
    if decoded != raw:
        return _parse_share_lines(
            decoded,
            parent_id=parent_id,
            parent_name=parent_name,
            parent_region=parent_region,
        )
    return []


def _parse_share_lines(
    text: str,
    *,
    parent_id: str,
    parent_name: str,
    parent_region: str,
) -> list[dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for line in text.splitlines():
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        candidates = (
            [c for c in re.split(r"\s+", t) if "://" in c]
            if "://" in t
            else [t]
        )
        for c in candidates:
            low = c.lower()
            if not (
                low.startswith("vless://")
                or low.startswith("ss://")
                or low.startswith("vmess://")
            ):
                continue
            # Skip vmess for connect (same as app)
            if low.startswith("vmess://"):
                continue
            host, port = _endpoint(c)
            name = _fragment_name(c) or parent_name
            protocol = "ss" if low.startswith("ss://") else "vless"
            tag = "SS" if protocol == "ss" else "Vless"
            nid = node_public_id(parent_id, c)
            out[nid] = {
                "id": nid,
                "parent_id": parent_id,
                "name": name,
                "region": parent_region or "",
                "protocol": protocol,
                "tag": tag,
                "tier": "free",
                "uri": c.strip(),
                "host": host,
                "port": port or 0,
            }
    return list(out.values())


async def fetch_subscription_nodes(
    url: str,
    *,
    parent_id: str,
    parent_name: str,
    parent_region: str = "",
    timeout: float = 25.0,
) -> list[dict[str, Any]]:
    clean = (url or "").strip()
    if not is_subscription_url(clean):
        raise ValueError("Not an http(s) subscription URL")
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        headers={"User-Agent": _UA, "Accept": "*/*"},
    ) as client:
        resp = await client.get(clean)
        resp.raise_for_status()
        text = _decode_body(resp.content)
    nodes = parse_subscription_nodes(
        text,
        parent_id=parent_id,
        parent_name=parent_name,
        parent_region=parent_region,
    )
    if not nodes:
        raise ValueError("No vless:// or ss:// nodes in subscription")
    return nodes
