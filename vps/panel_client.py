"""3x-ui panel API client for auto VLESS provisioning."""
from __future__ import annotations

import json
import uuid
from typing import Any
from urllib.parse import quote, urlencode

import httpx

import config
from vpn_servers import VpnServer, get_default_server, get_free_keys_server, get_server


class PanelError(Exception):
    pass


class PanelClient:
    """Minimal 3x-ui API wrapper for adding VLESS clients."""

    def __init__(self, server: VpnServer | None = None) -> None:
        self.server = server or get_default_server()
        if not self.server.panel_url:
            raise PanelError(
                f"Panel URL is not configured for server {self.server.id!r}"
            )
        self.base = self.server.panel_url
        self._client = httpx.AsyncClient(
            timeout=30.0, verify=self.server.panel_verify_ssl
        )
        self._logged_in = False

    async def close(self) -> None:
        await self._client.aclose()

    async def login(self) -> None:
        resp = await self._client.post(
            f"{self.base}/login",
            data={
                "username": self.server.panel_username,
                "password": self.server.panel_password,
            },
        )
        if resp.status_code != 200:
            raise PanelError(f"Panel login failed: {resp.status_code}")
        body = resp.json()
        if not body.get("success"):
            raise PanelError(f"Panel login failed: {body.get('msg', 'unknown')}")
        self._logged_in = True

    async def _ensure_login(self) -> None:
        if not self._logged_in:
            await self.login()

    async def get_inbound(self, inbound_id: int | None = None) -> dict[str, Any]:
        await self._ensure_login()
        iid = inbound_id or self.server.panel_inbound_id
        resp = await self._client.get(f"{self.base}/panel/api/inbounds/get/{iid}")
        body = resp.json()
        if not body.get("success"):
            raise PanelError(f"get inbound failed: {body.get('msg')}")
        return body["obj"]

    async def add_client(
        self,
        telegram_id: int,
        data_limit_gb: float,
        expiry_days: int,
    ) -> tuple[str, str, str]:
        inbound = await self.get_inbound()
        settings = json.loads(inbound["settings"])
        stream = json.loads(inbound["streamSettings"])

        client_uuid = str(uuid.uuid4())
        email = f"tg_{telegram_id}_{client_uuid[:8]}"
        total_bytes = int(data_limit_gb * 1024**3)

        from datetime import datetime, timedelta, timezone

        expiry_ms = int(
            (datetime.now(timezone.utc) + timedelta(days=expiry_days)).timestamp() * 1000
        )

        flow = (
            self.server.vless_flow
            if self.server.vless_security == "reality"
            else ""
        )
        new_client = {
            "id": client_uuid,
            "email": email,
            "enable": True,
            "expiryTime": expiry_ms,
            "totalGB": total_bytes,
            "limitIp": 2,
            "flow": flow,
        }

        clients = settings.get("clients", [])
        clients.append(new_client)
        settings["clients"] = clients

        payload = {
            "id": inbound["id"],
            "settings": json.dumps(settings),
            "streamSettings": inbound["streamSettings"],
            "sniffing": inbound.get("sniffing", "{}"),
            "remark": inbound.get("remark", ""),
            "enable": inbound.get("enable", True),
            "expiryTime": inbound.get("expiryTime", 0),
            "listen": inbound.get("listen", ""),
            "port": inbound["port"],
            "protocol": inbound["protocol"],
            "tag": inbound.get("tag", ""),
        }

        resp = await self._client.post(
            f"{self.base}/panel/api/inbounds/update/{inbound['id']}",
            json=payload,
        )
        body = resp.json()
        if not body.get("success"):
            raise PanelError(f"add client failed: {body.get('msg')}")

        vless_key = build_vless_url(
            uuid=client_uuid,
            host=self.server.vps_host,
            port=self.server.vps_port or inbound["port"],
            remark=f"AirVPN-{telegram_id}",
            stream=stream,
            server=self.server,
        )
        return client_uuid, email, vless_key

    async def add_or_update_client(
        self,
        email: str,
        telegram_id: int,
        total_bytes: int,
        expiry_days: int,
        remark: str | None = None,
    ) -> tuple[str, str, str]:
        inbound = await self.get_inbound()
        settings = json.loads(inbound["settings"])
        stream = json.loads(inbound["streamSettings"])
        clients: list[dict] = settings.get("clients", [])

        from datetime import datetime, timedelta, timezone

        expiry_ms = int(
            (datetime.now(timezone.utc) + timedelta(days=expiry_days)).timestamp() * 1000
        )
        tag = remark or f"AirVPN-Free-{telegram_id}"
        flow = (
            self.server.vless_flow
            if self.server.vless_security == "reality"
            else ""
        )

        existing = next((c for c in clients if c.get("email") == email), None)
        if existing:
            existing["totalGB"] = total_bytes
            existing["expiryTime"] = expiry_ms
            existing["enable"] = True
            client_uuid = existing["id"]
        else:
            client_uuid = str(uuid.uuid4())
            clients.append(
                {
                    "id": client_uuid,
                    "email": email,
                    "enable": True,
                    "expiryTime": expiry_ms,
                    "totalGB": total_bytes,
                    "limitIp": 2,
                    "flow": flow,
                }
            )

        settings["clients"] = clients
        payload = {
            "id": inbound["id"],
            "settings": json.dumps(settings),
            "streamSettings": inbound["streamSettings"],
            "sniffing": inbound.get("sniffing", "{}"),
            "remark": inbound.get("remark", ""),
            "enable": inbound.get("enable", True),
            "expiryTime": inbound.get("expiryTime", 0),
            "listen": inbound.get("listen", ""),
            "port": inbound["port"],
            "protocol": inbound["protocol"],
            "tag": inbound.get("tag", ""),
        }

        resp = await self._client.post(
            f"{self.base}/panel/api/inbounds/update/{inbound['id']}",
            json=payload,
        )
        body = resp.json()
        if not body.get("success"):
            raise PanelError(f"update client failed: {body.get('msg')}")

        vless_key = build_vless_url(
            uuid=client_uuid,
            host=self.server.vps_host,
            port=self.server.vps_port or inbound["port"],
            remark=tag,
            stream=stream,
            server=self.server,
        )
        return client_uuid, email, vless_key

    async def get_client_traffic_bytes(self, email: str) -> int | None:
        await self._ensure_login()
        encoded = quote(email, safe="")
        resp = await self._client.get(
            f"{self.base}/panel/api/inbounds/getClientTraffics/{encoded}"
        )
        body = resp.json()
        if not body.get("success"):
            return None
        obj = body.get("obj") or {}
        return int(obj.get("up") or 0) + int(obj.get("down") or 0)

    async def delete_client(self, email: str, client_uuid: str) -> bool:
        await self._ensure_login()
        inbound_id = self.server.panel_inbound_id
        resp = await self._client.post(
            f"{self.base}/panel/api/inbounds/{inbound_id}/delClient/{client_uuid}"
        )
        body = resp.json()
        if body.get("success"):
            return True

        inbound = await self.get_inbound()
        settings = json.loads(inbound["settings"])
        clients = settings.get("clients", [])
        filtered = [
            c
            for c in clients
            if c.get("email") != email and c.get("id") != client_uuid
        ]
        if len(filtered) == len(clients):
            return False

        settings["clients"] = filtered
        payload = {
            "id": inbound["id"],
            "settings": json.dumps(settings),
            "streamSettings": inbound["streamSettings"],
            "sniffing": inbound.get("sniffing", "{}"),
            "remark": inbound.get("remark", ""),
            "enable": inbound.get("enable", True),
            "expiryTime": inbound.get("expiryTime", 0),
            "listen": inbound.get("listen", ""),
            "port": inbound["port"],
            "protocol": inbound["protocol"],
            "tag": inbound.get("tag", ""),
        }
        resp = await self._client.post(
            f"{self.base}/panel/api/inbounds/update/{inbound['id']}",
            json=payload,
        )
        body = resp.json()
        return bool(body.get("success"))

    async def get_clients_usage_gb(self, emails: list[str]) -> dict[str, float]:
        if not emails:
            return {}

        wanted = set(emails)
        usage: dict[str, float] = {}

        inbound = await self.get_inbound()
        for stat in inbound.get("clientStats") or []:
            em = stat.get("email")
            if em and em in wanted:
                up = int(stat.get("up") or 0)
                down = int(stat.get("down") or 0)
                usage[em] = (up + down) / (1024**3)

        for email in emails:
            if email in usage:
                continue
            total_bytes = await self.get_client_traffic_bytes(email)
            if total_bytes is not None:
                usage[email] = total_bytes / (1024**3)

        return usage


