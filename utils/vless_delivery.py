"""Send VLESS keys in a format users can copy on all Telegram clients."""
from __future__ import annotations

from telegram import Bot, Message

from locales import t_plain
from utils.formatting import PARSE_MODE


async def deliver_vless_key(
    *,
    lang: str,
    vless_key: str,
    message: Message | None = None,
    bot: Bot | None = None,
    chat_id: int | None = None,
    prefix_text: str | None = None,
    sub_id: int | None = None,
) -> None:
    """
    Send summary (optional) with copy button above the plain-text key.
    Telegram CopyTextButton is limited to 256 chars; long keys use a resend callback.
    """
    if message is None and (bot is None or chat_id is None):
        raise ValueError("Provide message or bot+chat_id")

    from handlers.keyboards import vless_key_keyboard

    markup = vless_key_keyboard(lang, vless_key, sub_id=sub_id)

    if prefix_text:
        if message:
            await message.reply_text(
                prefix_text, parse_mode=PARSE_MODE, reply_markup=markup
            )
        else:
            await bot.send_message(
                chat_id, prefix_text, parse_mode=PARSE_MODE, reply_markup=markup
            )
    else:
        header = t_plain(lang, "key_copy_plain")
        if message:
            await message.reply_text(header, parse_mode=None, reply_markup=markup)
        else:
            await bot.send_message(chat_id, header, parse_mode=None, reply_markup=markup)

    if message:
        await message.reply_text(vless_key, parse_mode=None)
    else:
        await bot.send_message(chat_id, vless_key, parse_mode=None)
