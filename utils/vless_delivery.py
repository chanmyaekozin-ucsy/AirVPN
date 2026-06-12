"""Send VPN subscription links and VLESS keys in Telegram."""
from __future__ import annotations

from telegram import Bot, Message

import config
from locales import t_plain
from services.subscription import user_subscription_url
from utils.formatting import PARSE_MODE


async def deliver_subscription_link(
    *,
    lang: str,
    sub_url: str,
    message: Message | None = None,
    bot: Bot | None = None,
    chat_id: int | None = None,
    prefix_text: str | None = None,
    user_id: int | None = None,
) -> None:
    """Send subscription URL with copy button (shows data/expiry in VPN apps)."""
    if message is None and (bot is None or chat_id is None):
        raise ValueError("Provide message or bot+chat_id")

    from handlers.keyboards import subscription_link_keyboard

    markup = subscription_link_keyboard(lang, sub_url, user_id=user_id)
    header = prefix_text or t_plain(lang, "sub_link_header")

    if message:
        await message.reply_text(
            header, parse_mode=PARSE_MODE, reply_markup=markup
        )
        await message.reply_text(sub_url, parse_mode=None)
    else:
        await bot.send_message(
            chat_id, header, parse_mode=PARSE_MODE, reply_markup=markup
        )
        await bot.send_message(chat_id, sub_url, parse_mode=None)


async def deliver_vpn_access(
    *,
    lang: str,
    user: dict,
    message: Message | None = None,
    bot: Bot | None = None,
    chat_id: int | None = None,
    prefix_text: str | None = None,
    vless_key: str | None = None,
    sub_id: int | None = None,
) -> None:
    """Prefer subscription link; fall back to raw VLESS when sub URL is not configured."""
    sub_url = user_subscription_url(user)
    if sub_url:
        await deliver_subscription_link(
            lang=lang,
            sub_url=sub_url,
            message=message,
            bot=bot,
            chat_id=chat_id,
            prefix_text=prefix_text,
            user_id=user.get("id"),
        )
        return

    if not vless_key:
        return
    await deliver_vless_key(
        lang=lang,
        vless_key=vless_key,
        message=message,
        bot=bot,
        chat_id=chat_id,
        prefix_text=prefix_text,
        sub_id=sub_id,
    )


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