def build_vless_url(
    uuid: str,
    host: str,
    port: int,
    remark: str,
    stream: dict[str, Any] | None = None,
    server: VpnServer | None = None,
) -> str:
    srv = server or get_default_server()
    params: dict[str, str] = {
        "encryption": "none",
        "type": "tcp",
        "security": srv.vless_security,
    }

    if stream:
        net = stream.get("network", "tcp")
        params["type"] = net
        sec = stream.get("security", srv.vless_security)
        params["security"] = sec

        if sec == "reality":
            rs = stream.get("realitySettings", {})
            params["pbk"] = srv.vless_pbk or rs.get("settings", {}).get("publicKey", "")
            params["fp"] = srv.vless_fp
            params["sni"] = srv.vless_sni or rs.get("serverNames", [""])[0]
            params["sid"] = srv.vless_sid or (rs.get("shortIds") or [""])[0]
            params["spx"] = srv.vless_spx
            if srv.vless_flow:
                params["flow"] = srv.vless_flow
        elif sec == "tls":
            ts = stream.get("tlsSettings", {})
            params["sni"] = srv.vless_sni or ts.get("serverName", host)

    query = urlencode(params)
    tag = quote(remark)
    return f"vless://{uuid}@{host}:{port}?{query}#{tag}"


def _mock_vless(
    telegram_id: int, email: str, remark: str, server: VpnServer | None = None
) -> tuple[str, str, str]:
    srv = server or get_default_server()
    uid = str(uuid.uuid4())
    key = build_vless_url(
        uuid=uid,
        host=srv.vps_host or "your-vps.example.com",
        port=srv.vps_port,
        remark=remark,
        server=srv,
    )
    return uid, email, key


