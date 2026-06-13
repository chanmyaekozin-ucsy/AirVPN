"""User-facing bot handlers."""
from __future__ import annotations

import asyncio
import logging
import re

from telegram import Update
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import config
import database as db
from handlers.keyboards import (
    account_copy_keyboard,
    admin_contact_reply_kwargs,
    download_apps_keyboard,
    is_admin,
    lang_reply_keyboard,
    main_menu,
    plans_reply_keyboard,
    restore_main_menu,
    servers_reply_keyboard,
    resolve_language_choice,
    vpn_app_links_keyboard,
)
from locales import t, t_plain
from payments.kbz.verify import is_stale_tx_failure
from services.free_vpn import sync_free_vpn_after_claim
from services.kbz_payment import verify_receipt_image, verify_transaction_id
from services.payment_approve import approve_and_deliver
from services.payment_proofs import post_payment_proof, update_payment_proof
from services.usage_sync import sync_subscriptions_usage
from utils.formatting import PARSE_MODE, md2, md2_code
from utils.rate_limit import allow as rate_allow
from utils.security import validate_language
from services.subscription import subscription_limit_gb, user_subscription_url
from utils.vless_delivery import (
    deliver_subscription_link,
    deliver_vless_key,
    deliver_vpn_access,
)

logger = logging.getLogger(__name__)

WAITING_RECEIPT = "waiting_receipt"
WAITING_TX_ID = "waiting_tx_id"
TX_ID_RE = re.compile(r"^\d{10,}$")

# User callbacks (lang_* handled by language_callback).
USER_CALLBACK_PATTERN = (
    r"^(buy_plan|back_main|cancel|copy_vless_key|"
    r"dl_menu|dl_android|dl_ios|dl_android_key|dl_ios_key|"
    r"plan_\d+|acct_\d+_\d+|vk_\d+|sub_\d+)$"
)


