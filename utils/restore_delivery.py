"""Deliver restore codes + Open In AirVPN after paid provision."""
from __future__ import annotations

import logging

from telegram import Bot, Message

import database as db
from locales import t
from utils.formatting import PARSE_MODE

logger = logging.getLogger(__name__)


async def deliver_restore_code(
    *,
    lang: str,
    user_id: int,
    message: Message | None = None,
    bot: Bot | None = None,
    chat_id: int | None = None,
) -> str | None:
    """Issue restore code, send to user with copy + Open In AirVPN. Returns code."""
    if message is None and (bot is None or chat_id is None):
        raise ValueError("Provide message or bot+chat_id")

    from handlers.keyboards import restore_code_keyboard

    try:
        code = await db.issue_restore_code(user_id)
    except Exception:
        logger.exception("Failed to issue restore code for user %s", user_id)
        return None

    body = t(lang, "restore_code_msg", code=code)
    markup = restore_code_keyboard(lang, code)
    if message:
        await message.reply_text(body, parse_mode=PARSE_MODE, reply_markup=markup)
    else:
        await bot.send_message(
            chat_id, body, parse_mode=PARSE_MODE, reply_markup=markup
        )
    return code
