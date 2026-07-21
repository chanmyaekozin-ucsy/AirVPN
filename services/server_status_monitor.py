"""Hourly VPN panel / server status — admin DMs only (not the payments group)."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from telegram import Bot

import config
from vpn_servers import list_servers
from vps.panel_client import PanelClient, PanelError

logger = logging.getLogger(__name__)

MMT = timezone(timedelta(hours=6, minutes=30))


async def _check_server(server) -> str:
    label = f"{server.name_en} ({server.id})"
    if not server.is_configured():
        return f"⚠️ {label}: not configured"
    client = PanelClient(server)
    try:
        await client.login()
        await client.get_inbound()
        return f"✅ {label}: OK"
    except PanelError as exc:
        return f"⚠️ {label}: {exc}"
    except Exception as exc:
        return f"⚠️ {label}: {exc}"
    finally:
        await client.close()


async def _notify_admins(bot: Bot, text: str) -> None:
    admins = list(config.ADMIN_TELEGRAM_IDS)
    if not admins:
        logger.warning("ADMIN_TELEGRAM_IDS empty — server status not sent")
        return
    for admin_id in admins:
        try:
            await bot.send_message(admin_id, text)
        except Exception:
            logger.exception("Failed to DM server status to admin %s", admin_id)


async def run_server_status_check(bot: Bot) -> None:
    servers = list_servers()
    now = datetime.now(MMT).strftime("%Y-%m-%d %H:%M:%S MMT")
    lines = [
        "🛰 AirVPN — Server status",
        f"Updated: {now}",
        "",
    ]
    if not servers:
        lines.append("⚠️ No servers in VPN_SERVERS")
    else:
        for server in servers:
            lines.append(await _check_server(server))

    await _notify_admins(bot, "\n".join(lines))


async def server_status_monitor_loop(bot: Bot) -> None:
    interval = max(300, config.SERVER_STATUS_INTERVAL_SEC)
    logger.info(
        "Server status monitor started (every %ss → %s admin DMs)",
        interval,
        len(config.ADMIN_TELEGRAM_IDS),
    )
    await asyncio.sleep(45)
    while True:
        try:
            await run_server_status_check(bot)
        except Exception:
            logger.exception("Server status monitor tick failed")
        await asyncio.sleep(interval)
