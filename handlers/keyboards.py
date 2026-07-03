"""Inline and reply keyboards."""
from __future__ import annotations

import re

from telegram import (
    CopyTextButton,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)
from telegram.ext import filters

import config
from locales import t

MAX_COPY_TEXT = 256

ADMIN_MENU_LABEL = "Admin"
LANG_MY_LABEL = "မြန်မာ"
LANG_EN_LABEL = "English"
ADMIN_USERS_PAGE_SIZE = 10


def resolve_language_choice(text: str | None) -> str | None:
    """Map language picker label (inline or reply keyboard) to locale code."""
    if not text:
        return None
    raw = text.strip()
    if raw in (LANG_MY_LABEL, "မြန်မာ"):
        return "my"
    if raw in (LANG_EN_LABEL, "English"):
        return "en"
    if raw.endswith("မြန်မာ"):
        return "my"
    if raw.endswith("English"):
        return "en"
    return None


def main_menu(
    lang: str, is_admin: bool = False, *, show_daily_gift: bool = True
) -> ReplyKeyboardMarkup:
    if show_daily_gift:
        rows = [
            [t(lang, "menu_daily"), t(lang, "menu_buy")],
        ]
    else:
        rows = [[t(lang, "menu_buy")]]
    rows.extend(
        [
            [t(lang, "menu_my_key"), t(lang, "menu_replace")],
            [t(lang, "menu_download"), t(lang, "menu_support")],
            [t(lang, "menu_lang")],
        ]
    )
    if is_admin:
        rows.append([ADMIN_MENU_LABEL])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True)


def back_cancel(lang: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton(t(lang, "cancel"), callback_data="cancel")]]
    )


def plans_keyboard(lang: str, plans: list) -> InlineKeyboardMarkup:
    buttons = [
        [
            InlineKeyboardButton(
                t(lang, "plan_item", title=p["title"], price=p["price_ks"]),
                callback_data=f"plan_{p['id']}",
            )
        ]
        for p in plans
    ]
    buttons.append([InlineKeyboardButton(t(lang, "back"), callback_data="back_main")])
    return InlineKeyboardMarkup(buttons)


def servers_reply_keyboard(lang: str, servers: list) -> ReplyKeyboardMarkup:
    from vpn_servers import server_button_label

    rows = [[KeyboardButton(server_button_label(s, lang))] for s in servers]
    rows.append([KeyboardButton(t(lang, "back"))])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True, one_time_keyboard=True)


def plans_reply_keyboard(lang: str, plans: list) -> ReplyKeyboardMarkup:
    """Tap-to-select plan buttons (works when inline callbacks fail)."""
    rows = [
        [KeyboardButton(t(lang, "plan_item", title=p["title"], price=p["price_ks"]))]
        for p in plans
    ]
    rows.append([KeyboardButton(t(lang, "back"))])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True, one_time_keyboard=True)


def replace_sub_keyboard(lang: str, subs: list) -> ReplyKeyboardMarkup:
    from vpn_servers import get_server

    rows = []
    for i, sub in enumerate(subs, start=1):
        server = get_server(sub.get("server_id"))
        server_name = (
            server.name(lang) if server else (sub.get("server_id") or "?").upper()
        )
        label = t(
            lang,
            "replace_sub_pick",
            n=i,
            plan=sub.get("plan_title", "VPN"),
            server=server_name,
        )
        rows.append([KeyboardButton(label)])
    rows.append([KeyboardButton(t(lang, "back"))])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True, one_time_keyboard=True)


def replace_server_keyboard(lang: str, servers: list) -> ReplyKeyboardMarkup:
    from vpn_servers import server_button_label

    rows = [[KeyboardButton(server_button_label(s, lang))] for s in servers]
    rows.append([KeyboardButton(t(lang, "back"))])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True, one_time_keyboard=True)


def replace_adjust_keyboard(lang: str, labels: list[str]) -> ReplyKeyboardMarkup:
    rows = [[KeyboardButton(label)] for label in labels]
    rows.append([KeyboardButton(t(lang, "back"))])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True, one_time_keyboard=True)


def payment_methods(lang: str, plan_id: int) -> InlineKeyboardMarkup:
    """Single KBZPay account — kept for back-navigation only."""
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton(t(lang, "back"), callback_data="buy_plan")]]
    )


def payment_accounts(lang: str, plan_id: int, method: str, accounts: list) -> InlineKeyboardMarkup:
    buttons = [
        [
            InlineKeyboardButton(
                f"{a['account_number']} ({a['account_name']})",
                callback_data=f"acct_{a['id']}_{plan_id}",
            )
        ]
        for a in accounts
    ]
    buttons.append(
        [InlineKeyboardButton(t(lang, "back"), callback_data=f"plan_{plan_id}")]
    )
    return InlineKeyboardMarkup(buttons)


