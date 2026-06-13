"""VPN server locations, panel settings, and plans — loaded from .env."""
from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass, field

import config

_MYANMAR_DIGITS = str.maketrans("၀၁၂၃၄၅၆၇၈၉", "0123456789")
_HYPHEN_RE = re.compile(r"[\u2010-\u2015\u2212\u002d\uFE58\uFE63\uFF0D]+")


def normalize_server_label(text: str) -> str:
    """Normalize reply-keyboard labels (spacing, dashes, Myanmar digits → ASCII)."""
    raw = unicodedata.normalize("NFKC", (text or "").strip())
    raw = raw.translate(_MYANMAR_DIGITS)
    raw = _HYPHEN_RE.sub("-", raw)
    raw = re.sub(r"\s+", " ", raw)
    return raw.strip()


def _labels_match(a: str, b: str) -> bool:
    return normalize_server_label(a) == normalize_server_label(b)


@dataclass(frozen=True)
class VpnPlan:
    title: str
    data_gb: float
    price_ks: int
    duration_days: int
    sort_order: int


@dataclass(frozen=True)
class VpnServer:
    id: str
    name_en: str
    name_my: str
    panel_url: str
    panel_username: str
    panel_password: str
    panel_inbound_id: int
    panel_verify_ssl: bool
    vps_host: str
    vps_port: int
    vless_security: str
    vless_flow: str
    vless_sni: str
    vless_fp: str
    vless_pbk: str
    vless_sid: str
    vless_spx: str
    plans: tuple[VpnPlan, ...] = field(default_factory=tuple)

    def name(self, lang: str) -> str:
        return self.name_my if lang == "my" else self.name_en

    def is_configured(self) -> bool:
        return bool(self.panel_url and self.vps_host)


def _env_bool(key: str, default: bool) -> bool:
    raw = os.getenv(key, "")
    if not raw:
        return default
    return raw.lower() in ("1", "true", "yes")


def _server_env(server_id: str, suffix: str, fallback: str = "") -> str:
    key = f"VPN_SERVER_{server_id}_{suffix}"
    value = os.getenv(key, "").strip()
    if value:
        return value
    return fallback


def _parse_plans(raw: str) -> tuple[VpnPlan, ...]:
    plans: list[VpnPlan] = []
    for entry in raw.split(";"):
        entry = entry.strip()
        if not entry:
            continue
        parts = [p.strip() for p in entry.split("|")]
        if len(parts) < 5:
            continue
        title, data_gb_s, price_s, days_s, order_s = parts[:5]
        try:
            data_gb = float(data_gb_s)
            price_ks = int(price_s)
            sort_order = int(order_s)
        except ValueError:
            continue
        if days_s.lower() in ("unlimited", "unlimited date", "0"):
            duration_days = config.UNLIMITED_PLAN_DAYS
        else:
            try:
                duration_days = int(days_s)
            except ValueError:
                continue
        plans.append(
            VpnPlan(
                title=title,
                data_gb=data_gb,
                price_ks=price_ks,
                duration_days=duration_days,
                sort_order=sort_order,
            )
        )
    plans.sort(key=lambda p: p.sort_order)
    return tuple(plans)


