"""Sync per-key data usage from the 3x-ui panel."""
from __future__ import annotations

import logging
from collections import defaultdict

import config
from vps.panel_client import PanelClient, PanelError
from vpn_servers import get_default_server, get_server

import database as db

logger = logging.getLogger(__name__)


async def sync_subscriptions_usage(subs: list[dict]) -> list[dict]:
    """Refresh data_used_gb from the panel for each subscription key."""
    if not subs or config.DEV_MOCK_VPN:
        return subs

    by_server: dict[str, list[dict]] = defaultdict(list)
    for sub in subs:
        sid = sub.get("server_id") or "sg"
        if sub.get("panel_email"):
            by_server[sid].append(dict(sub))
        else:
            by_server.setdefault("_local", []).append(dict(sub))

    updated_map: dict[int, dict] = {}

    for server_id, server_subs in by_server.items():
        if server_id == "_local":
            for sub in server_subs:
                updated_map[sub["id"]] = sub
            continue

        server = get_server(server_id) or get_default_server()
        if not server.panel_url:
            for sub in server_subs:
                updated_map[sub["id"]] = sub
            continue

        emails = [s["panel_email"] for s in server_subs if s.get("panel_email")]
        client = PanelClient(server)
        try:
            usage_map = await client.get_clients_usage_gb(emails)
        except PanelError:
            logger.exception("Failed to sync usage from panel %s", server_id)
            for sub in server_subs:
                updated_map[sub["id"]] = sub
            continue
        finally:
            await client.close()

        for sub in server_subs:
            email = sub.get("panel_email")
            if email and email in usage_map:
                used = usage_map[email]
                sub["data_used_gb"] = used
                await db.update_subscription_usage(sub["id"], used)
            updated_map[sub["id"]] = sub

    return [updated_map.get(s["id"], s) for s in subs]
