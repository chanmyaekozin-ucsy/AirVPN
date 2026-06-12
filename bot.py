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
    build_admin_handlers,
    build_group_payment_handlers,
    build_user_handlers,
)
from utils.security import validate_production_config

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("airvpn")


async def post_init(application: Application) -> None:
    await db.init_db()
    await db.sync_plans_from_env()
    logger.info("Database ready: %s", config.SQLITE_PATH)


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
        .post_init(post_init)
        .build()
    )
    app.add_error_handler(on_error)
    app.add_handler(TypeHandler(Update, _log_update, block=False), group=-1)

    for handler in build_group_payment_handlers():
        app.add_handler(handler, group=-1)
    for handler in build_admin_handlers():
        app.add_handler(handler, group=0)
    for handler in build_user_handlers():
        app.add_handler(handler, group=0)

    logger.info("AirVPN bot starting…")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
