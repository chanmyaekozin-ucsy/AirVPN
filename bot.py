#!/usr/bin/env python3
"""AirVPN — Burmese Telegram VPN bot with daily gifts, KBZPay/WavePay, auto VLESS."""
from __future__ import annotations

import asyncio
import logging
import sys

from telegram import Update
from telegram.ext import Application, Defaults, TypeHandler

from utils.formatting import PARSE_MODE

import config
import database as db
from handlers import (
    build_admin_conversation_handlers,
    build_admin_menu_handlers,
    build_group_payment_handlers,
)
from handlers.user import build_replace_text_handlers, build_user_handlers
from utils.security import validate_production_config

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("airvpn")


async def post_init(application: Application) -> None:
    await db.init_db()
    from vpn_servers import ensure_vpn_nodes_seeded, find_unlisted_server_ids, list_servers

    await ensure_vpn_nodes_seeded()
    await db.sync_plans_from_env()

    active = [s.id for s in list_servers()]
    logger.info("VPN servers active: %s", ", ".join(active) or "(none)")
    unlisted = find_unlisted_server_ids()
    if unlisted:
        logger.warning(
            "Server env config exists but VPN_SERVERS omits: %s",
            ", ".join(unlisted),
        )
    logger.info("Database ready: %s", config.SQLITE_PATH)

    if config.ADMIN_TELEGRAM_IDS:
        from services.server_status_monitor import server_status_monitor_loop

        asyncio.create_task(server_status_monitor_loop(application.bot))
        logger.info(
            "Server status monitor started (every %ss → admin DMs)",
            config.SERVER_STATUS_INTERVAL_SEC,
        )


async def on_error(update: object, context) -> None:
    logger.exception("Unhandled bot error", exc_info=context.error)


async def _log_update(update: Update, context) -> None:
    user = update.effective_user
    uid = user.id if user else "?"
    if update.callback_query:
        logger.info(
            "Update callback_query data=%r user=%s",
            update.callback_query.data,
            uid,
        )
    elif update.message and update.message.text:
        logger.info("Update message text=%r user=%s", update.message.text, uid)


def main() -> None:
    validate_production_config()

    app = (
        Application.builder()
        .token(config.BOT_TOKEN)
        .defaults(Defaults(parse_mode=PARSE_MODE))
        .concurrent_updates(False)
        .post_init(post_init)
        .build()
    )
    app.add_error_handler(on_error)
    app.add_handler(TypeHandler(Update, _log_update, block=False), group=-1)

    for handler in build_group_payment_handlers():
        app.add_handler(handler, group=-1)
    # Admin menu before user handlers so Burmese reply-keyboard taps are not lost.
    for handler in build_admin_menu_handlers():
        app.add_handler(handler, group=0)
    for handler in build_user_handlers():
        app.add_handler(handler, group=0)
    # Separate group so replace flow does not swallow plan / last-5 taps.
    for handler in build_replace_text_handlers():
        app.add_handler(handler, group=1)
    for handler in build_admin_conversation_handlers():
        app.add_handler(handler, group=0)

    logger.info("AirVPN bot starting…")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
