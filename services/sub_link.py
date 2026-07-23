"""Fetch and parse VPN subscription links (base64 / plain vless|ss lines)."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import os
import re
from typing import Any
from urllib.parse import unquote, urlparse

import httpx

from utils.circuit_breaker import CircuitBreakerRegistry, CircuitOpenError

logger = logging.getLogger(__name__)

_NODE_SEP = "::"
_UA = "AirVPN/1.0 (MobileAPI)"
_CACHE_TTL_SEC = float(os.getenv("MOBILE_SUB_CACHE_TTL_SEC", "300"))
_FETCH_MAX_CONCURRENT = max(1, int(os.getenv("MOBILE_SUB_FETCH_MAX_CONCURRENT", "3")))
_BREAKER_FAILURES = max(1, int(os.getenv("MOBILE_SUB_BREAKER_FAILURES", "5")))
_BREAKER_COOLDOWN = float(os.getenv("MOBILE_SUB_BREAKER_COOLDOWN_SEC", "90"))

# parent_id -> (fetched_at, nodes, userinfo)
_sub_cache: dict[str, tuple[float, list[dict[str, Any]], dict[str, Any]]] = {}
_breakers = CircuitBreakerRegistry(
    failure_threshold=_BREAKER_FAILURES,
    recovery_timeout_sec=_BREAKER_COOLDOWN,
)
_fetch_sem: asyncio.Semaphore | None = None
# parent_id -> in-flight task (singleflight)
_inflight: dict[str, asyncio.Task[tuple[list[dict[str, Any]], dict[str, Any]]]] = {}


def _semaphore() -> asyncio.Semaphore:
    global _fetch_sem
    if _fetch_sem is None:
        _fetch_sem = asyncio.Semaphore(_FETCH_MAX_CONCURRENT)
    return _fetch_sem


def invalidate_subscription_cache(parent_id: str | None = None) -> None:
    if parent_id:
        _sub_cache.pop(parent_id, None)
        _breakers.reset(parent_id)
        task = _inflight.pop(parent_id, None)
        if task and not task.done():
            task.cancel()
    else:
        _sub_cache.clear()
        _breakers.reset()
        for task in list(_inflight.values()):
            if not task.done():
                task.cancel()
        _inflight.clear()


def get_cached_subscription_nodes(
    parent_id: str,
    *,
    allow_stale: bool = False,
) -> list[dict[str, Any]] | None:
    entry = get_cached_subscription(parent_id, allow_stale=allow_stale)
    return None if entry is None else entry[0]


def get_cached_subscription(
    parent_id: str,
    *,
    allow_stale: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    import time

    cached = _sub_cache.get(parent_id)
    if not cached:
        return None
    fetched_at, nodes, userinfo = cached
    if time.time() - fetched_at >= _CACHE_TTL_SEC and not allow_stale:
        return None
    return nodes, userinfo


def put_cached_subscription(
    parent_id: str,
    nodes: list[dict[str, Any]],
    userinfo: dict[str, Any] | None = None,
) -> None:
    import time

    _sub_cache[parent_id] = (time.time(), nodes, userinfo or {})


def put_cached_subscription_nodes(parent_id: str, nodes: list[dict[str, Any]]) -> None:
    put_cached_subscription(parent_id, nodes, {})


def is_subscription_url(uri: str | None) -> bool:
    t = (uri or "").strip().lower()
    return t.startswith("http://") or t.startswith("https://")


def is_share_uri(uri: str | None) -> bool:
    t = (uri or "").strip().lower()
    return (
        t.startswith("vless://")
        or t.startswith("ss://")
        or t.startswith("vmess://")
        or t.startswith("ssh://")
    )


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


def parse_subscription_userinfo(header: str | None) -> dict[str, Any]:
    """
    Parse subscription-userinfo: upload=; download=; total=; expire=
    Bytes are integers; expire is unix seconds.
    """
    if not (header or "").strip():
        return {
            "upload": 0,
            "download": 0,
            "total": 0,
            "expire": 0,
        }
    parts = {}
    for chunk in header.split(";"):
        chunk = chunk.strip()
        if "=" not in chunk:
            continue
        key, value = chunk.split("=", 1)
        parts[key.strip().lower()] = value.strip()
    return {
        "upload": _as_int(parts.get("upload")),
        "download": _as_int(parts.get("download")),
        "total": _as_int(parts.get("total")),
        "expire": _as_int(parts.get("expire")),
    }


def _as_int(value: str | None) -> int:
    if value is None:
        return 0
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return 0


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


async def fetch_subscription(
    url: str,
    *,
    parent_id: str,
    parent_name: str,
    parent_region: str = "",
    timeout: float = 25.0,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Fetch nodes + subscription-userinfo for a free catalog sub link.

    Protections:
    - circuit breaker per parent_id (open → stale cache or CircuitOpenError)
    - singleflight (one in-flight fetch per parent_id)
    - global concurrency semaphore
    """
    clean = (url or "").strip()
    if not is_subscription_url(clean):
        raise ValueError("Not an http(s) subscription URL")

    breaker = _breakers.get(parent_id)
    if not breaker.allow():
        stale = get_cached_subscription(parent_id, allow_stale=True)
        if stale:
            logger.info("sub circuit open for %s — serving stale cache", parent_id)
            return stale
        raise CircuitOpenError(f"Subscription upstream circuit open for {parent_id}")

    existing = _inflight.get(parent_id)
    if existing is not None and not existing.done():
        return await existing

    async def _run() -> tuple[list[dict[str, Any]], dict[str, Any]]:
        async with _semaphore():
            try:
                result = await _fetch_subscription_http(
                    clean,
                    parent_id=parent_id,
                    parent_name=parent_name,
                    parent_region=parent_region,
                    timeout=timeout,
                )
                breaker.record_success()
                put_cached_subscription(parent_id, result[0], result[1])
                return result
            except Exception:
                breaker.record_failure()
                raise

    task = asyncio.create_task(_run())
    _inflight[parent_id] = task
    try:
        return await task
    finally:
        if _inflight.get(parent_id) is task:
            _inflight.pop(parent_id, None)


async def _fetch_subscription_http(
    clean: str,
    *,
    parent_id: str,
    parent_name: str,
    parent_region: str,
    timeout: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        headers={"User-Agent": _UA, "Accept": "*/*"},
    ) as client:
        resp = await client.get(clean)
        resp.raise_for_status()
        if len(resp.content) > 2 * 1024 * 1024:
            raise ValueError("Subscription body too large")
        text = _decode_body(resp.content)
        header = (
            resp.headers.get("subscription-userinfo")
            or resp.headers.get("Subscription-Userinfo")
            or ""
        )
        userinfo = parse_subscription_userinfo(header)
    nodes = parse_subscription_nodes(
        text,
        parent_id=parent_id,
        parent_name=parent_name,
        parent_region=parent_region,
    )
    if not nodes:
        raise ValueError("No vless:// or ss:// nodes in subscription")
    return nodes, userinfo


async def fetch_subscription_nodes(
    url: str,
    *,
    parent_id: str,
    parent_name: str,
    parent_region: str = "",
    timeout: float = 25.0,
) -> list[dict[str, Any]]:
    nodes, _userinfo = await fetch_subscription(
        url,
        parent_id=parent_id,
        parent_name=parent_name,
        parent_region=parent_region,
        timeout=timeout,
    )
    return nodes