def vpn_app_links_keyboard(lang: str) -> InlineKeyboardMarkup:
    """Direct Play Store / App Store links (no bot callback needed)."""
    rows: list[list[InlineKeyboardButton]] = []
    for name, url in config.VPN_APPS_ANDROID:
        if url:
            rows.append([InlineKeyboardButton(name, url=url)])
    for name, url in config.VPN_APPS_IOS:
        if url:
            rows.append([InlineKeyboardButton(name, url=url)])
    return InlineKeyboardMarkup(rows)


def download_platform_keyboard(lang: str) -> InlineKeyboardMarkup:
    """Legacy — prefer vpn_app_links_keyboard."""
    return vpn_app_links_keyboard(lang)


def download_apps_keyboard(lang: str, platform: str) -> InlineKeyboardMarkup:
    """Legacy platform filter — prefer vpn_app_links_keyboard."""
    apps = config.VPN_APPS_ANDROID if platform == "android" else config.VPN_APPS_IOS
    rows = [[InlineKeyboardButton(name, url=url)] for name, url in apps if url]
    return InlineKeyboardMarkup(rows)


def lang_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(LANG_MY_LABEL, callback_data="lang_my"),
                InlineKeyboardButton(LANG_EN_LABEL, callback_data="lang_en"),
            ]
        ]
    )


def lang_reply_keyboard() -> ReplyKeyboardMarkup:
    """Tap-to-select language (works when inline callbacks fail)."""
    return ReplyKeyboardMarkup(
        [[KeyboardButton(LANG_MY_LABEL), KeyboardButton(LANG_EN_LABEL)]],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def payment_list_label(payment: dict) -> str:
    return f"#{payment['id']} — {payment['plan_title']}"


def parse_payment_list_label(text: str) -> int | None:
    match = re.match(r"^#(\d+)\s+—", (text or "").strip())
    return int(match.group(1)) if match else None


def admin_menu(lang: str) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton(t(lang, "admin_pending_payments"))],
            [KeyboardButton(t(lang, "admin_users"))],
            [KeyboardButton(t(lang, "admin_stats"))],
            [KeyboardButton(t(lang, "admin_free_gift"))],
            [KeyboardButton(t(lang, "admin_ban"))],
            [KeyboardButton(t(lang, "admin_notifications"))],
            [KeyboardButton(t(lang, "back"))],
        ],
        resize_keyboard=True,
    )


def admin_free_gift_keyboard(lang: str, *, enabled: bool) -> ReplyKeyboardMarkup:
    toggle_key = (
        "admin_free_gift_disable" if enabled else "admin_free_gift_enable"
    )
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton(t(lang, toggle_key))],
            [KeyboardButton(t(lang, "admin_free_gift_set_mb"))],
            [KeyboardButton(t(lang, "back"))],
        ],
        resize_keyboard=True,
    )


def admin_users_keyboard(
    lang: str, *, page: int, total_pages: int
) -> ReplyKeyboardMarkup:
    nav_row: list[KeyboardButton] = []
    if page > 1:
        nav_row.append(KeyboardButton(t(lang, "admin_users_prev")))
    if page < total_pages:
        nav_row.append(KeyboardButton(t(lang, "admin_users_next")))
    rows: list[list[KeyboardButton]] = []
    if nav_row:
        rows.append(nav_row)
    rows.append([KeyboardButton(t(lang, "back"))])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True)


def parse_admin_users_nav(text: str, lang: str) -> str | None:
    raw = (text or "").strip()
    prev = {
        t(lang, "admin_users_prev"),
        t("my", "admin_users_prev"),
        t("en", "admin_users_prev"),
    }
    nxt = {
        t(lang, "admin_users_next"),
        t("my", "admin_users_next"),
        t("en", "admin_users_next"),
    }
    if raw in prev:
        return "prev"
    if raw in nxt:
        return "next"
    return None


def admin_users_nav_filter():
    labels = {
        t("my", "admin_users_prev"),
        t("en", "admin_users_prev"),
        t("my", "admin_users_next"),
        t("en", "admin_users_next"),
    }
    pattern = "^(" + "|".join(re.escape(label) for label in labels) + ")$"
    return filters.TEXT & filters.Regex(pattern)


def admin_notify_menu(lang: str) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton(t(lang, "admin_notify_send"))],
            [KeyboardButton(t(lang, "admin_notify_history"))],
            [KeyboardButton(t(lang, "back"))],
        ],
        resize_keyboard=True,
    )


def admin_notify_audience(lang: str) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton(t(lang, "admin_notify_all"))],
            [KeyboardButton(t(lang, "admin_notify_active"))],
            [KeyboardButton(t(lang, "back"))],
        ],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def group_proof_actions(payment_id: int) -> InlineKeyboardMarkup:
    """Approve / Reject buttons on payment proof posts in the admin group."""
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("Approve", callback_data=f"proof_ok_{payment_id}"),
                InlineKeyboardButton("Reject", callback_data=f"proof_no_{payment_id}"),
            ],
        ]
    )