def _clear_payment_flow(context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data.pop("pending_payment_id", None)
    context.user_data.pop("payment_state", None)
    context.user_data.pop("buy_server_id", None)


def _clear_buy_flow(context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data.pop("buy_flow", None)
    context.user_data.pop("buy_server_id", None)


def _start_buy_flow(context: ContextTypes.DEFAULT_TYPE) -> None:
    from handlers.key_replacement import clear_replace_flow

    clear_replace_flow(context)
    _clear_payment_flow(context)
    context.user_data["buy_flow"] = True


async def _reply_and_restore_menu(
    update: Update,
    lang: str,
    text: str,
    context: ContextTypes.DEFAULT_TYPE | None = None,
    *,
    clear_payment: bool = True,
    **reply_kwargs,
) -> None:
    """Send a payment/outcome message and bring back the main reply keyboard."""
    user = update.effective_user
    chat = update.effective_chat
    if not user or not chat or not update.message:
        return
    if clear_payment and context is not None:
        _clear_payment_flow(context)
        _clear_buy_flow(context)
    has_inline = bool(reply_kwargs.get("reply_markup"))
    if not has_inline:
        reply_kwargs["reply_markup"] = main_menu(lang, is_admin(user.id))
    await update.message.reply_text(text, parse_mode=PARSE_MODE, **reply_kwargs)
    if has_inline:
        await restore_main_menu(update.get_bot(), chat.id, lang, user.id)


async def _owned_pending_payment(payment_id: int, user_row: dict) -> dict | None:
    payment = await db.get_payment(payment_id)
    if not payment or payment["user_id"] != user_row["id"]:
        return None
    if payment["status"] != "pending":
        return None
    return payment


def _infer_payment_state(payment: dict) -> str:
    if payment.get("receipt_file_id"):
        return WAITING_TX_ID
    if payment.get("verify_status") == "needs_tx_id":
        return WAITING_TX_ID
    return WAITING_RECEIPT


async def _resolve_pending_payment(
    context: ContextTypes.DEFAULT_TYPE, user_row: dict
) -> dict | None:
    """Restore in-memory payment flow from DB when bot restarts or updates split."""
    payment_id = context.user_data.get("pending_payment_id")
    if payment_id:
        payment = await _owned_pending_payment(payment_id, user_row)
        if payment:
            state = context.user_data.get("payment_state")
            if state not in (WAITING_RECEIPT, WAITING_TX_ID):
                context.user_data["payment_state"] = _infer_payment_state(payment)
            return payment

    payment = await db.get_latest_pending_payment(user_row["id"])
    if not payment:
        return None
    context.user_data["pending_payment_id"] = payment["id"]
    context.user_data["payment_state"] = _infer_payment_state(payment)
    return payment


def _sub_key_summary(lang: str, sub: dict, paid_index: int | None) -> str:
    limit_gb = subscription_limit_gb(sub)
    used_gb = md2(f"{sub['data_used_gb']:.2f}")
    limit = md2(f"{limit_gb:.2f}")
    expires = md2(sub["expires_at"][:10])
    if sub.get("is_free"):
        return t(lang, "my_key_free", used_gb=used_gb, limit_gb=limit, expires=expires)
    return t(
        lang,
        "my_key_paid",
        n=paid_index or 1,
        plan=md2(sub["plan_title"]),
        used_gb=used_gb,
        limit_gb=limit,
        expires=expires,
    )


async def _send_all_keys(message, lang: str, subs: list, user_row: dict) -> None:
    sub_url = user_subscription_url(user_row)
    title_key = "my_keys_sub_title" if sub_url else "my_keys_title"
    await message.reply_text(
        t(lang, title_key, count=len(subs)),
        parse_mode=PARSE_MODE,
    )

    if sub_url:
        await deliver_subscription_link(
            message=message,
            lang=lang,
            sub_url=sub_url,
            user_id=user_row["id"],
        )
        await message.reply_text(t(lang, "sub_usage_note"), parse_mode=PARSE_MODE)

    paid_n = 0
    for sub in subs:
        if not sub.get("is_free"):
            paid_n += 1
        prefix = _sub_key_summary(lang, sub, paid_n if not sub.get("is_free") else None)
        if sub_url:
            from handlers.keyboards import raw_vless_key_keyboard

            await message.reply_text(
                prefix,
                parse_mode=PARSE_MODE,
                reply_markup=raw_vless_key_keyboard(
                    lang, sub["id"], sub["vless_key"]
                ),
            )
        else:
            await deliver_vless_key(
                message=message,
                lang=lang,
                vless_key=sub["vless_key"],
                prefix_text=prefix,
                sub_id=sub["id"],
            )


async def _lang(update: Update, context: ContextTypes.DEFAULT_TYPE) -> str:
    user = update.effective_user
    if not user:
        return "my"
    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    return row.get("language") or "my"


async def _guard(update: Update, context: ContextTypes.DEFAULT_TYPE | None = None) -> bool:
    user = update.effective_user
    if not user:
        return False
    if await db.is_banned(user.id):
        lang = await _lang(update, context) if context else "my"
        if update.message:
            await update.message.reply_text(t(lang, "banned"))
        elif update.callback_query:
            await update.callback_query.answer(
                t_plain(lang, "banned"), show_alert=True
            )
        return False
    return True


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    _clear_payment_flow(context)
    _clear_buy_flow(context)
    from handlers.key_replacement import clear_replace_flow

    clear_replace_flow(context)
    user = update.effective_user
    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    lang = row["language"]
    await update.message.reply_text(
        t(lang, "welcome"),
        parse_mode=PARSE_MODE,
        reply_markup=main_menu(lang, is_admin(user.id)),
    )


async def daily_gift(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    user = update.effective_user
    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    lang = row["language"]

    preview = await db.preview_daily_gift(row["id"])
    if preview.get("reason") == "no_user":
        return

    free_sub = await db.get_active_free_subscription(row["id"])
    recovery = (
        not preview["ok"]
        and preview.get("reason") == "already_claimed"
        and not free_sub
    )

    if not preview["ok"] and not recovery:
        await update.message.reply_text(t(lang, "daily_already"))
        return

    mb = preview["mb"]
    streak = preview["streak"]

    vpn = await sync_free_vpn_after_claim(row["id"], user.id, mb)
    if vpn.get("error"):
        await update.message.reply_text(
            t(lang, "daily_key_error"),
            parse_mode=PARSE_MODE,
            **admin_contact_reply_kwargs(lang),
        )
        return

    if not recovery:
        result = await db.claim_daily_gift(row["id"])
        if not result["ok"]:
            await update.message.reply_text(t(lang, "daily_already"))
            return

    if recovery:
        text = t(lang, "daily_key_recovered", mb=mb, streak=streak)
    else:
        text = (
            t(lang, "daily_claimed", mb=mb, streak=streak)
            + "\n\n"
            + t(lang, "daily_free_note")
        )

    has_sub_url = bool(user_subscription_url(row))
    if vpn.get("provisioned") and not has_sub_url:
        text += "\n\n" + t(lang, "daily_free_key")

    await update.message.reply_text(text, parse_mode=PARSE_MODE)
    if vpn.get("provisioned"):
        free_sub = await db.get_active_free_subscription(row["id"])
        await deliver_vpn_access(
            message=update.message,
            lang=lang,
            user=row,
            vless_key=vpn.get("vless_key"),
            sub_id=free_sub["id"] if free_sub else None,
        )


async def my_key(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    user = update.effective_user
    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    lang = row["language"]
    subs = await db.get_all_active_subscriptions(row["id"])
    if not subs:
        await update.message.reply_text(t(lang, "no_subscription"))
        return
    try:
        subs = await asyncio.wait_for(sync_subscriptions_usage(subs), timeout=20.0)
    except asyncio.TimeoutError:
        logger.warning("Usage sync timed out for user %s", row["id"])
    except Exception:
        logger.exception("Usage sync failed for user %s", row["id"])
    await _send_all_keys(update.message, lang, subs, row)


async def download_apps_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    lang = await _lang(update, context)
    await update.message.reply_text(
        t(lang, "download_title"),
        parse_mode=PARSE_MODE,
        reply_markup=vpn_app_links_keyboard(lang),
    )


async def support(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    lang = await _lang(update, context)
    await update.message.reply_text(
        t(lang, "support"), **admin_contact_reply_kwargs(lang)
    )


async def _apply_language(
    message, from_user, new_lang: str, *, edit_message=None
) -> None:
    await db.set_user_language(from_user.id, new_lang)
    text = t(new_lang, "lang_set")
    if edit_message is not None:
        try:
            await edit_message(text)
        except Exception:
            await message.reply_text(text)
    else:
        await message.reply_text(text)
    await message.reply_text(
        t(new_lang, "welcome"),
        parse_mode=PARSE_MODE,
        reply_markup=main_menu(new_lang, is_admin(from_user.id)),
    )


async def language_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    lang = await _lang(update, context)
    await update.message.reply_text(
        t(lang, "lang_picker"), reply_markup=lang_reply_keyboard()
    )


async def language_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    query = update.callback_query
    if not query or not query.data:
        return
    user = update.effective_user
    if not user:
        return
    new_lang = validate_language(query.data.split("_", 1)[1])
    try:
        await query.answer()
    except Exception:
        logger.exception("language callback answer failed")
    await _apply_language(
        query.message,
        user,
        new_lang,
        edit_message=query.edit_message_text,
    )


async def language_text_select(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    if not await _guard(update, context):
        return
    new_lang = resolve_language_choice(update.message.text if update.message else None)
    if not new_lang:
        return
    user = update.effective_user
    if not user:
        return
    await _apply_language(update.message, user, new_lang)


async def back_to_main(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    from handlers.key_replacement import clear_replace_flow

    clear_replace_flow(context)
    if context.user_data.get("buy_flow") and context.user_data.get("buy_server_id"):
        context.user_data.pop("buy_server_id", None)
        from vpn_servers import list_servers

        servers = list_servers()
        lang = await _lang(update, context)
        if len(servers) > 1:
            await update.message.reply_text(
                t(lang, "servers_title"),
                parse_mode=PARSE_MODE,
                reply_markup=servers_reply_keyboard(lang, servers),
            )
            return
    if context.user_data.get("buy_flow"):
        _clear_buy_flow(context)
        user = update.effective_user
        lang = await _lang(update, context)
        await update.message.reply_text(
            t(lang, "welcome"),
            parse_mode=PARSE_MODE,
            reply_markup=main_menu(lang, is_admin(user.id if user else 0)),
        )
        return
    if context.user_data.get("admin_view"):
        from handlers.admin import admin_back

        await admin_back(update, context)
        return
    if context.user_data.get("buy_server_id"):
        context.user_data.pop("buy_server_id", None)
        from vpn_servers import list_servers

        servers = list_servers()
        lang = await _lang(update, context)
        if len(servers) > 1:
            await update.message.reply_text(
                t(lang, "servers_title"),
                parse_mode=PARSE_MODE,
                reply_markup=servers_reply_keyboard(lang, servers),
            )
            return
    _clear_payment_flow(context)
    _clear_buy_flow(context)
    user = update.effective_user
    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    lang = row["language"]
    await update.message.reply_text(
        t(lang, "welcome"),
        parse_mode=PARSE_MODE,
        reply_markup=main_menu(lang, is_admin(user.id)),
    )


async def _show_plans_for_server(message, lang: str, server_id: str) -> None:
    plans = await db.get_active_plans(server_id)
    if not plans:
        await message.reply_text(
            t(lang, "no_plans"), **admin_contact_reply_kwargs(lang)
        )
        return
    from vpn_servers import get_server

    server = get_server(server_id)
    server_name = md2(server.name(lang)) if server else md2(server_id.upper())
    await message.reply_text(
        t(lang, "plans_title_server", server=server_name),
        parse_mode=PARSE_MODE,
        reply_markup=plans_reply_keyboard(lang, plans),
    )


class _ServerLabelFilter(filters.MessageFilter):
    def filter(self, message) -> bool:
        if not message or not message.text:
            return False
        from vpn_servers import match_server_label

        return match_server_label(message.text) is not None


_SERVER_LABEL = _ServerLabelFilter()


async def server_label_select(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Handle reply-keyboard server taps for buy plan and key replacement."""
    if not await _guard(update, context):
        return
    user = update.effective_user
    if not user or not update.message:
        return

    from handlers.key_replacement import (
        REPLACE_SELECT_ADJUST,
        REPLACE_SELECT_SERVER,
        REPLACE_SELECT_SUB,
        clear_replace_flow,
        continue_replace_after_server_pick,
        replace_sub_keyboard,
    )
    from handlers.keyboards import replace_adjust_keyboard, replace_server_keyboard
    from vpn_servers import (
        is_active_server,
        list_replace_target_servers,
        list_servers,
        match_server_label,
    )

    text = (update.message.text or "").strip()
    server = match_server_label(text)
    if not server:
        return

    lang = await _lang(update, context)
    state = context.user_data.get("replace_state")

    if state == REPLACE_SELECT_SUB:
        subs = context.user_data.get("replace_subs") or []
        await update.message.reply_text(
            t(lang, "replace_pick_key"),
            parse_mode=PARSE_MODE,
            reply_markup=replace_sub_keyboard(lang, subs),
        )
        return

    if state == REPLACE_SELECT_ADJUST:
        option_map = context.user_data.get("replace_option_map") or {}
        labels = list(option_map.keys())
        await update.message.reply_text(
            t(lang, "replace_adjust_pick"),
            parse_mode=PARSE_MODE,
            reply_markup=replace_adjust_keyboard(lang, labels),
        )
        return

    if state == REPLACE_SELECT_SERVER:
        from_server_id = context.user_data.get("replace_from_server") or "sg"
        if not is_active_server(server):
            servers = list_replace_target_servers(from_server_id)
            await update.message.reply_text(
                t(lang, "server_not_in_list"),
                parse_mode=PARSE_MODE,
                reply_markup=replace_server_keyboard(lang, servers),
            )
            return
        sub_id = context.user_data.get("replace_sub_id")
        if not sub_id:
            return
        sub = await db.get_subscription_by_id(sub_id)
        if not sub:
            clear_replace_flow(context)
            return
        await continue_replace_after_server_pick(
            update.message, lang, context, server, sub
        )
        return

    if context.user_data.get("payment_state"):
        await update.message.reply_text(
            t(lang, "replace_finish_payment_first"),
            reply_markup=main_menu(lang, is_admin(user.id)),
        )
        return

    if not is_active_server(server):
        clear_replace_flow(context)
        context.user_data["buy_flow"] = True
        context.user_data.pop("buy_server_id", None)
        await update.message.reply_text(
            t(lang, "server_not_in_list"),
            parse_mode=PARSE_MODE,
            reply_markup=servers_reply_keyboard(lang, list_servers()),
        )
        return

    clear_replace_flow(context)
    context.user_data["buy_flow"] = True
    context.user_data["buy_server_id"] = server.id
    await _show_plans_for_server(update.message, lang, server.id)


async def buy_plan_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    _start_buy_flow(context)
    lang = await _lang(update, context)
    from vpn_servers import list_servers

    servers = list_servers()
    if not servers:
        await update.message.reply_text(
            t(lang, "no_plans"), **admin_contact_reply_kwargs(lang)
        )
        return
    if len(servers) == 1:
        context.user_data["buy_server_id"] = servers[0].id
        await _show_plans_for_server(update.message, lang, servers[0].id)
        return
    await update.message.reply_text(
        t(lang, "servers_title"),
        parse_mode=PARSE_MODE,
        reply_markup=servers_reply_keyboard(lang, servers),
    )


async def _start_kbzpayout(
    message,
    from_user,
    context,
    user_row,
    lang,
    plan,
    account,
) -> None:
    """Show payment instructions for the single KBZPay account."""
    if from_user and not rate_allow(
        f"pay:{from_user.id}",
        max_calls=config.RATE_PAYMENT_PER_HOUR,
        window_sec=3600,
    ):
        await message.reply_text(t(lang, "rate_limited"))
        return

    server_id = context.user_data.get("buy_server_id") or plan.get("server_id") or "sg"
    payment_id = await db.create_payment(
        user_row["id"],
        plan["id"],
        account["method"],
        plan["price_ks"],
        server_id,
    )
    context.user_data["pending_payment_id"] = payment_id
    context.user_data["payment_state"] = WAITING_RECEIPT
    context.user_data.pop("buy_flow", None)
    account_number = account["account_number"]
    from vpn_servers import get_server

    server = get_server(server_id)
    server_name = server.name(lang) if server else server_id.upper()
    instructions = t(
        lang,
        "pay_instructions",
        server=md2(server_name),
        plan=md2(plan["title"]),
        price=plan["price_ks"],
        method=md2(account["method"]),
        account=md2_code(account_number),
        account_name=md2(account["account_name"]),
    )
    await message.reply_text(
        instructions,
        parse_mode=PARSE_MODE,
        reply_markup=account_copy_keyboard(lang, account_number),
    )


async def _handle_plan_callback(
    query, context, user, row, lang, data: str
) -> bool:
    """Return True if this callback was a plan/payment action."""
    if data == "buy_plan":
        _start_buy_flow(context)
        from vpn_servers import list_servers

        servers = list_servers()
        if not servers:
            await query.message.reply_text(
                t(lang, "no_plans"), **admin_contact_reply_kwargs(lang)
            )
            return True
        if len(servers) == 1:
            context.user_data["buy_server_id"] = servers[0].id
            await _show_plans_for_server(query.message, lang, servers[0].id)
        else:
            await query.message.reply_text(
                t(lang, "servers_title"),
                parse_mode=PARSE_MODE,
                reply_markup=servers_reply_keyboard(lang, servers),
            )
        return True

    if data.startswith("plan_"):
        try:
            plan_id = int(data.split("_", 1)[1])
        except (ValueError, IndexError):
            logger.warning("Bad plan callback data: %s", data)
            await query.message.reply_text(
                t(lang, "no_plans"), **admin_contact_reply_kwargs(lang)
            )
            return True

        plan = await db.get_plan(plan_id)
        if not plan or not plan.get("is_active"):
            logger.warning("Inactive or missing plan id=%s", plan_id)
            server_id = context.user_data.get("buy_server_id") or "sg"
            await _show_plans_for_server(query.message, lang, server_id)
            return True

        accounts = await db.get_payment_accounts("KBZPay")
        if not accounts:
            await query.message.reply_text(
                t(lang, "no_plans"), **admin_contact_reply_kwargs(lang)
            )
            return True

        await _start_kbzpayout(
            query.message, query.from_user, context, row, lang, plan, accounts[0]
        )
        return True

    if data.startswith("acct_"):
        parts = data.split("_")
        if len(parts) < 3:
            return True
        account_id, plan_id = int(parts[1]), int(parts[2])
        account = await db.get_payment_account(account_id)
        plan = await db.get_plan(plan_id)
        if account and plan:
            await _start_kbzpayout(
                query.message, query.from_user, context, row, lang, plan, account
            )
        return True

    return False


class _LanguageChoiceFilter(filters.MessageFilter):
    def filter(self, message) -> bool:
        return resolve_language_choice(message.text) is not None


_LANGUAGE_CHOICE = _LanguageChoiceFilter()


async def user_callback_gate(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    await callback_router(update, context)


async def callback_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query:
        return

    data = query.data or ""
    user = update.effective_user
    logger.info("Callback %s from user %s", data, user.id if user else "?")

    if user and await db.is_banned(user.id):
        lang = await _lang(update, context)
        try:
            await query.answer(t_plain(lang, "banned"), show_alert=True)
        except Exception:
            pass
        return

    try:
        await query.answer()
    except Exception:
        logger.exception("callback answer failed for %s", data)

    if not user:
        return

    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    lang = row["language"]

    try:
        if await _handle_plan_callback(query, context, user, row, lang, data):
            return
    except Exception:
        logger.exception("Plan callback failed: %s", data)
        try:
            await query.message.reply_text(
                "Something went wrong. Tap Buy Plan and try again."
            )
        except Exception:
            pass
        return

    if data in ("dl_menu", "dl_android", "dl_ios", "dl_android_key", "dl_ios_key"):
        if data in ("dl_android", "dl_android_key"):
            text = t(lang, "download_android_apps")
            markup = download_apps_keyboard(lang, "android")
        elif data in ("dl_ios", "dl_ios_key"):
            text = t(lang, "download_ios_apps")
            markup = download_apps_keyboard(lang, "ios")
        else:
            text = t(lang, "download_title")
            markup = vpn_app_links_keyboard(lang)
        await query.message.reply_text(
            text, parse_mode=PARSE_MODE, reply_markup=markup
        )
        return

    if data == "back_main":
        await query.message.reply_text(
            t(lang, "welcome"),
            parse_mode=PARSE_MODE,
            reply_markup=main_menu(lang, is_admin(user.id)),
        )
        return

    if data == "cancel":
        _clear_payment_flow(context)
        await query.edit_message_text(t(lang, "cancel"))
        return

    if data == "copy_vless_key":
        subs = await db.get_all_active_subscriptions(row["id"])
        if subs:
            subs = await sync_subscriptions_usage(subs)
            await query.answer()
            await _send_all_keys(query.message, lang, subs, row)
        else:
            await query.answer(t_plain(lang, "no_subscription"), show_alert=True)
        return

    if data.startswith("sub_"):
        try:
            user_id = int(data[4:])
        except ValueError:
            return
        if user_id != row["id"]:
            await query.answer(t_plain(lang, "no_subscription"), show_alert=True)
            return
        sub_url = user_subscription_url(row)
        if not sub_url:
            await query.answer(t_plain(lang, "no_subscription"), show_alert=True)
            return
        await query.answer()
        await deliver_subscription_link(
            message=query.message,
            lang=lang,
            sub_url=sub_url,
            user_id=row["id"],
        )
        return

    if data.startswith("vk_"):
        try:
            sub_id = int(data[3:])
        except ValueError:
            return
        sub = await db.get_subscription_by_id(sub_id)
        if not sub or sub["user_id"] != row["id"] or not sub.get("is_active"):
            await query.answer(t_plain(lang, "no_subscription"), show_alert=True)
            return
        await query.answer()
        await deliver_vless_key(
            message=query.message,
            lang=lang,
            vless_key=sub["vless_key"],
            sub_id=sub_id,
        )
        return


async def _process_kbzpayout_verification(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    payment_id: int,
    verify_result,
    user_row: dict,
) -> None:
    lang = await _lang(update, context)
    payment = await _owned_pending_payment(payment_id, user_row)
    if not payment:
        await _reply_and_restore_menu(
            update,
            lang,
            t(lang, "pay_already_processed"),
            context,
        )
        return

    await db.set_payment_verification(
        payment_id,
        verify_status=verify_result.status,
        verify_message=verify_result.message,
    )

    if verify_result.status == "needs_tx_id":
        await update_payment_proof(
            context.bot, payment_id, "manual_review", note="Awaiting Transaction ID"
        )
        await update.message.reply_text(
            t(lang, "pay_ask_tx_id"), parse_mode=PARSE_MODE
        )
        context.user_data["payment_state"] = WAITING_TX_ID
        return

    if verify_result.status == "ok" and verify_result.trans_id:
        ok, msg = await approve_and_deliver(
            context.bot,
            payment_id,
            processed_by=0,
            auto=True,
            tx_id=verify_result.trans_id,
        )
        if ok:
            await update_payment_proof(
                context.bot,
                payment_id,
                "auto_approved",
                note=f"Tx: {verify_result.trans_id}",
            )
        elif msg == "Transaction ID already used":
            await db.reject_payment(payment_id, 0, msg)
            logger.warning("Tx replay blocked for payment %s", payment_id)
            await _reply_and_restore_menu(
                update,
                lang,
                t(lang, "pay_rejected_generic"),
                context,
                **admin_contact_reply_kwargs(lang),
            )
            await update_payment_proof(
                context.bot, payment_id, "auto_rejected", note="Duplicate transaction ID"
            )
        else:
            await _reply_and_restore_menu(
                update,
                lang,
                t(lang, "pay_submitted"),
                context,
            )
            await update_payment_proof(context.bot, payment_id, "manual_review")
        if ok:
            _clear_payment_flow(context)
            _clear_buy_flow(context)
        return

    if verify_result.status == "token_invalid":
        await _reply_and_restore_menu(
            update,
            lang,
            t(lang, "pay_manual_token_invalid"),
            context,
            **admin_contact_reply_kwargs(lang),
        )
        await update_payment_proof(
            context.bot,
            payment_id,
            "manual_review",
            note="KBZ auto-verify unavailable",
        )
        return

    if verify_result.status == "failed":
        if verify_result.trans_id:
            await db.try_claim_tx_id(payment_id, verify_result.trans_id)
            await db.reject_payment(payment_id, 0, verify_result.message)
            logger.info(
                "Payment %s auto-rejected: %s", payment_id, verify_result.message
            )
        reject_key = (
            "pay_rejected_stale_tx"
            if is_stale_tx_failure(verify_result)
            else "pay_rejected_generic"
        )
        await _reply_and_restore_menu(
            update,
            lang,
            t(lang, reject_key),
            context,
            **admin_contact_reply_kwargs(lang),
        )
        await update_payment_proof(context.bot, payment_id, "auto_rejected")
        return

    # error / manual review
    await _reply_and_restore_menu(
        update,
        lang,
        t(lang, "pay_submitted"),
        context,
    )
    await update_payment_proof(context.bot, payment_id, "manual_review")


async def receipt_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    user = update.effective_user
    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    payment = await _resolve_pending_payment(context, row)
    if not payment:
        return
    payment_id = payment["id"]
    lang = await _lang(update, context)

    photo = update.message.photo[-1] if update.message.photo else None
    if not photo:
        await update.message.reply_text(
            t(lang, "pay_waiting_receipt"), parse_mode=PARSE_MODE
        )
        return

    if not rate_allow(
        f"receipt_photo:{user.id}",
        max_calls=config.RATE_RECEIPT_SCREENSHOT_PER_MIN,
        window_sec=60,
    ):
        await update.message.reply_text(t(lang, "rate_limited_receipt"))
        return

    await db.attach_receipt(payment_id, photo.file_id)
    context.user_data["payment_state"] = WAITING_RECEIPT

    payment = await db.get_payment(payment_id) or payment

    if payment.get("method") != "KBZPay" or not config.KBZ_AUTO_VERIFY:
        await post_payment_proof(
            context.bot,
            payment_id,
            payment,
            photo.file_id,
            status="manual_review",
        )
        _clear_payment_flow(context)
        _clear_buy_flow(context)
        await _reply_and_restore_menu(
            update,
            lang,
            t(lang, "pay_submitted"),
            context,
            clear_payment=False,
        )
        return

    await post_payment_proof(
        context.bot,
        payment_id,
        payment,
        photo.file_id,
        status="verifying",
    )

    if not rate_allow(
        f"kbz:{user.id}",
        max_calls=config.RATE_KBZ_VERIFY_PER_HOUR,
        window_sec=3600,
    ):
        await update.message.reply_text(t(lang, "rate_limited"))
        return

    await update.message.reply_text(t(lang, "pay_verifying"))
    try:
        tg_file = await context.bot.get_file(photo.file_id)
        image_bytes = bytes(await tg_file.download_as_bytearray())
        result = await verify_receipt_image(image_bytes, payment["amount_ks"])
    except Exception:
        logger.exception("Receipt verify failed for payment %s", payment_id)
        await _reply_and_restore_menu(
            update,
            lang,
            t(lang, "pay_submitted"),
            context,
        )
        await update_payment_proof(context.bot, payment_id, "manual_review")
        return
    await _process_kbzpayout_verification(
        update, context, payment_id, result, row
    )


async def receipt_tx_id(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if context.user_data.get("replace_state"):
        return
    if not await _guard(update, context):
        return
    user = update.effective_user
    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    lang = await _lang(update, context)

    trans_id = (update.message.text or "").strip()
    if not TX_ID_RE.fullmatch(trans_id):
        return

    payment = await _resolve_pending_payment(context, row)
    if not payment:
        await _reply_and_restore_menu(
            update,
            lang,
            t(lang, "pay_no_pending"),
            context,
        )
        return

    payment_id = payment["id"]
    logger.info("Tx ID %s for payment #%s user %s", trans_id, payment_id, user.id)

    if not await db.try_claim_tx_id(payment_id, trans_id):
        await _reply_and_restore_menu(
            update,
            lang,
            t(lang, "pay_rejected_generic"),
            context,
            **admin_contact_reply_kwargs(lang),
        )
        return

    if not rate_allow(
        f"kbz:{user.id}",
        max_calls=config.RATE_KBZ_VERIFY_PER_HOUR,
        window_sec=3600,
    ):
        await update.message.reply_text(t(lang, "rate_limited"))
        return

    await update.message.reply_text(t(lang, "pay_verifying"))
    try:
        result = await verify_transaction_id(trans_id, payment["amount_ks"])
    except Exception:
        logger.exception("Tx ID verify failed for payment %s", payment_id)
        await _reply_and_restore_menu(
            update,
            lang,
            t(lang, "pay_submitted"),
            context,
        )
        await update_payment_proof(context.bot, payment_id, "manual_review")
        return
    await _process_kbzpayout_verification(
        update, context, payment_id, result, row
    )


async def cancel_payment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    lang = await _lang(update, context)
    _clear_payment_flow(context)
    _clear_buy_flow(context)
    from handlers.key_replacement import clear_replace_flow

    clear_replace_flow(context)
    admin = is_admin(user.id) if user else False
    await update.message.reply_text(
        t(lang, "cancel"),
        parse_mode=PARSE_MODE,
        reply_markup=main_menu(lang, admin),
    )


def _plan_label(plan: dict, lang: str) -> str:
    return t(lang, "plan_item", title=plan["title"], price=plan["price_ks"])


async def plan_text_select(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reply keyboard: pick plan during buy flow (servers handled by server_label_select)."""
    if context.user_data.get("replace_state") and not context.user_data.get("buy_flow"):
        return
    if not await _guard(update, context):
        return

    text = (update.message.text or "").strip()
    if not text:
        return

    from locales import STRINGS
    from vpn_servers import list_servers

    if text in {STRINGS["back"]["my"], STRINGS["back"]["en"]}:
        await back_to_main(update, context)
        return

    if not context.user_data.get("buy_flow"):
        return
    if context.user_data.get("payment_state"):
        return

    lang = await _lang(update, context)
    server_id = context.user_data.get("buy_server_id")
    if not server_id:
        await update.message.reply_text(
            t(lang, "servers_title"),
            parse_mode=PARSE_MODE,
            reply_markup=servers_reply_keyboard(lang, list_servers()),
        )
        return

    plans = await db.get_active_plans(server_id)
    for plan in plans:
        if text in (_plan_label(plan, "my"), _plan_label(plan, "en")):
            user = update.effective_user
            row = await db.get_or_create_user(user.id, user.username, user.first_name)
            accounts = await db.get_payment_accounts("KBZPay")
            if not accounts:
                await update.message.reply_text(
                    t(lang, "no_plans"), **admin_contact_reply_kwargs(lang)
                )
                return
            await _start_kbzpayout(
                update.message, user, context, row, lang, plan, accounts[0]
            )
            return

    await _show_plans_for_server(update.message, lang, server_id)


def menu_text_filter(text_key: str):
    """Match reply keyboard labels in both languages (+ legacy aliases)."""
    from locales import MENU_ALIASES, STRINGS

    labels = {STRINGS[text_key]["my"], STRINGS[text_key]["en"]}
    labels.update(MENU_ALIASES.get(text_key, ()))
    pattern = "^(" + "|".join(re.escape(l) for l in labels) + ")$"
    return filters.TEXT & filters.Regex(pattern)


def build_user_handlers() -> list:
    from handlers.admin import admin_panel
    from handlers.key_replacement import (
        build_key_replacement_handlers,
        replace_key_start,
    )

    handlers = [
        CallbackQueryHandler(language_callback, pattern=r"^lang_(my|en)$"),
        CallbackQueryHandler(user_callback_gate, pattern=USER_CALLBACK_PATTERN),
        CommandHandler("start", start),
        CommandHandler("cancel", cancel_payment),
        CommandHandler("buy", buy_plan_message),
        MessageHandler(menu_text_filter("menu_daily"), daily_gift),
        MessageHandler(menu_text_filter("menu_my_key"), my_key),
        MessageHandler(menu_text_filter("menu_replace"), replace_key_start),
        MessageHandler(menu_text_filter("menu_download"), download_apps_menu),
        MessageHandler(menu_text_filter("menu_support"), support),
        MessageHandler(menu_text_filter("menu_lang"), language_menu),
        MessageHandler(_LANGUAGE_CHOICE, language_text_select),
        MessageHandler(menu_text_filter("menu_buy"), buy_plan_message),
        MessageHandler(menu_text_filter("back"), back_to_main),
        MessageHandler(_SERVER_LABEL, server_label_select),
        MessageHandler(filters.Regex("^Admin$"), admin_panel),
    ]
    handlers.extend(build_key_replacement_handlers())
    handlers.extend(
        [
        MessageHandler(filters.TEXT & ~filters.COMMAND, plan_text_select, block=False),
        MessageHandler(
            filters.TEXT & filters.Regex(r"^\d{10,}$") & ~filters.COMMAND,
            receipt_tx_id,
        ),
        MessageHandler(filters.PHOTO, receipt_photo, block=False),
        ]
    )
    return handlers