def _load_server(server_id: str) -> VpnServer | None:
    sid = server_id.strip().lower()
    if not sid:
        return None

    name_en = _server_env(sid, "NAME", sid.upper())
    name_my = _server_env(sid, "NAME_MY", name_en)
    plans_raw = _server_env(sid, "PLANS", "")

    # Legacy globals fall back for the default Singapore server.
    legacy = sid == "sg"
    panel_url = _server_env(
        sid, "PANEL_URL", config.PANEL_URL if legacy else ""
    ).rstrip("/")
    panel_username = _server_env(
        sid, "PANEL_USERNAME", config.PANEL_USERNAME if legacy else ""
    )
    panel_password = _server_env(
        sid, "PANEL_PASSWORD", config.PANEL_PASSWORD if legacy else ""
    )
    inbound_raw = _server_env(
        sid, "PANEL_INBOUND_ID", str(config.PANEL_INBOUND_ID) if legacy else "1"
    )
    vps_host = _server_env(sid, "VPS_HOST", config.VPS_HOST if legacy else "")
    vps_port_raw = _server_env(
        sid, "VPS_PORT", str(config.VPS_PORT) if legacy else "443"
    )

    if not plans_raw and legacy:
        plans_raw = os.getenv("VPN_SERVER_sg_PLANS", _default_sg_plans_raw())

    try:
        panel_inbound_id = int(inbound_raw)
        vps_port = int(vps_port_raw)
    except ValueError:
        return None

    plans = _parse_plans(plans_raw) if plans_raw else ()

    return VpnServer(
        id=sid,
        name_en=name_en,
        name_my=name_my,
        panel_url=panel_url,
        panel_username=panel_username,
        panel_password=panel_password,
        panel_inbound_id=panel_inbound_id,
        panel_verify_ssl=_env_bool(
            f"VPN_SERVER_{sid}_PANEL_VERIFY_SSL",
            config.PANEL_VERIFY_SSL if legacy else True,
        ),
        vps_host=vps_host,
        vps_port=vps_port,
        vless_security=_server_env(
            sid, "VLESS_SECURITY", config.VLESS_SECURITY if legacy else "reality"
        ),
        vless_flow=_server_env(
            sid, "VLESS_FLOW", config.VLESS_FLOW if legacy else "xtls-rprx-vision"
        ),
        vless_sni=_server_env(sid, "VLESS_SNI", config.VLESS_SNI if legacy else ""),
        vless_fp=_server_env(sid, "VLESS_FP", config.VLESS_FP if legacy else "chrome"),
        vless_pbk=_server_env(sid, "VLESS_PBK", config.VLESS_PBK if legacy else ""),
        vless_sid=_server_env(sid, "VLESS_SID", config.VLESS_SID if legacy else ""),
        vless_spx=_server_env(sid, "VLESS_SPX", config.VLESS_SPX if legacy else "/"),
        plans=plans,
    )


def _default_sg_plans_raw() -> str:
    return (
        "50 GB - 30 Days|50|2500|30|1;"
        "100 GB - 30 Days|100|4000|30|2;"
        "100 GB - Unlimited Date|100|6000|unlimited|3;"
        "300 GB - Unlimited Date|300|15000|unlimited|4;"
        "1 TB - Unlimited Date|1024|40000|unlimited|5"
    )


def _load_servers() -> dict[str, VpnServer]:
    raw = os.getenv("VPN_SERVERS", "").strip()
    if not raw:
        raw = "sg"
    servers: dict[str, VpnServer] = {}
    for part in raw.split(","):
        server = _load_server(part)
        if server and server.plans:
            servers[server.id] = server
    return servers


_SERVERS: dict[str, VpnServer] = _load_servers()


def reload_servers() -> None:
    global _SERVERS
    _SERVERS = _load_servers()


def list_servers() -> list[VpnServer]:
    raw = os.getenv("VPN_SERVERS", "sg").strip()
    order = [s.strip().lower() for s in raw.split(",") if s.strip()]
    return [_SERVERS[sid] for sid in order if sid in _SERVERS]


def get_server(server_id: str | None) -> VpnServer | None:
    if not server_id:
        return None
    return _SERVERS.get(server_id.strip().lower())


def get_default_server() -> VpnServer:
    servers = list_servers()
    if not servers:
        raise RuntimeError("No VPN servers configured. Set VPN_SERVERS in .env")
    return servers[0]


def get_free_keys_server() -> VpnServer:
    server = get_server(config.FREE_KEYS_LOCATION)
    if server:
        return server
    return get_default_server()


def server_button_label(server: VpnServer, lang: str) -> str:
    return server.name(lang)


def match_server_label(text: str) -> VpnServer | None:
    raw = normalize_server_label(text)
    if not raw:
        return None
    for server in list_servers():
        if _labels_match(raw, server.name_en) or _labels_match(raw, server.name_my):
            return server
    return None