def admin_payment_actions(lang: str) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [
                KeyboardButton(t(lang, "admin_approve")),
                KeyboardButton(t(lang, "admin_reject")),
            ],
            [KeyboardButton(t(lang, "back"))],
        ],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def pending_payments_reply(lang: str, payments: list) -> ReplyKeyboardMarkup:
    rows = [
        [KeyboardButton(payment_list_label(p))]
        for p in payments[:20]
    ]
    rows.append([KeyboardButton(t(lang, "back"))])
    return ReplyKeyboardMarkup(rows, resize_keyboard=True, one_time_keyboard=True)


def is_admin(telegram_id: int) -> bool:
    return telegram_id in config.ADMIN_TELEGRAM_IDS


def admin_contact_keyboard(lang: str) -> InlineKeyboardMarkup | None:
    """Admin 1 / Admin 2 … buttons linking to support Telegram accounts."""
    if not config.ADMIN_ACCOUNTS:
        return None
    row: list[InlineKeyboardButton] = []
    buttons: list[list[InlineKeyboardButton]] = []
    for i, username in enumerate(config.ADMIN_ACCOUNTS, start=1):
        row.append(
            InlineKeyboardButton(
                t(lang, "admin_contact_btn", n=i),
                url=f"https://t.me/{username}",
            )
        )
        if len(row) == 2:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    return InlineKeyboardMarkup(buttons)


def admin_contact_reply_kwargs(lang: str) -> dict:
    """Extra reply_text kwargs when admin contact buttons are configured."""
    kb = admin_contact_keyboard(lang)
    return {"reply_markup": kb} if kb else {}


async def main_menu_for(telegram_id: int, lang: str) -> ReplyKeyboardMarkup:
    import database as db

    settings = await db.get_daily_gift_settings()
    return main_menu(
        lang,
        is_admin(telegram_id),
        show_daily_gift=settings["enabled"],
    )


async def restore_main_menu(bot, chat_id: int, lang: str, telegram_id: int) -> None:
    """Re-show the reply keyboard after one-time keyboards or inline-only messages."""
    from utils.formatting import PARSE_MODE

    await bot.send_message(
        chat_id,
        t(lang, "menu_restored"),
        parse_mode=PARSE_MODE,
        reply_markup=await main_menu_for(telegram_id, lang),
    )


def account_copy_keyboard(lang: str, account_number: str) -> InlineKeyboardMarkup:
    """Inline button to copy payment account number to clipboard."""
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    text=t(lang, "account_copy_hint"),
                    copy_text=CopyTextButton(text=account_number),
                )
            ]
        ]
    )


def vless_download_keyboard(lang: str) -> InlineKeyboardMarkup:
    """Store links under the copyable VLESS key message."""
    return vpn_app_links_keyboard(lang)


def subscription_link_keyboard(
    lang: str, sub_url: str, user_id: int | None = None
) -> InlineKeyboardMarkup:
    """Copy subscription URL + VPN app download links (URL never shown in chat)."""
    rows: list[list[InlineKeyboardButton]] = []
    if len(sub_url) <= MAX_COPY_TEXT:
        rows.append(
            [
                InlineKeyboardButton(
                    text=t(lang, "sub_copy_hint"),
                    copy_text=CopyTextButton(text=sub_url),
                )
            ]
        )
    elif user_id is not None:
        rows.append(
            [
                InlineKeyboardButton(
                    text=t(lang, "sub_copy_hint"),
                    callback_data=f"sub_{user_id}",
                )
            ]
        )
    else:
        raise ValueError("subscription link exceeds copy limit; user_id is required")
    rows.extend(vless_download_keyboard(lang).inline_keyboard)
    return InlineKeyboardMarkup(rows)


def vless_key_keyboard(
    lang: str, vless_key: str, sub_id: int | None = None
) -> InlineKeyboardMarkup:
    """Copy button first, then VPN app download links."""
    rows: list[list[InlineKeyboardButton]] = []
    if len(vless_key) <= MAX_COPY_TEXT:
        rows.append(
            [
                InlineKeyboardButton(
                    text=t(lang, "key_copy_hint"),
                    copy_text=CopyTextButton(text=vless_key),
                )
            ]
        )
    elif sub_id is not None:
        rows.append(
            [
                InlineKeyboardButton(
                    text=t(lang, "sub_raw_key_show"),
                    callback_data=f"vk_{sub_id}",
                )
            ]
        )
    rows.extend(vless_download_keyboard(lang).inline_keyboard)
    return InlineKeyboardMarkup(rows)


def vless_copy_keyboard(lang: str, vless_key: str) -> InlineKeyboardMarkup:
    """Legacy alias."""
    return vless_key_keyboard(lang, vless_key)


def raw_vless_key_keyboard(
    lang: str, sub_id: int, vless_key: str
) -> InlineKeyboardMarkup:
    """Per-key copy under subscription flow — real CopyTextButton when Telegram allows."""
    if len(vless_key) <= MAX_COPY_TEXT:
        return InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        text=t(lang, "sub_raw_key_hint"),
                        copy_text=CopyTextButton(text=vless_key),
                    )
                ]
            ]
        )
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    text=t(lang, "sub_raw_key_show"),
                    callback_data=f"vk_{sub_id}",
                )
            ]
        ]
    )
