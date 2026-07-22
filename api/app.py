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
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import database as db
from api.crypto import encrypt_config_payload, key_fingerprint

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parent.parent
_MOBILE_APP_JSON = _ROOT / "data" / "mobile_app.json"
_ADS_DIR = _ROOT / "data" / "ads"
_ADS_DIR.mkdir(parents=True, exist_ok=True)

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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.init_db()
    from api.admin import ensure_admin_seed

    await ensure_admin_seed()
    yield


app = FastAPI(
    title="AirVPN Mobile API",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

from api.admin import router as admin_router  # noqa: E402

app.include_router(admin_router)


@app.get("/admin/login", response_class=HTMLResponse)
async def admin_app_login_bridge(tid: str = "", code: str = "") -> HTMLResponse:
    """
    HTTPS bridge for Telegram inline buttons (http/https only).
    Opens the Admin app via custom scheme + Android intent fallback.
    """
    tid_clean = "".join(c for c in (tid or "") if c.isdigit())[:20]
    code_clean = "".join(c for c in (code or "") if c.isdigit())[:12]
    deep = f"airvpn-admin://login?tid={tid_clean}&code={code_clean}"
    intent = (
        f"intent://login?tid={tid_clean}&code={code_clean}"
        f"#Intent;scheme=airvpn-admin;package=com.airvpn.admin;"
        f"S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.airvpn.admin;end"
    )
    html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Open AirVPN Admin</title>
<style>
  body {{ font-family: system-ui, sans-serif; background:#F7F9FC; color:#1B2A3A;
         display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }}
  .box {{ background:#fff; padding:28px 24px; border-radius:16px; max-width:360px;
          box-shadow:0 8px 28px rgba(26,83,155,.12); text-align:center; }}
  a.btn {{ display:inline-block; margin-top:16px; padding:12px 18px; background:#1A539B;
           color:#fff; text-decoration:none; border-radius:10px; font-weight:600; }}
  p {{ color:#5A6B7D; line-height:1.45; }}
</style>
<script>
  (function () {{
    var deep = {deep!r};
    var intent = {intent!r};
    var ua = navigator.userAgent || "";
    setTimeout(function () {{
      window.location.href = /Android/i.test(ua) ? intent : deep;
    }}, 80);
  }})();
</script>
</head>
<body>
  <div class="box">
    <h1 style="margin:0 0 8px;font-size:1.25rem;color:#1A539B">AirVPN Admin</h1>
    <p>Opening the Admin app…</p>
    <a class="btn" href="{deep}">Open Admin App</a>
  </div>
</body></html>"""
    return HTMLResponse(content=html)


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
    ip = request.client.host if request.client else "unknown"
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
async def servers() -> dict[str, Any]:
    rows = await db.list_mobile_servers(enabled_only=True)
    # Probe in parallel (cached) so list stays snappy
    publics = await asyncio.gather(*[_server_public(r) for r in rows])
    free = [p for p, r in zip(publics, rows) if (r.get("tier") or "") == "free"]
    paid_db = [p for p, r in zip(publics, rows) if (r.get("tier") or "") == "paid"]
    # Bot .env catalog is the source of truth for paid locations + price lists
    paid_bot = await _paid_from_bot_catalog()
    bot_ids = {p["id"] for p in paid_bot}
    # Keep any admin ms-paid rows that aren't already covered by bot servers
    paid_extra = [p for p in paid_db if p["id"] not in bot_ids]
    return {"free": free, "paid": paid_bot + paid_extra}


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
    ip = request.client.host if request.client else "unknown"
    # Allow frequent reconnects while testing; still blocks abuse bursts.
    # 30 / minute and 200 / hour per client IP.
    if not _rate_ok(f"connect:min:{ip}", 30, 60) or not _rate_ok(
        f"connect:hour:{ip}", 200, 3600
    ):
        raise HTTPException(429, "Too many attempts — wait a minute")

    row = await db.get_mobile_server(body.server_id)
    if not row or not row.get("enabled"):
        raise HTTPException(404, "Server not found")

    protocol = (row.get("protocol") or "vless").lower()
    if protocol in ("ssh", "ss"):
        raise HTTPException(501, "Protocol not available yet")

    if not await _server_online(row):
        raise HTTPException(503, "Server is currently down")

    tier = (row.get("tier") or "free").lower()
    config_uri: Optional[str] = None

    if tier == "free":
        config_uri = row.get("config_uri")
        if not config_uri:
            raise HTTPException(503, "Free server not configured")
    else:
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

    payload = encrypt_config_payload(config_uri, ttl_sec=120)
    return {
        "server_id": row["public_id"],
        "protocol": protocol,
        "payload": payload,
    }
