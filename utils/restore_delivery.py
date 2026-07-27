"""Deprecated: restore codes are no longer delivered to users.

Paid access is opened via subscription/key deep links into the AirVPN app.
This module is kept so old imports do not crash; it is a no-op.
"""
from __future__ import annotations

import logging

from telegram import Bot, Message

logger = logging.getLogger(__name__)


async def deliver_restore_code(
    *,
    lang: str,
    user_id: int,
    message: Message | None = None,
    bot: Bot | None = None,
    chat_id: int | None = None,
) -> str | None:
    logger.info(
        "deliver_restore_code skipped for user_id=%s (restore codes retired)",
        user_id,
    )
    return None
