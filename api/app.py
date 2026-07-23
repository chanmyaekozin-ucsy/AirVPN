"""AirVPN mobile FastAPI application."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import config
import database as db
from api.crypto import encrypt_config_payload, key_fingerprint

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parent.parent
_MOBILE_APP_JSON = _ROOT / "data" / "mobile_app.json"
_ADS_DIR = Path(getattr(config, "MOBILE_ADS_DIR", str(_ROOT / "data" / "ads")))
try:
    _ADS_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

# Simple in-memory rate limit: key -> list of timestamps
_rate: dict[str, list[float]] = defaultdict(list)

# Cache host:port online probes: key -> (online: bool, checked_at: float)
_online_cache: dict[str, tuple[bool, float]] = {}
_ONLINE_TTL_SEC = 45.0
_ONLINE_TIMEOUT_SEC = 1.6


def _rate_ok(key: str, limit: int, window_sec: float) -> bool:
    now = time.time()
    bucket = _rate[key]
    _rate[key] = [t for t in bucket if now - t < window_sec]
    if len(_rate[key]) >= limit:
        return False
    _rate[key].append(now)
    return True


def _client_ip(request: Request) -> str:
    """Best-effort client IP (direct or first X-Forwarded-For hop)."""
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded[:64]
    return request.client.host if request.client else "unknown"


def _require_rate(request: Request, *, kind: str, per_min: int, per_hour: int) -> None:
    ip = _client_ip(request)
    if not _rate_ok(f"{kind}:min:{ip}", per_min, 60) or not _rate_ok(
        f"{kind}:hour:{ip}", per_hour, 3600
    ):
        raise HTTPException(429, "Too many attempts — wait a minute")


def _validate_free_share_uri(uri: str) -> str:
    """Reject oversized / unexpected free share URIs before encrypting."""
    clean = (uri or "").strip()
    if not clean:
        raise HTTPException(503, "Free server not configured")
    max_chars = int(getattr(config, "MOBILE_FREE_CONFIG_MAX_CHARS", 8192) or 8192)
    if len(clean) > max_chars:
        raise HTTPException(503, "Free config invalid")
    low = clean.lower()
    if not (
        low.startswith("vless://")
        or low.startswith("ss://")
    ):
        raise HTTPException(503, "Free config invalid")
    # Block obvious SSRF-style local schemes that should never appear
    if any(x in low for x in ("file:", "javascript:", "data:")):
        raise HTTPException(503, "Free config invalid")
    return clean


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.init_db()
    from api.admin import ensure_admin_seed
    from vpn_servers import ensure_vpn_nodes_seeded

    await ensure_admin_seed()
    try:
        await ensure_vpn_nodes_seeded()
    except Exception:
        logger.exception("VPN node seed on API startup failed")
    yield


app = FastAPI(
    title="AirVPN Mobile API",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

from api.admin import router as admin_router  # noqa: E402

app.include_router(admin_router)

_ADMIN_PACKAGE = "com.airvpn.admin"
# Debug keystore SHA256 (no colons). Override/extend via ADMIN_APP_CERT_SHA256S=AA:BB...,CC:DD...
_DEFAULT_ADMIN_CERT_SHA256 = (
    "B7CE5A7A744A32CC09FA50FAFB565BAC1DDC3E48FEC8EE247C1AE7E4A4E1EA55"
)


def _admin_cert_fingerprints() -> list[str]:
    raw = os.getenv("ADMIN_APP_CERT_SHA256S", "").strip()
    out: list[str] = []
    if raw:
        for part in raw.split(","):
            fp = part.strip().replace(":", "").upper()
            if len(fp) == 64:
                out.append(fp)
    if not out:
        out.append(_DEFAULT_ADMIN_CERT_SHA256)
    # Always include debug fingerprint so sideloaded debug builds can App Link
    if _DEFAULT_ADMIN_CERT_SHA256 not in out:
        out.append(_DEFAULT_ADMIN_CERT_SHA256)
    return out


@app.get("/.well-known/assetlinks.json")
async def digital_asset_links() -> list[dict[str, Any]]:
    """Android App Links verification for Admin login URLs."""
    return [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": _ADMIN_PACKAGE,
                "sha256_cert_fingerprints": _admin_cert_fingerprints(),
            },
        }
    ]


@app.get("/admin/login", response_class=HTMLResponse)
async def admin_app_login_bridge(tid: str = "", code: str = "") -> HTMLResponse:
    """
    HTTPS bridge for Telegram inline buttons (http/https only).
    Opens the Admin app via intent:// / custom scheme. Telegram cannot use
    custom schemes in button URLs, so this page must be deployed on the API host.
    """
    tid_clean = "".join(c for c in (tid or "") if c.isdigit())[:20]
    code_clean = "".join(c for c in (code or "") if c.isdigit())[:12]
    deep = f"airvpn-admin://login?tid={tid_clean}&code={code_clean}"
    # Prefer intent:// so Chrome opens the installed package directly.
    intent = (
        f"intent://login?tid={tid_clean}&code={code_clean}"
        f"#Intent;scheme=airvpn-admin;package={_ADMIN_PACKAGE};end"
    )
    html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>Open AirVPN Admin</title>
<style>
  body {{ font-family: system-ui, -apple-system, sans-serif; background:#F7F9FC; color:#1B2A3A;
         display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; padding:16px; }}
  .box {{ background:#fff; padding:28px 24px; border-radius:16px; max-width:360px; width:100%;
          box-shadow:0 8px 28px rgba(26,83,155,.12); text-align:center; }}
  a.btn {{ display:block; margin-top:16px; padding:14px 18px; background:#1A539B;
           color:#fff !important; text-decoration:none; border-radius:12px; font-weight:600; font-size:16px; }}
  a.btn2 {{ display:block; margin-top:10px; padding:12px 18px; background:#E8F1FB;
           color:#1A539B !important; text-decoration:none; border-radius:12px; font-weight:600; }}
  p {{ color:#5A6B7D; line-height:1.45; margin:8px 0 0; }}
</style>
</head>
<body>
  <div class="box">
    <h1 style="margin:0;font-size:1.25rem;color:#1A539B">AirVPN Admin</h1>
    <p>Tap the button to open the app and sign in.</p>
    <a class="btn" id="openIntent" href="{intent}">Open Admin App</a>
    <a class="btn2" href="{deep}">Try direct link</a>
    <p style="font-size:12px;margin-top:14px">If nothing happens, install AirVPN Admin, then tap again.</p>
  </div>
<script>
(function () {{
  var intent = {intent!r};
  var deep = {deep!r};
  var ua = navigator.userAgent || "";
  function go() {{
    if (/Android/i.test(ua)) {{
      window.location.href = intent;
      setTimeout(function () {{ window.location.href = deep; }}, 700);
    }} else {{
      window.location.href = deep;
    }}
  }}
  go();
  setTimeout(go, 400);
}})();
</script>
</body></html>"""
    return HTMLResponse(
        content=html,
        headers={
            "Cache-Control": "no-store",
            # Help Android App Links association caches refresh after deploy
            "X-Content-Type-Options": "nosniff",
        },
    )


