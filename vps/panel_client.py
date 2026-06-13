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

    @staticmethod
    def _parse_json_response(resp: httpx.Response, action: str) -> dict[str, Any]:
        if resp.status_code >= 400:
            raise PanelError(f"{action} failed: HTTP {resp.status_code}")
        try:
            return resp.json()
        except json.JSONDecodeError:
            snippet = (resp.text or "")[:200]
            raise PanelError(f"{action} failed: non-JSON response ({snippet!r})")

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

    async def add_client_with_limits(
        self,
        telegram_id: int,
        total_bytes: int,
        expiry_ms: int,
        remark: str | None = None,
    ) -> tuple[str, str, str]:
        """Create a client with an absolute expiry and byte quota (server migration)."""
        inbound = await self.get_inbound()
        stream = json.loads(inbound["streamSettings"])
        client_uuid = str(uuid.uuid4())
        email = f"tg_{telegram_id}_{client_uuid[:8]}"
        flow = (
            self.server.vless_flow
            if self.server.vless_security == "reality"
            else ""
        )
        client_obj = {
            "id": client_uuid,
            "email": email,
            "enable": True,
            "expiryTime": expiry_ms,
            "totalGB": total_bytes,
            "limitIp": 2,
            "flow": flow,
        }
        if await self.get_client_traffic_record(email):
            await self._clear_stale_email(email)
            client_uuid = str(uuid.uuid4())
            email = f"tg_{telegram_id}_{client_uuid[:8]}"
            client_obj["id"] = client_uuid
            client_obj["email"] = email
        await self._add_client_via_api(inbound["id"], client_obj)
        tag = remark or f"AirVPN-{telegram_id}"
        vless_key = build_vless_url(
            uuid=client_uuid,
            host=self.server.vps_host,
            port=self.server.vps_port or inbound["port"],
            remark=tag,
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
        try:
            return await self._add_or_update_client_once(
                email, telegram_id, total_bytes, expiry_days, remark
            )
        except PanelError as exc:
            if not self._is_duplicate_email_error(str(exc)):
                raise
            await self._clear_stale_email(email)
            return await self._add_or_update_client_once(
                email, telegram_id, total_bytes, expiry_days, remark
            )

    async def _add_or_update_client_once(
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
        client_obj = {
            "id": existing["id"] if existing else str(uuid.uuid4()),
            "email": email,
            "enable": True,
            "expiryTime": expiry_ms,
            "totalGB": total_bytes,
            "limitIp": 2,
            "flow": flow,
        }

        if existing:
            await self._update_client_via_api(inbound["id"], client_obj)
            client_uuid = client_obj["id"]
        else:
            if await self.get_client_traffic_record(email):
                await self._clear_stale_email(email)
                client_obj["id"] = str(uuid.uuid4())
            await self._add_client_via_api(inbound["id"], client_obj)
            client_uuid = client_obj["id"]

        vless_key = build_vless_url(
            uuid=client_uuid,
            host=self.server.vps_host,
            port=self.server.vps_port or inbound["port"],
            remark=tag,
            stream=stream,
            server=self.server,
        )
        return client_uuid, email, vless_key

    async def _add_client_via_api(self, inbound_id: int, client: dict[str, Any]) -> None:
        await self._ensure_login()
        payload = {
            "id": inbound_id,
            "settings": json.dumps({"clients": [client]}),
        }
        resp = await self._client.post(
            f"{self.base}/panel/api/inbounds/addClient",
            data=payload,
        )
        body = self._parse_json_response(resp, "addClient")
        if not body.get("success"):
            raise PanelError(f"addClient failed: {body.get('msg')}")

    async def _update_client_via_api(self, inbound_id: int, client: dict[str, Any]) -> None:
        await self._ensure_login()
        client_uuid = client.get("id")
        if not client_uuid:
            raise PanelError("updateClient failed: missing client id")

        payload = {
            "id": inbound_id,
            "settings": json.dumps({"clients": [client]}),
        }
        encoded_uuid = quote(str(client_uuid), safe="")
        resp = await self._client.post(
            f"{self.base}/panel/api/inbounds/updateClient/{encoded_uuid}",
            data=payload,
        )
        body = self._parse_json_response(resp, "updateClient")
        if body.get("success"):
            return

        # Older panels: fall back to rewriting the inbound client list.
        inbound = await self.get_inbound(inbound_id)
        settings = json.loads(inbound["settings"])
        clients: list[dict] = settings.get("clients", [])
        replaced = False
        for i, existing in enumerate(clients):
            if existing.get("email") == client.get("email") or existing.get("id") == client_uuid:
                clients[i] = client
                replaced = True
                break
        if not replaced:
            clients.append(client)
        await self._save_inbound_clients(inbound, clients)

    async def _save_inbound_clients(
        self, inbound: dict[str, Any], clients: list[dict]
    ) -> None:
        settings = json.loads(inbound["settings"])
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
            raise PanelError(f"update inbound failed: {body.get('msg')}")

    @staticmethod
    def _is_duplicate_email_error(message: str) -> bool:
        lowered = message.lower()
        return "unique constraint" in lowered and "client_traffics.email" in lowered

    async def _clear_stale_email(self, email: str) -> None:
        """Remove panel records for email from inbound JSON and client_traffics."""
        traffic = await self.get_client_traffic_record(email)
        stale_inbound_id = int(traffic["inboundId"]) if traffic and traffic.get("inboundId") else None

        inbound = await self.get_inbound(stale_inbound_id)
        clients = json.loads(inbound["settings"]).get("clients", [])
        filtered = [c for c in clients if c.get("email") != email]
        if len(filtered) != len(clients):
            await self._save_inbound_clients(inbound, filtered)
            inbound = await self.get_inbound(stale_inbound_id)

        delete_inbound_id = stale_inbound_id or self.server.panel_inbound_id
        for stat in inbound.get("clientStats") or []:
            if stat.get("email") != email:
                continue
            uid = stat.get("id") or stat.get("uuid")
            if uid:
                await self.delete_client(email, str(uid), inbound_id=delete_inbound_id)

        await self.delete_client_by_email(email, inbound_id=delete_inbound_id)
        if traffic:
            uid = traffic.get("uuid") or traffic.get("id")
            if uid:
                await self.delete_client(email, str(uid), inbound_id=delete_inbound_id)

        if await self.get_client_traffic_record(email):
            raise PanelError(
                f"Panel still has stale client {email!r}; delete it manually in 3x-ui"
            )

    async def get_client_traffic_record(self, email: str) -> dict[str, Any] | None:
        await self._ensure_login()
        encoded = quote(email, safe="")
        resp = await self._client.get(
            f"{self.base}/panel/api/inbounds/getClientTraffics/{encoded}"
        )
        body = resp.json()
        if not body.get("success"):
            return None
        obj = body.get("obj")
        if isinstance(obj, dict):
            return obj
        if isinstance(obj, list):
            for item in obj:
                if isinstance(item, dict) and item.get("email") == email:
                    return item
            return obj[0] if obj and isinstance(obj[0], dict) else None
        return None

    async def get_client_traffic_bytes(self, email: str) -> int | None:
        record = await self.get_client_traffic_record(email)
        if not record:
            return None
        return int(record.get("up") or 0) + int(record.get("down") or 0)

    async def delete_client_by_email(
        self, email: str, *, inbound_id: int | None = None
    ) -> bool:
        await self._ensure_login()
        iid = inbound_id or self.server.panel_inbound_id
        encoded = quote(email, safe="")
        resp = await self._client.post(
            f"{self.base}/panel/api/inbounds/{iid}/delClientByEmail/{encoded}"
        )
        body = resp.json()
        return bool(body.get("success"))

    async def delete_client(
        self, email: str, client_uuid: str, *, inbound_id: int | None = None
    ) -> bool:
        await self._ensure_login()
        iid = inbound_id or self.server.panel_inbound_id
        resp = await self._client.post(
            f"{self.base}/panel/api/inbounds/{iid}/delClient/{client_uuid}"
        )
        body = resp.json()
        if body.get("success"):
            return True

        inbound = await self.get_inbound(iid)
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


async def provision_migrated_vless(
    telegram_id: int,
    total_bytes: int,
    expiry_ms: int,
    server_id: str,
) -> tuple[str, str, str]:
    """Provision on target server preserving remaining quota and expiry."""
    server = get_server(server_id) or get_default_server()
    remark = f"AirVPN-{telegram_id}"
    if _use_mock_vpn(server):
        email = f"tg_{telegram_id}_{uuid.uuid4().hex[:8]}"
        return _mock_vless(telegram_id, email, remark, server)

    client = PanelClient(server)
    try:
        return await client.add_client_with_limits(
            telegram_id, total_bytes, expiry_ms, remark
        )
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