def _use_mock_vpn(server: VpnServer | None = None) -> bool:
    if config.DEV_MOCK_VPN:
        return True
    srv = server or get_default_server()
    if not srv.panel_url or not srv.vps_host:
        raise PanelError(
            f"Server {srv.id!r} is not configured. Set VPN_SERVER_{srv.id}_* in .env "
            "or DEV_MOCK_VPN=true for dev."
        )
    return False


async def provision_vless(
    telegram_id: int,
    data_limit_gb: float,
    expiry_days: int,
    server_id: str | None = None,
) -> tuple[str, str, str]:
    server = get_server(server_id) or get_default_server()
    if _use_mock_vpn(server):
        email = f"tg_{telegram_id}_{uuid.uuid4().hex[:8]}"
        return _mock_vless(telegram_id, email, f"AirVPN-{telegram_id}", server)

    client = PanelClient(server)
    try:
        return await client.add_client(telegram_id, data_limit_gb, expiry_days)
    finally:
        await client.close()


async def provision_free_vless(
    telegram_id: int,
    total_mb: int,
    existing_uuid: str | None = None,
) -> tuple[str, str, str]:
    """Free tier uses FREE_KEYS_LOCATION from .env."""
    server = get_free_keys_server()
    email = f"free_tg_{telegram_id}"
    remark = f"AirVPN-Free-{telegram_id}"
    total_bytes = total_mb * 1024 * 1024
    days = config.FREE_SUB_EXPIRY_DAYS

    if _use_mock_vpn(server):
        uid = existing_uuid or str(uuid.uuid4())
        key = build_vless_url(
            uuid=uid,
            host=server.vps_host or "your-vps.example.com",
            port=server.vps_port,
            remark=remark,
            server=server,
        )
        return uid, email, key

    client = PanelClient(server)
    try:
        return await client.add_or_update_client(
            email=email,
            telegram_id=telegram_id,
            total_bytes=total_bytes,
            expiry_days=days,
            remark=remark,
        )
    finally:
        await client.close()