# Local ad creatives: put files in data/ads/ and reference as /ads/filename.png
app.mount("/ads", StaticFiles(directory=str(_ADS_DIR)), name="ads")


class ImportBody(BaseModel):
    code: str = Field(min_length=8, max_length=32)


class ConnectBody(BaseModel):
    server_id: str = Field(min_length=1, max_length=64)


class AnalyticsEventBody(BaseModel):
    event: str = Field(min_length=1, max_length=32)
    device_id: str = Field(min_length=8, max_length=128)
    ad_id: str = Field(default="", max_length=64)
    placement: str = Field(default="", max_length=32)


def _telegram_url() -> str:
    return os.getenv("AIRVPN_TELEGRAM_URL", "https://t.me/airvpn_myanmar_bot").strip()


def _play_url() -> str:
    return os.getenv(
        "AIRVPN_PLAY_URL",
        "https://play.google.com/store/apps/details?id=com.airvpn.app",
    ).strip()


def _buy_bot_url() -> str:
    return os.getenv("AIRVPN_BUY_DEEP_LINK", _telegram_url()).strip()


def _load_mobile_app_file() -> dict[str, Any]:
    """Optional overrides for updates + announcements (data/mobile_app.json)."""
    try:
        if _MOBILE_APP_JSON.is_file():
            return json.loads(_MOBILE_APP_JSON.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("mobile_app.json: %s", exc)
    return {}


def _absolute_ad_image_url(image_url: str, request: Request | None) -> str:
    """Turn /ads/foo.png into a full URL using the request host when possible."""
    url = (image_url or "").strip()
    if not url:
        return ""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    # Relative path under /ads/
    path = url if url.startswith("/") else f"/ads/{url.lstrip('/')}"
    base = os.getenv("MOBILE_API_PUBLIC_BASE", "").rstrip("/")
    if base:
        return f"{base}{path}"
    if request is not None:
        return str(request.base_url).rstrip("/") + path
    return path


def _ad_public(row: dict[str, Any], request: Request | None = None) -> dict[str, Any]:
    return {
        "id": str(row.get("public_id") or row.get("id") or ""),
        "placement": str(row.get("placement") or "banner").lower(),
        "title": str(row.get("title") or ""),
        "image_url": _absolute_ad_image_url(str(row.get("image_url") or ""), request),
        "click_url": str(row.get("click_url") or ""),
        "width": int(row.get("image_width") or row.get("width") or 0),
        "height": int(row.get("image_height") or row.get("height") or 0),
    }


async def _collect_ads(request: Request | None = None) -> list[dict[str, Any]]:
    """DB ads take priority; file ads fill in missing ids."""
    by_id: dict[str, dict[str, Any]] = {}
    file_cfg = _load_mobile_app_file()
    file_ads = file_cfg.get("ads") or []
    if isinstance(file_ads, list):
        for a in file_ads:
            if not a:
                continue
            pub = _ad_public(
                {
                    "public_id": a.get("id"),
                    "placement": a.get("placement"),
                    "title": a.get("title"),
                    "image_url": a.get("image_url"),
                    "click_url": a.get("click_url"),
                    "image_width": a.get("width"),
                    "image_height": a.get("height"),
                },
                request,
            )
            if pub["id"] and pub["image_url"]:
                by_id[pub["id"]] = pub
    try:
        rows = await db.list_mobile_ads(enabled_only=True)
        for row in rows:
            pub = _ad_public(row, request)
            if pub["id"] and pub["image_url"]:
                by_id[pub["id"]] = pub
    except Exception as exc:
        logger.warning("list_mobile_ads: %s", exc)
    return list(by_id.values())


def _endpoint_from_row(row: dict[str, Any]) -> tuple[str, int] | None:
    """Resolve TCP host:port used for up/down probe."""
    uri = (row.get("config_uri") or "").strip()
    if uri:
        low = uri.lower()
        # Subscription feeds are not VPN endpoints — skip probe here.
        if low.startswith("http://") or low.startswith("https://"):
            return None
        try:
            # vless://uuid@host:port?...
            parsed = urlparse(uri)
            if parsed.hostname and parsed.port:
                return parsed.hostname, int(parsed.port)
        except Exception:
            pass
    vpn_sid = (row.get("vpn_server_id") or "").strip()
    if vpn_sid:
        try:
            from vpn_servers import get_server

            srv = get_server(vpn_sid)
            if srv and getattr(srv, "vps_host", None) and getattr(srv, "vps_port", None):
                return str(srv.vps_host), int(srv.vps_port)
        except Exception as exc:
            logger.debug("vpn server lookup failed for %s: %s", vpn_sid, exc)
    return None


async def _cached_free_sub(
    row: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Expand a free catalog row whose config_uri is an http(s) subscription."""
    from services.sub_link import (
        fetch_subscription,
        get_cached_subscription,
        is_subscription_url,
        put_cached_subscription,
    )
    from utils.circuit_breaker import CircuitOpenError

    parent_id = row["public_id"]
    uri = (row.get("config_uri") or "").strip()
    if not is_subscription_url(uri):
        return [], {}

    cached = get_cached_subscription(parent_id)
    if cached is not None:
        return cached

    try:
        nodes, userinfo = await fetch_subscription(
            uri,
            parent_id=parent_id,
            parent_name=row.get("name") or parent_id,
            parent_region=row.get("region") or "",
        )
        # fetch_subscription already caches on success; keep put for older callers
        put_cached_subscription(parent_id, nodes, userinfo)
        return nodes, userinfo
    except CircuitOpenError as exc:
        logger.warning("free sub circuit open for %s: %s", parent_id, exc)
        stale = get_cached_subscription(parent_id, allow_stale=True)
        if stale:
            return stale
        return [], {}
    except Exception as exc:
        logger.warning("free sub fetch failed for %s: %s", parent_id, exc)
        stale = get_cached_subscription(parent_id, allow_stale=True)
        if stale:
            return stale
        return [], {}


async def _cached_free_sub_nodes(row: dict[str, Any]) -> list[dict[str, Any]]:
    nodes, _info = await _cached_free_sub(row)
    return nodes


def _public_from_sub_node(node: dict[str, Any], *, online: bool) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": node["id"],
        "name": node.get("name") or node["id"],
        "region": node.get("region") or "",
        "protocol": node.get("protocol") or "vless",
        "tag": node.get("tag") or "Vless",
        "tier": "free",
        "online": online,
        "parent_id": node.get("parent_id") or "",
        "from_subscription": True,
    }
    host = node.get("host")
    port = int(node.get("port") or 0)
    if host:
        out["host"] = host
    if port > 0:
        out["port"] = port
    return out


def _has_manual_userinfo(row: dict[str, Any]) -> bool:
    return any(
        row.get(k) is not None
        for k in (
            "manual_total_bytes",
            "manual_upload_bytes",
            "manual_download_bytes",
            "manual_expire_at",
        )
    )


def _merge_manual_userinfo(row: dict[str, Any], userinfo: dict[str, Any]) -> dict[str, Any]:
    """
    Merge catalog overrides with live/upstream userinfo.
    Live upload/download win when present; manual total/expire still apply for quota display.
    """
    out = dict(userinfo or {})
    live_up = int(out.get("upload") or 0)
    live_down = int(out.get("download") or 0)
    if live_up == 0 and live_down == 0:
        if row.get("manual_upload_bytes") is not None:
            out["upload"] = int(row.get("manual_upload_bytes") or 0)
        if row.get("manual_download_bytes") is not None:
            out["download"] = int(row.get("manual_download_bytes") or 0)
    if row.get("manual_total_bytes") is not None:
        out["total"] = int(row.get("manual_total_bytes") or 0)
    if row.get("manual_expire_at") is not None:
        out["expire"] = int(row.get("manual_expire_at") or 0)
    return out


def _free_catalog_visible(row: dict[str, Any]) -> bool:
    if row.get("enabled"):
        return True
    return bool(row.get("list_when_disabled")) and (row.get("tier") or "").lower() == "free"


def _free_sub_meta(
    row: dict[str, Any],
    nodes: list[dict[str, Any]],
    userinfo: dict[str, Any],
) -> dict[str, Any]:
    parent_id = row["public_id"]
    info = _merge_manual_userinfo(row, userinfo)
    return {
        "id": parent_id,
        "name": row.get("name") or parent_id,
        "upload": int(info.get("upload") or 0),
        "download": int(info.get("download") or 0),
        "total": int(info.get("total") or 0),
        "expire": int(info.get("expire") or 0),
        "node_count": len(nodes),
    }


async def _free_nodes_and_userinfo(
    row: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any], bool]:
    """
    Resolve free catalog nodes + optional upstream userinfo.
    Returns (nodes, userinfo, as_subscription).
    as_subscription=True → expand to child nodes + free_subscriptions meta.
    """
    from services.catalog_usage import fetch_catalog_nodes_userinfo
    from services.sub_link import (
        is_share_uri,
        is_subscription_url,
        parse_subscription_nodes,
    )

    parent_id = row["public_id"]
    name = row.get("name") or parent_id
    region = row.get("region") or ""
    nodes_text = (row.get("nodes_text") or "").strip()
    uri = (row.get("config_uri") or "").strip()
    manual = _has_manual_userinfo(row)

    if nodes_text:
        nodes = parse_subscription_nodes(
            nodes_text,
            parent_id=parent_id,
            parent_name=name,
            parent_region=region,
        )
        live = await fetch_catalog_nodes_userinfo(parent_id=parent_id, nodes=nodes)
        return nodes, live, True

    if is_subscription_url(uri):
        nodes, userinfo = await _cached_free_sub(row)
        return nodes, userinfo, True

    if is_share_uri(uri):
        nodes = parse_subscription_nodes(
            uri,
            parent_id=parent_id,
            parent_name=name,
            parent_region=region,
        )
        live = await fetch_catalog_nodes_userinfo(parent_id=parent_id, nodes=nodes)
        # Treat as free-sub card when we have manual quota OR live traffic OR multi intent
        if manual or nodes:
            return nodes, live, True
        return [], {}, False

    return [], {}, False


async def _free_publics_for_row(
    row: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """One share URI → one server; sub / manual nodes → nodes + usage meta."""
    nodes, userinfo, as_sub = await _free_nodes_and_userinfo(row)
    if not as_sub:
        return [await _server_public(row)], None

    meta = _free_sub_meta(row, nodes, userinfo)
    if not nodes:
        base = await _server_public(row, online=False)
        base["name"] = f"{row.get('name') or row['public_id']} (sub empty)"
        base["parent_id"] = row["public_id"]
        base["from_subscription"] = True
        return [base], meta

    sample = nodes[:12]

    async def _online_node(n: dict[str, Any]) -> bool:
        host = n.get("host")
        port = int(n.get("port") or 0)
        if not host or port <= 0:
            return True
        return await _probe_tcp(str(host), port)

    flags = await asyncio.gather(*[_online_node(n) for n in sample])
    online_map = {sample[i]["id"]: flags[i] for i in range(len(sample))}
    publics = [
        _public_from_sub_node(n, online=online_map.get(n["id"], True))
        for n in nodes
    ]
    return publics, meta


async def _resolve_free_share_uri(server_id: str) -> tuple[str, str]:
    """
    Resolve free catalog connect target to (share_uri, protocol).
    Supports parent ids (single vless/ss) and parent::node keys (subscription).
    """
    from services.sub_link import is_share_uri, is_subscription_url, split_node_public_id

    parent_id, node_key = split_node_public_id(server_id)
    row = await db.get_mobile_server(parent_id)
    if not row or not _free_catalog_visible(row):
        raise HTTPException(404, "Server not found")
    if (row.get("tier") or "free").lower() != "free":
        raise HTTPException(404, "Server not found")

    nodes_text = (row.get("nodes_text") or "").strip()
    config_uri = (row.get("config_uri") or "").strip()

    if nodes_text or is_subscription_url(config_uri):
        nodes, _userinfo, _as_sub = await _free_nodes_and_userinfo(row)
        if not nodes and is_subscription_url(config_uri):
            # Cache may have rotated — refresh once for remote subs
            from services.sub_link import invalidate_subscription_cache

            invalidate_subscription_cache(parent_id)
            nodes, _, _ = await _free_nodes_and_userinfo(row)
        if not nodes:
            raise HTTPException(503, "Free subscription has no nodes")
        if node_key:
            full_id = f"{parent_id}::{node_key}"
            match = next((n for n in nodes if n["id"] == full_id), None)
            if not match and is_subscription_url(config_uri):
                from services.sub_link import invalidate_subscription_cache

                invalidate_subscription_cache(parent_id)
                nodes, _, _ = await _free_nodes_and_userinfo(row)
                match = next((n for n in nodes if n["id"] == full_id), None)
            if not match:
                raise HTTPException(404, "Subscription node not found — refresh servers")
            return match["uri"], match.get("protocol") or "vless"
        first = nodes[0]
        return first["uri"], first.get("protocol") or "vless"

    if not config_uri:
        raise HTTPException(503, "Free server not configured")
    if not is_share_uri(config_uri) and node_key:
        raise HTTPException(404, "Server not found")
    if not is_share_uri(config_uri):
        raise HTTPException(503, "Free server config must be vless://, ss://, or https:// sub")
    protocol = (row.get("protocol") or "vless").lower()
    if config_uri.lower().startswith("ss://"):
        protocol = "ss"
    return config_uri, protocol

async def _probe_tcp(host: str, port: int) -> bool:
    key = f"{host}:{port}"
    now = time.time()
    cached = _online_cache.get(key)
    if cached and now - cached[1] < _ONLINE_TTL_SEC:
        return cached[0]
    online = False
    try:
        _reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=_ONLINE_TIMEOUT_SEC,
        )
        online = True
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
    except Exception:
        online = False
    _online_cache[key] = (online, now)
    return online


async def _server_online(row: dict[str, Any]) -> bool:
    ep = _endpoint_from_row(row)
    if not ep:
        # No endpoint to probe — treat as online so UI doesn't block incorrectly
        return True
    host, port = ep
    return await _probe_tcp(host, port)


async def _server_public(row: dict[str, Any], *, online: bool | None = None) -> dict[str, Any]:
    protocol = (row.get("protocol") or "vless").lower()
    tag = {"vless": "Vless", "vmess": "Vmess", "ss": "SS", "ssh": "SSH"}.get(
        protocol, protocol.upper()
    )
    if online is None:
        online = await _server_online(row)
    out: dict[str, Any] = {
        "id": row["public_id"],
        "name": row["name"],
        "region": row.get("region") or "",
        "protocol": protocol,
        "tag": tag,
        "tier": row.get("tier") or "free",
        "online": online,
    }
    # Host/port for client-side ping (no full config URI leaked)
    ep = _endpoint_from_row(row)
    if ep:
        out["host"] = ep[0]
        out["port"] = ep[1]
    if out["tier"] == "paid":
        plan = {
            "title": row.get("plan_title"),
            "price_ks": row.get("plan_price_ks"),
            "data_gb": row.get("plan_data_gb"),
            "duration_days": row.get("plan_duration_days"),
        }
        out["plan"] = plan
        out["plans"] = [plan] if plan.get("title") or plan.get("price_ks") else []
        out["buy_url"] = _buy_bot_url()
    return out


async def _paid_from_bot_catalog() -> list[dict[str, Any]]:
    """
    Paid locations + price lists from the Telegram bot (.env VPN_SERVER_*).
    One entry per configured VPN server that has plans.
    """
    try:
        from vpn_servers import list_servers
    except Exception as exc:
        logger.warning("vpn_servers import failed: %s", exc)
        return []

    out: list[dict[str, Any]] = []
    for srv in list_servers():
        if not srv.plans:
            continue
        # Show even if panel not fully configured yet — still advertise pricing
        online = True
        if srv.vps_host and srv.vps_port:
            online = await _probe_tcp(srv.vps_host, int(srv.vps_port))
        region = (srv.id or "").strip().upper()
        if len(region) > 2:
            region = region[:2]
        plans = [
            {
                "title": p.title,
                "price_ks": p.price_ks,
                "data_gb": p.data_gb,
                "duration_days": p.duration_days,
            }
            for p in srv.plans
        ]
        entry: dict[str, Any] = {
            "id": f"paid-{srv.id}",
            "name": srv.name_en or srv.id.upper(),
            "region": region,
            "protocol": "vless",
            "tag": "Vless",
            "tier": "paid",
            "online": online,
            "buy_url": _buy_bot_url(),
            "plans": plans,
            "plan": plans[0] if plans else None,
        }
        if srv.vps_host:
            entry["host"] = srv.vps_host
            entry["port"] = int(srv.vps_port or 443)
        out.append(entry)
    return out


def _profile(user: dict[str, Any], subs: list) -> dict[str, Any]:
    used = sum(float(s.get("data_used_gb") or 0) for s in subs)
    total = sum(
        float(s.get("data_limit_gb") or 0) + float(s.get("bonus_data_mb") or 0) / 1024
        for s in subs
    )
    expire = max((s.get("expires_at") or "") for s in subs) if subs else None
    return {
        "user_id": user["id"],
        "has_paid": any(not s.get("is_free") for s in subs),
        "data_used_gb": round(used, 3),
        "data_limit_gb": round(total, 3),
        "expires_at": expire,
    }


async def _user_from_auth(
    authorization: Optional[str],
    x_restore_code: Optional[str],
) -> Optional[dict[str, Any]]:
    code = None
    if authorization and authorization.lower().startswith("bearer "):
        code = authorization[7:].strip()
    elif x_restore_code:
        code = x_restore_code.strip()
    if not code:
        return None
    user = await db.get_user_by_restore_code(code)
    if user:
        return user
    return await db.get_user_by_sub_token(code)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/sub/{token}")
async def subscription(token: str) -> Response:
    """Per-user subscription URL (same payload as standalone sub_server)."""
    from services.subscription import fetch_user_subscription_payload

    if not config.SUB_ENABLED:
        return Response(status_code=503, content="Subscription service disabled")
    result = await fetch_user_subscription_payload(token)
    if not result:
        return Response(status_code=404, content="Not found")
    body, headers = result
    return Response(content=body, headers=headers)


@app.get("/v1/app/config")
async def app_config(request: Request) -> dict[str, Any]:
    file_cfg = _load_mobile_app_file()
    min_code = int(
        os.getenv(
            "AIRVPN_MIN_VERSION_CODE",
            str(file_cfg.get("min_version_code", 1)),
        )
    )
    latest_code = int(
        os.getenv(
            "AIRVPN_LATEST_VERSION_CODE",
            str(file_cfg.get("latest_version_code", min_code)),
        )
    )
    latest_name = os.getenv(
        "AIRVPN_LATEST_VERSION_NAME",
        str(file_cfg.get("latest_version_name", "1.0.0")),
    ).strip()
    force = os.getenv(
        "AIRVPN_FORCE_UPDATE",
        "true" if file_cfg.get("force_update") else "false",
    ).lower() in ("1", "true", "yes")
    changelog = os.getenv(
        "AIRVPN_CHANGELOG",
        str(file_cfg.get("changelog") or ""),
    ).strip()
    announcements = file_cfg.get("announcements") or []
    if not isinstance(announcements, list):
        announcements = []
    ads = await _collect_ads(request)

    return {
        "min_version_code": min_code,
        "latest_version_code": latest_code,
        "latest_version_name": latest_name,
        "force_update": force,
        "changelog": changelog,
        "telegram_url": _telegram_url(),
        "play_url": _play_url(),
        "buy_url": _buy_bot_url(),
        "privacy_url": os.getenv(
            "AIRVPN_PRIVACY_URL", "https://airvpn.app/privacy"
        ).strip(),
        "maintenance": os.getenv("AIRVPN_MAINTENANCE", "false").lower()
        in ("1", "true", "yes"),
        "config_key_fp": key_fingerprint(),
        "deep_link_scheme": "airvpn",
        "announcements": [
            {
                "id": str(a.get("id") or ""),
                "title": str(a.get("title") or ""),
                "body": str(a.get("body") or ""),
                "level": str(a.get("level") or "info"),
                "dismissible": bool(a.get("dismissible", True)),
                "cta_label": str(a.get("cta_label") or ""),
                "cta_url": str(a.get("cta_url") or ""),
            }
            for a in announcements
            if a and str(a.get("id") or "").strip()
        ],
        "ads": ads,
    }


@app.get("/v1/announcements")
async def announcements(request: Request) -> dict[str, Any]:
    """Dedicated feed (same content as config.announcements)."""
    cfg = await app_config(request)
    return {"announcements": cfg.get("announcements") or []}


@app.get("/v1/ads")
async def ads_feed(request: Request) -> dict[str, Any]:
    """First-party banner + dialog creatives."""
    return {"ads": await _collect_ads(request)}


@app.post("/v1/analytics/event")
async def analytics_event(body: AnalyticsEventBody, request: Request) -> dict[str, Any]:
    """
    Lightweight app analytics.
    - app_open → daily active user (1 count per device per Myanmar day)
    - ad_click → increments ad click counters
    """
    ip = _client_ip(request)
    if not _rate_ok(f"analytics:{ip}", 120, 60):
        raise HTTPException(429, "Too many events")

    event = (body.event or "").strip().lower()
    device_id = (body.device_id or "").strip()
    if not device_id:
        raise HTTPException(400, "device_id required")

    if event in ("app_open", "open", "dau"):
        is_new = await db.record_mobile_dau(device_id)
        return {"ok": True, "event": "app_open", "counted": is_new}

    if event in ("ad_click", "click"):
        ad_id = (body.ad_id or "").strip()
        if not ad_id:
            raise HTTPException(400, "ad_id required")
        await db.record_mobile_ad_click(
            ad_id=ad_id,
            device_id=device_id,
            placement=(body.placement or "").strip(),
        )
        return {"ok": True, "event": "ad_click"}

    raise HTTPException(400, "Unknown event")


@app.get("/v1/servers")
async def servers(request: Request) -> dict[str, Any]:
    _require_rate(
        request,
        kind="servers",
        per_min=int(getattr(config, "MOBILE_RATE_SERVERS_PER_MIN", 20) or 20),
        per_hour=int(getattr(config, "MOBILE_RATE_SERVERS_PER_HOUR", 120) or 120),
    )
    rows = await db.list_mobile_servers(
        enabled_only=True,
        include_list_when_disabled=True,
    )
    free_rows = [r for r in rows if (r.get("tier") or "") == "free"]
    paid_rows = [r for r in rows if (r.get("tier") or "") == "paid"]

    free_results = await asyncio.gather(*[_free_publics_for_row(r) for r in free_rows])
    free: list[dict[str, Any]] = []
    free_subscriptions: list[dict[str, Any]] = []
    for publics, meta in free_results:
        free.extend(publics)
        if meta is not None:
            free_subscriptions.append(meta)

    paid_db = await asyncio.gather(*[_server_public(r) for r in paid_rows])
    # Bot .env catalog is the source of truth for paid locations + price lists
    paid_bot = await _paid_from_bot_catalog()
    bot_ids = {p["id"] for p in paid_bot}
    # Keep any admin ms-paid rows that aren't already covered by bot servers
    paid_extra = [p for p in paid_db if p["id"] not in bot_ids]
    return {
        "free": free,
        "paid": paid_bot + paid_extra,
        "free_subscriptions": free_subscriptions,
    }


@app.post("/v1/import")
async def import_code(body: ImportBody, request: Request) -> dict[str, Any]:
    ip = request.client.host if request.client else "unknown"
    if not _rate_ok(f"import:{ip}", 10, 3600):
        raise HTTPException(429, "Too many attempts")
    user = await db.get_user_by_restore_code(body.code)
    if not user:
        user = await db.get_user_by_sub_token(body.code.strip())
    if not user:
        raise HTTPException(404, "Invalid code")
    subs = await db.get_all_active_subscriptions(user["id"])
    return {
        "token": body.code.strip().replace("-", "").replace(" ", ""),
        "profile": _profile(user, subs),
    }


@app.get("/v1/me")
async def me(
    authorization: Optional[str] = Header(default=None),
    x_restore_code: Optional[str] = Header(default=None, alias="X-Restore-Code"),
) -> dict[str, Any]:
    user = await _user_from_auth(authorization, x_restore_code)
    if not user:
        raise HTTPException(401, "Not activated")
    subs = await db.get_all_active_subscriptions(user["id"])
    return {"profile": _profile(user, subs)}


@app.post("/v1/connect")
async def connect(
    body: ConnectBody,
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_restore_code: Optional[str] = Header(default=None, alias="X-Restore-Code"),
) -> dict[str, Any]:
    from services.sub_link import split_node_public_id

    parent_id, _node_key = split_node_public_id(body.server_id)
    row = await db.get_mobile_server(parent_id)
    if not row:
        raise HTTPException(404, "Server not found")
    tier = (row.get("tier") or "free").lower()
    if tier == "free":
        if not _free_catalog_visible(row):
            raise HTTPException(404, "Server not found")
    elif not row.get("enabled"):
        raise HTTPException(404, "Server not found")
    config_uri: Optional[str] = None
    protocol = (row.get("protocol") or "vless").lower()

    # Paid reconnects stay relatively permissive; free config delivery is tighter.
    if tier == "free":
        _require_rate(
            request,
            kind="connect:free",
            per_min=int(getattr(config, "MOBILE_RATE_CONNECT_FREE_PER_MIN", 10) or 10),
            per_hour=int(
                getattr(config, "MOBILE_RATE_CONNECT_FREE_PER_HOUR", 60) or 60
            ),
        )
    else:
        _require_rate(
            request,
            kind="connect",
            per_min=int(getattr(config, "MOBILE_RATE_CONNECT_PER_MIN", 30) or 30),
            per_hour=int(getattr(config, "MOBILE_RATE_CONNECT_PER_HOUR", 200) or 200),
        )

    if tier == "free":
        config_uri, protocol = await _resolve_free_share_uri(body.server_id)
        config_uri = _validate_free_share_uri(config_uri)
    else:
        # Paid rows use exact public_id (not subscription expansion)
        if body.server_id != parent_id:
            raise HTTPException(404, "Server not found")
        if protocol in ("ssh",):
            raise HTTPException(501, "Protocol not available yet")
        if not await _server_online(row):
            raise HTTPException(503, "Server is currently down")
        user = await _user_from_auth(authorization, x_restore_code)
        if not user:
            raise HTTPException(401, "Import restore code to use paid servers")
        vpn_sid = row.get("vpn_server_id") or ""
        sub = await db.get_active_sub_for_vpn_server(user["id"], vpn_sid)
        if not sub or not sub.get("vless_key"):
            raise HTTPException(
                403,
                "No active paid subscription for this server — buy via Telegram",
            )
        config_uri = sub["vless_key"]

    if protocol in ("ssh", "vmess"):
        raise HTTPException(501, "Protocol not available yet")
    if not config_uri:
        raise HTTPException(503, "Free server not configured")

    payload = encrypt_config_payload(config_uri, ttl_sec=120)
    return {
        "server_id": body.server_id,
        "protocol": protocol,
        "payload": payload,
    }
