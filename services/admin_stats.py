"""Real admin dashboard statistics (DB + live panel usage)."""
from __future__ import annotations

import logging
from collections import defaultdict

import config
import database as db
from services.usage_sync import sync_subscriptions_usage
from vpn_servers import get_default_server, get_server, list_servers

logger = logging.getLogger(__name__)


def format_keys_by_server(counts: dict[str, int]) -> str:
    """e.g. SG : 10 | JP : 0 — all configured servers, in VPN_SERVERS order."""
    ordered_ids = [s.id for s in list_servers()]
    for sid in sorted(counts):
        if sid not in ordered_ids:
            ordered_ids.append(sid)
    if not ordered_ids:
        ordered_ids = ["sg"]
    return " | ".join(f"{sid.upper()} : {counts.get(sid, 0)}" for sid in ordered_ids)


async def fetch_admin_stats() -> dict:
    """Return dashboard stats with usage synced from the panel when available."""
    stats = await db.get_admin_dashboard_stats()
    stats["keys_by_server"] = format_keys_by_server(await db.get_active_keys_by_server())
    subs = await db.get_active_panel_subscriptions()
    stats["usage_live"] = False

    if subs and not config.DEV_MOCK_VPN:
        by_server: dict[str, list[dict]] = defaultdict(list)
        for sub in subs:
            by_server[sub.get("server_id") or "sg"].append(sub)

        synced: list[dict] = []
        any_live = False
        for server_id, server_subs in by_server.items():
            server = get_server(server_id) or get_default_server()
            if not server.panel_url:
                synced.extend(server_subs)
                continue
            try:
                synced.extend(await sync_subscriptions_usage(server_subs))
                any_live = True
            except Exception:
                logger.exception("Admin stats usage sync failed for %s", server_id)
                synced.extend(server_subs)

        stats["used_gb"] = sum(float(s.get("data_used_gb") or 0) for s in synced)
        stats["usage_live"] = any_live

    return stats
