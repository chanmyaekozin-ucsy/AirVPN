"""Admin broadcast notifications to bot users."""
from __future__ import annotations

import asyncio
import logging

from telegram import Bot

import database as db
from locales import t
from utils.formatting import md2

logger = logging.getLogger(__name__)


async def broadcast_notification(
    bot: Bot,
    audience: str,
    message: str,
    admin_telegram_id: int,
) -> tuple[int, int, int]:
    """
    Send notification to users. Returns (notification_id, sent_count, failed_count).
    audience: 'all' | 'active'
    """
    targets = await db.get_broadcast_telegram_ids(audience)
    sent = 0
    failed = 0

    for telegram_id in targets:
        user_row = await db.get_or_create_user(telegram_id)
        lang = user_row.get("language") or "my"
        text = t(lang, "user_notification", message=md2(message))
        try:
            await bot.send_message(telegram_id, text)
            sent += 1
        except Exception:
            logger.exception("Notify failed for %s", telegram_id)
            failed += 1
        await asyncio.sleep(0.05)

    notif_id = await db.save_notification(
        audience, message, admin_telegram_id, sent, failed
    )
    return notif_id, sent, failed
