"""Send VPN subscription links and VLESS keys in Telegram."""
from __future__ import annotations

from telegram import Bot, Message

from locales import t_plain
from services.subscription import user_subscription_url
from utils.airvpn_links import resolve_app_download_url
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
    """Send subscription URL with copy + Open In AirVPN (auto-import)."""
    if message is None and (bot is None or chat_id is None):
        raise ValueError("Provide message or bot+chat_id")

    from handlers.keyboards import subscription_link_keyboard

    download_url = await resolve_app_download_url()
    markup = subscription_link_keyboard(
        lang,
        sub_url,
        user_id=user_id,
        download_url=download_url,
    )
    body = prefix_text or t_plain(lang, "sub_link_header")

    if message:
        await message.reply_text(
            body, parse_mode=PARSE_MODE, reply_markup=markup
        )
    else:
        await bot.send_message(
            chat_id, body, parse_mode=PARSE_MODE, reply_markup=markup
        )


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

    from handlers.keyboards import MAX_COPY_TEXT, vless_key_keyboard

    can_copy = len(vless_key) <= MAX_COPY_TEXT
    download_url = await resolve_app_download_url()
    markup = (
        vless_key_keyboard(
            lang,
            vless_key,
            sub_id=sub_id,
            download_url=download_url,
        )
        if can_copy
        else None
    )

    if can_copy:
        body = prefix_text or t_plain(lang, "key_copy_plain")
        if message:
            await message.reply_text(
                body, parse_mode=PARSE_MODE, reply_markup=markup
            )
        else:
            await bot.send_message(
                chat_id, body, parse_mode=PARSE_MODE, reply_markup=markup
            )
        return

    # Reality keys exceed Telegram's 256-char copy limit — show key to long-press copy.
    # Still offer Open In AirVPN when the bridge URL fits Telegram's URL limit.
    header = prefix_text or t_plain(lang, "key_copy_plain")
    body = f"{header}\n\n{vless_key}"
    from handlers.keyboards import vpn_app_links_keyboard

    markup = vpn_app_links_keyboard(
        lang,
        import_payload=vless_key,
        download_url=download_url,
    )
    if message:
        await message.reply_text(body, parse_mode=PARSE_MODE, reply_markup=markup)
    else:
        await bot.send_message(
            chat_id, body, parse_mode=PARSE_MODE, reply_markup=markup
        )
