"""Ban users and remove their VPN keys from the panel."""
from __future__ import annotations

import logging

import config
import database as db
from vps.panel_client import PanelClient, PanelError
from vpn_servers import get_default_server, get_server

logger = logging.getLogger(__name__)


async def remove_user_vpn_keys(user_id: int) -> tuple[int, int]:
    """Delete panel clients for a user. Returns (removed_count, panel_failures)."""
    subs = await db.get_subscriptions_with_panel(user_id)
    if not subs:
        return 0, 0

    if config.DEV_MOCK_VPN:
        return len(subs), 0

    removed = 0
    failures = 0
    for sub in subs:
        email = sub.get("panel_email")
        uuid = sub.get("vless_uuid")
        if not email or not uuid:
            continue
        server = get_server(sub.get("server_id")) or get_default_server()
        if not server.panel_url:
            failures += 1
            continue
        client = PanelClient(server)
        try:
            if await client.delete_client(email, uuid):
                removed += 1
            else:
                failures += 1
        except PanelError:
            logger.exception("Failed to delete panel client %s on %s", email, server.id)
            failures += 1
        finally:
            await client.close()

    return removed, failures


async def ban_user(telegram_id: int) -> tuple[int, int]:
    """Ban user, deactivate subscriptions, and delete panel keys."""
    target = await db.get_user_by_telegram_id(telegram_id)
    if not target:
        return 0, 0

    removed, failures = await remove_user_vpn_keys(target["id"])
    await db.deactivate_all_user_subscriptions(target["id"])
    await db.set_user_banned(telegram_id, True)
    return removed, failures
