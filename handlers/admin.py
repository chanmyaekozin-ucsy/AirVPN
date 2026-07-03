"""Admin panel handlers (reply keyboard — works when inline callbacks fail)."""
from __future__ import annotations

import logging
import re

from telegram import Update
from telegram.ext import (
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

import database as db
from handlers.group_payment import reject_payment_from_group
from handlers.keyboards import (
    ADMIN_USERS_PAGE_SIZE,
    admin_menu,
    admin_notify_audience,
    admin_notify_menu,
    admin_payment_actions,
    admin_users_keyboard,
    admin_users_nav_filter,
    is_admin,
    main_menu,
    parse_admin_users_nav,
    parse_payment_list_label,
    payment_list_label,
    pending_payments_reply,
)
from locales import t
from services.admin_stats import fetch_admin_stats
from services.notify import broadcast_notification
from services.payment_approve import approve_and_deliver
from services.user_ban import ban_user
from utils.formatting import PARSE_MODE, md2, md2_code

logger = logging.getLogger(__name__)

REJECT_REASON = 1
NOTIFY_MESSAGE = 2
BAN_USER = 3


def admin_text_filter(text_key: str):
    """Match admin reply-keyboard labels in both languages."""
    from locales import MENU_ALIASES, STRINGS

    labels = {STRINGS[text_key]["my"], STRINGS[text_key]["en"]}
    labels.update(MENU_ALIASES.get(text_key, ()))
    pattern = "^(" + "|".join(re.escape(label) for label in labels) + ")$"
    return filters.TEXT & filters.Regex(pattern)


def _admin_menu_label_pattern() -> str:
    """Regex alternation for every admin reply-keyboard label."""
    from locales import MENU_ALIASES, STRINGS

    keys = (
        "admin_pending_payments",
        "admin_users",
        "admin_stats",
        "admin_ban",
        "admin_notifications",
        "admin_notify_send",
        "admin_notify_history",
        "admin_approve",
        "admin_reject",
        "admin_notify_all",
        "admin_notify_active",
        "admin_users_prev",
        "admin_users_next",
        "back",
    )
    labels: set[str] = set()
    for key in keys:
        if key in STRINGS:
            labels.add(STRINGS[key]["my"])
            labels.add(STRINGS[key]["en"])
        labels.update(MENU_ALIASES.get(key, ()))
    labels.add("Admin")
    return "^(" + "|".join(re.escape(label) for label in labels) + ")$"


def _admin_flow_text_filter():
    """Text input during admin conversations, excluding menu navigation taps."""
    return (
        filters.TEXT
        & ~filters.COMMAND
        & ~filters.Regex(_admin_menu_label_pattern())
        & ~filters.Regex(r"^#\d+\s+—")
    )


async def _lang(update: Update) -> str:
    user = update.effective_user
    if not user:
        return "my"
    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    return row.get("language") or "my"


def _clear_admin_state(context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data.pop("admin_view", None)
    context.user_data.pop("admin_payment_id", None)
    context.user_data.pop("admin_users_page", None)
    context.user_data.pop("notify_audience", None)
    context.user_data.pop("reject_payment_id", None)


async def _admin_guard(update: Update) -> tuple[bool, str]:
    user = update.effective_user
    if not user or not is_admin(user.id):
        lang = await _lang(update)
        if update.message:
            await update.message.reply_text(t(lang, "access_denied"))
        return False, lang
    return True, await _lang(update)


async def admin_show_main(message, lang: str, context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data["admin_view"] = "main"
    context.user_data.pop("admin_payment_id", None)
    await message.reply_text(
        t(lang, "admin_menu"),
        parse_mode=PARSE_MODE,
        reply_markup=admin_menu(lang),
    )


async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return
    _clear_admin_state(context)
    context.user_data.pop("notify_audience", None)
    context.user_data.pop("reject_payment_id", None)
    await admin_show_main(update.message, lang, context)


async def admin_back(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Navigate back within admin submenus, or exit to the user main menu."""
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return

    view = context.user_data.get("admin_view", "main")
    if view == "main":
        _clear_admin_state(context)
        user = update.effective_user
        await update.message.reply_text(
            t(lang, "welcome"),
            parse_mode=PARSE_MODE,
            reply_markup=main_menu(lang, is_admin(user.id)),
        )
        return
    if view == "payment":
        context.user_data.pop("admin_payment_id", None)
        await admin_pending(update, context)
        return
    if view in ("notify_audience", "notify_compose"):
        await admin_notifications_menu(update, context)
        return
    if view == "users":
        await admin_show_main(update.message, lang, context)
        return
    await admin_show_main(update.message, lang, context)


async def admin_pending(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return

    payments = await db.get_pending_payments()
    context.user_data["admin_view"] = "pending"
    context.user_data.pop("admin_payment_id", None)
    if not payments:
        await update.message.reply_text(
            t(lang, "admin_no_pending"),
            reply_markup=admin_menu(lang),
        )
        context.user_data["admin_view"] = "main"
        return

    await update.message.reply_text(
        t(lang, "admin_pending_payments"),
        reply_markup=pending_payments_reply(lang, payments),
    )


def _user_display_name(user: dict) -> str:
    if user.get("username"):
        return f"@{user['username']}"
    return user.get("first_name") or "—"


async def _show_users_page(
    message, lang: str, context: ContextTypes.DEFAULT_TYPE, *, page: int
) -> None:
    result = await db.list_users_with_key_counts(
        page=page, per_page=ADMIN_USERS_PAGE_SIZE
    )
    users = result["users"]
    total = result["total"]
    page = result["page"]
    total_pages = result["total_pages"]
    context.user_data["admin_view"] = "users"
    context.user_data["admin_users_page"] = page

    if total == 0:
        await message.reply_text(
            t(lang, "admin_users_empty"),
            reply_markup=admin_menu(lang),
        )
        context.user_data["admin_view"] = "main"
        return

    lines = [
        t(
            lang,
            "admin_users_header",
            page=page,
            total_pages=total_pages,
            total=total,
        )
    ]
    start_n = (page - 1) * ADMIN_USERS_PAGE_SIZE + 1
    for i, user in enumerate(users, start=start_n):
        ban = t(lang, "admin_users_banned") if user.get("is_banned") else ""
        lines.append(
            t(
                lang,
                "admin_users_row",
                n=i,
                user=md2(_user_display_name(user)),
                telegram_id=md2_code(user["telegram_id"]),
                free=user["free_keys"],
                paid=user["paid_keys"],
                ban=ban,
            )
        )

    await message.reply_text(
        "\n".join(lines),
        parse_mode=PARSE_MODE,
        reply_markup=admin_users_keyboard(
            lang, page=page, total_pages=total_pages
        ),
    )


async def admin_users_view(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return
    await _show_users_page(update.message, lang, context, page=1)


async def admin_users_nav(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return
    if context.user_data.get("admin_view") != "users":
        return

    nav = parse_admin_users_nav(update.message.text or "", lang)
    if not nav:
        return

    page = context.user_data.get("admin_users_page", 1)
    if nav == "prev":
        page = max(1, page - 1)
    else:
        page += 1
    await _show_users_page(update.message, lang, context, page=page)


async def admin_stats_view(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return

    context.user_data["admin_view"] = "main"
    await update.message.reply_text(
        t(lang, "admin_stats_loading"), parse_mode=PARSE_MODE
    )
    stats = await fetch_admin_stats()
    await update.message.reply_text(
        t(
            lang,
            "admin_stats_text",
            used_gb=f"{stats['used_gb']:.2f}",
            limit_gb=f"{stats['limit_gb']:.2f}",
            usage_note=t(
                lang,
                "admin_stats_usage_live"
                if stats.get("usage_live")
                else "admin_stats_usage_cached",
            ),
            **{
                k: v
                for k, v in stats.items()
                if k not in ("used_gb", "limit_gb", "usage_live")
            },
        ),
        parse_mode=PARSE_MODE,
        reply_markup=admin_menu(lang),
    )


async def admin_ban_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return

    context.user_data["admin_view"] = "ban"
    await update.message.reply_text(t(lang, "admin_ban_enter"))


async def admin_notifications_menu(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return

    context.user_data["admin_view"] = "notify"
    await update.message.reply_text(
        t(lang, "admin_notify_menu"),
        parse_mode=PARSE_MODE,
        reply_markup=admin_notify_menu(lang),
    )


async def admin_notify_history_view(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return

    context.user_data["admin_view"] = "notify"
    history = await db.get_recent_notifications(10)
    if not history:
        await update.message.reply_text(
            t(lang, "admin_notify_no_history"),
            reply_markup=admin_notify_menu(lang),
        )
        return

    lines = [
        t(
            lang,
            "admin_notify_history_item",
            id=n["id"],
            audience=n["audience"],
            sent=n["sent_count"],
            failed=n["failed_count"],
            date=n["created_at"][:16],
        )
        for n in history
    ]
    await update.message.reply_text(
        f"{t(lang, 'admin_notify_history')}\n\n" + "\n".join(lines[:10]),
        reply_markup=admin_notify_menu(lang),
    )


async def admin_notify_send_start(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return

    context.user_data["admin_view"] = "notify_audience"
    await update.message.reply_text(
        t(lang, "admin_notify_pick_audience"),
        parse_mode=PARSE_MODE,
        reply_markup=admin_notify_audience(lang),
    )


async def admin_notify_pick_audience(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> int:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return ConversationHandler.END

    text = (update.message.text or "").strip()
    all_labels = {
        t(lang, "admin_notify_all"),
        t("my", "admin_notify_all"),
        t("en", "admin_notify_all"),
    }
    active_labels = {
        t(lang, "admin_notify_active"),
        t("my", "admin_notify_active"),
        t("en", "admin_notify_active"),
    }
    if text in all_labels:
        context.user_data["notify_audience"] = "all"
    elif text in active_labels:
        context.user_data["notify_audience"] = "active"
    else:
        return ConversationHandler.END

    context.user_data["admin_view"] = "notify_compose"
    await update.message.reply_text(t(lang, "admin_notify_enter_message"))
    return NOTIFY_MESSAGE


async def admin_payment_select(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return
    if context.user_data.get("admin_view") != "pending":
        return

    payment_id = parse_payment_list_label(update.message.text or "")
    if payment_id is None:
        return

    payment = await db.get_payment(payment_id)
    if not payment:
        await update.message.reply_text(
            t(lang, "admin_payment_not_found"),
            reply_markup=admin_menu(lang),
        )
        context.user_data["admin_view"] = "main"
        return

    context.user_data["admin_view"] = "payment"
    context.user_data["admin_payment_id"] = payment_id
    user_label = f"{payment.get('first_name')} (@{payment.get('username')})"
    await update.message.reply_text(
        t(
            lang,
            "admin_payment_detail",
            id=payment_id,
            user=md2(user_label),
            plan=md2(payment.get("plan_title")),
            price=payment.get("amount_ks"),
            method=md2(payment.get("method")),
            created=md2(payment.get("created_at", "")[:16]),
        ),
        parse_mode=PARSE_MODE,
        reply_markup=admin_payment_actions(lang),
    )
    if payment.get("receipt_file_id"):
        await update.message.reply_photo(payment["receipt_file_id"])


async def admin_approve_payment(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return
    if context.user_data.get("admin_view") != "payment":
        return

    user = update.effective_user
    payment_id = context.user_data.get("admin_payment_id")
    if not payment_id or not user:
        return

    payment = await db.get_payment(payment_id)
    if not payment or payment["status"] != "pending":
        await update.message.reply_text(
            t(lang, "admin_payment_already_processed"),
            reply_markup=admin_menu(lang),
        )
        context.user_data["admin_view"] = "main"
        return

    ok, msg = await approve_and_deliver(
        update.get_bot(),
        payment_id,
        processed_by=user.id,
        auto=False,
        tx_id=payment.get("receipt_tx_id"),
    )
    if not ok:
        logger.error("Admin approve failed for payment %s: %s", payment_id, msg)
        await update.message.reply_text(
            t(lang, "admin_approve_failed"),
            reply_markup=admin_payment_actions(lang),
        )
        return

    context.user_data["admin_view"] = "main"
    context.user_data.pop("admin_payment_id", None)
    await update.message.reply_text(
        t(lang, "admin_approved_ok"),
        reply_markup=admin_menu(lang),
    )


async def admin_reject_start(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> int:
    ok, lang = await _admin_guard(update)
    if not ok or not update.message:
        return ConversationHandler.END
    if context.user_data.get("admin_view") != "payment":
        return ConversationHandler.END

    payment_id = context.user_data.get("admin_payment_id")
    if not payment_id:
        return ConversationHandler.END

    context.user_data["reject_payment_id"] = payment_id
    context.user_data["admin_view"] = "reject_reason"
    await update.message.reply_text(t(lang, "admin_reject_reason"))
    return REJECT_REASON


async def notify_broadcast_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    user = update.effective_user
    if not user or not is_admin(user.id):
        return ConversationHandler.END
    lang = await _lang(update)
    audience = context.user_data.pop("notify_audience", "all")
    message = (update.message.text or "").strip()
    if not message:
        await update.message.reply_text(t(lang, "admin_notify_enter_message"))
        context.user_data["notify_audience"] = audience
        return NOTIFY_MESSAGE

    _notif_id, sent, failed = await broadcast_notification(
        update.get_bot(), audience, message, user.id
    )
    audience_label = t(
        lang, "admin_notify_all" if audience == "all" else "admin_notify_active"
    )
    context.user_data["admin_view"] = "notify"
    await update.message.reply_text(
        t(
            lang,
            "admin_notify_sent",
            audience=md2(audience_label),
            sent=sent,
            failed=failed,
        ),
        parse_mode=PARSE_MODE,
        reply_markup=admin_notify_menu(lang),
    )
    return ConversationHandler.END


async def notify_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.pop("notify_audience", None)
    lang = await _lang(update)
    if update.message:
        context.user_data["admin_view"] = "notify"
        await update.message.reply_text(
            t(lang, "cancel"),
            reply_markup=admin_notify_menu(lang),
        )
    return ConversationHandler.END


async def ban_user_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    user = update.effective_user
    if not user or not is_admin(user.id):
        return ConversationHandler.END
    lang = await _lang(update)
    raw = (update.message.text or "").strip()
    back_labels = {t(lang, "back"), t("my", "back"), t("en", "back")}
    if raw in back_labels:
        context.user_data["admin_view"] = "main"
        await update.message.reply_text(
            t(lang, "admin_menu"),
            parse_mode=PARSE_MODE,
            reply_markup=admin_menu(lang),
        )
        return ConversationHandler.END
    try:
        telegram_id = int(raw)
    except ValueError:
        await update.message.reply_text(t(lang, "admin_ban_enter"))
        return BAN_USER

    if is_admin(telegram_id):
        context.user_data["admin_view"] = "main"
        await update.message.reply_text(
            t(lang, "admin_ban_admin_denied"),
            reply_markup=admin_menu(lang),
        )
        return ConversationHandler.END

    target = await db.get_user_by_telegram_id(telegram_id)
    if not target:
        context.user_data["admin_view"] = "main"
        await update.message.reply_text(
            t(lang, "admin_ban_not_found"),
            reply_markup=admin_menu(lang),
        )
        return ConversationHandler.END

    was_banned = bool(target["is_banned"])
    context.user_data["admin_view"] = "main"
    if was_banned:
        await db.set_user_banned(telegram_id, False)
        await update.message.reply_text(
            t(lang, "admin_unbanned_ok", telegram_id=telegram_id),
            reply_markup=admin_menu(lang),
        )
    else:
        keys_removed, panel_failures = await ban_user(telegram_id)
        await update.message.reply_text(
            t(
                lang,
                "admin_banned_ok",
                telegram_id=telegram_id,
                keys_removed=keys_removed,
                panel_failures=panel_failures,
            ),
            reply_markup=admin_menu(lang),
        )
    return ConversationHandler.END


async def reject_reason_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    user = update.effective_user
    if not user or not is_admin(user.id):
        return ConversationHandler.END
    lang = await _lang(update)
    payment_id = context.user_data.pop("reject_payment_id", None)
    reason = update.message.text or "—"
    if not payment_id:
        return ConversationHandler.END

    payment = await db.get_payment(payment_id)
    if payment and payment.get("proof_message_id"):
        await reject_payment_from_group(update.get_bot(), payment_id, user.id, reason)
        await update.message.reply_text(f"Payment #{payment_id} rejected.")
    else:
        payment = await db.reject_payment(payment_id, user.id, reason)
        if payment:
            await update.message.reply_text(f"Payment #{payment_id} rejected.")
            user_row = await db.get_or_create_user(payment["telegram_id"])
            u_lang = user_row.get("language", "my")
            try:
                from handlers.keyboards import restore_main_menu

                await update.get_bot().send_message(
                    payment["telegram_id"],
                    t(u_lang, "pay_rejected_user", reason=md2(reason)),
                    parse_mode=PARSE_MODE,
                )
                await restore_main_menu(
                    update.get_bot(),
                    payment["telegram_id"],
                    u_lang,
                    payment["telegram_id"],
                )
            except Exception:
                logger.exception("notify user reject failed")

    context.user_data["admin_view"] = "main"
    context.user_data.pop("admin_payment_id", None)
    if update.message:
        await update.message.reply_text(
            t(lang, "admin_menu"),
            parse_mode=PARSE_MODE,
            reply_markup=admin_menu(lang),
        )
    return ConversationHandler.END


_PAYMENT_LIST = filters.Regex(r"^#\d+\s+—")
_ADMIN_ENTRY = filters.Regex(r"(?i)^admin$")


async def admin_ban_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if context.user_data.get("admin_view") != "ban":
        return
    await ban_user_text(update, context)


async def admin_conv_escape(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Leave an admin conversation when another menu button is tapped."""
    if admin_text_filter("admin_ban").check_update(update):
        await admin_ban_start(update, context)
        return ConversationHandler.END
    await admin_menu_dispatch(update, context)
    return ConversationHandler.END


def build_admin_menu_handlers() -> list:
    """Reply-keyboard admin actions — register before user handlers."""
    return [
        CommandHandler("admin", admin_panel),
        MessageHandler(_ADMIN_ENTRY, admin_panel),
        MessageHandler(
            admin_text_filter("admin_pending_payments"), admin_pending
        ),
        MessageHandler(admin_text_filter("admin_users"), admin_users_view),
        MessageHandler(admin_users_nav_filter(), admin_users_nav),
        MessageHandler(admin_text_filter("admin_stats"), admin_stats_view),
        MessageHandler(
            admin_text_filter("admin_notifications"), admin_notifications_menu
        ),
        MessageHandler(
            admin_text_filter("admin_notify_send"), admin_notify_send_start
        ),
        MessageHandler(
            admin_text_filter("admin_notify_history"), admin_notify_history_view
        ),
        MessageHandler(admin_text_filter("admin_approve"), admin_approve_payment),
        MessageHandler(admin_text_filter("admin_ban"), admin_ban_start),
        MessageHandler(_PAYMENT_LIST, admin_payment_select),
    ]


async def admin_menu_dispatch(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Route a reply-keyboard label to the matching admin handler."""
    if not update.message or not update.message.text:
        return
    text = (update.message.text or "").strip()
    if re.match(r"(?i)^admin$", text):
        await admin_panel(update, context)
        return
    routes: list[tuple[str, object]] = [
        ("admin_pending_payments", admin_pending),
        ("admin_users", admin_users_view),
        ("admin_stats", admin_stats_view),
        ("admin_notifications", admin_notifications_menu),
        ("admin_notify_send", admin_notify_send_start),
        ("admin_notify_history", admin_notify_history_view),
        ("admin_approve", admin_approve_payment),
    ]
    for key, handler in routes:
        if admin_text_filter(key).check_update(update):
            await handler(update, context)
            return
    if admin_users_nav_filter().check_update(update):
        await admin_users_nav(update, context)
        return
    if _PAYMENT_LIST.check_update(update):
        await admin_payment_select(update, context)
        return
    if text in {t("my", "back"), t("en", "back")}:
        await admin_back(update, context)


def build_admin_conversation_handlers() -> list:
    """Multi-step admin flows — register after user handlers."""
    menu_escape = MessageHandler(
        filters.TEXT & ~filters.COMMAND, admin_conv_escape
    )
    reject_conv = ConversationHandler(
        entry_points=[
            MessageHandler(admin_text_filter("admin_reject"), admin_reject_start),
        ],
        states={
            REJECT_REASON: [
                MessageHandler(_admin_flow_text_filter(), reject_reason_text)
            ],
        },
        fallbacks=[CommandHandler("cancel", notify_cancel), menu_escape],
        name="admin_reject",
        per_chat=True,
        per_user=True,
    )

    notify_conv = ConversationHandler(
        entry_points=[
            MessageHandler(
                admin_text_filter("admin_notify_all"), admin_notify_pick_audience
            ),
            MessageHandler(
                admin_text_filter("admin_notify_active"), admin_notify_pick_audience
            ),
        ],
        states={
            NOTIFY_MESSAGE: [
                MessageHandler(_admin_flow_text_filter(), notify_broadcast_text),
            ],
        },
        fallbacks=[CommandHandler("cancel", notify_cancel), menu_escape],
        name="admin_notify",
        per_chat=True,
        per_user=True,
    )

    return [
        reject_conv,
        notify_conv,
        MessageHandler(_admin_flow_text_filter(), admin_ban_input, block=False),
    ]


def build_admin_handlers() -> list:
    return build_admin_menu_handlers() + build_admin_conversation_handlers()
