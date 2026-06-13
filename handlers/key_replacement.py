"""User flow: move a paid VPN key to another server."""
from __future__ import annotations

import logging
import re

from telegram import Update
from telegram.ext import ContextTypes, MessageHandler, filters

import database as db
from handlers.keyboards import (
    is_admin,
    main_menu,
    replace_server_keyboard,
    replace_sub_keyboard,
)
from handlers.user import _guard, _lang
from locales import STRINGS, t
from services.key_replacement import (
    compute_remaining_quota,
    notify_replacement,
    replace_subscription_server,
)
from utils.formatting import PARSE_MODE, md2
from utils.rate_limit import allow as rate_allow
from utils.vless_delivery import deliver_vpn_access
from vpn_servers import get_server, list_servers, match_server_label

logger = logging.getLogger(__name__)

REPLACE_SELECT_SUB = "replace_select_sub"
REPLACE_SELECT_SERVER = "replace_select_server"
REPLACE_FEEDBACK = "replace_feedback"

REPLACE_SUB_RE = re.compile(r"^#(\d+)\s")


def clear_replace_flow(context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data.pop("replace_state", None)
    context.user_data.pop("replace_sub_id", None)
    context.user_data.pop("replace_subs", None)
    context.user_data.pop("replace_from_server", None)
    context.user_data.pop("replace_target_server", None)


def _parse_sub_pick(text: str, subs: list[dict]) -> dict | None:
    match = REPLACE_SUB_RE.match((text or "").strip())
    if not match:
        return None
    idx = int(match.group(1))
    if idx < 1 or idx > len(subs):
        return None
    return subs[idx - 1]


async def replace_key_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _guard(update, context):
        return
    user = update.effective_user
    if not user or not update.message:
        return
    lang = await _lang(update, context)
    menu = main_menu(lang, is_admin(user.id))

    if context.user_data.get("payment_state"):
        await update.message.reply_text(
            t(lang, "replace_finish_payment_first"),
            reply_markup=menu,
        )
        return

    clear_replace_flow(context)
    context.user_data.pop("pending_payment_id", None)
    context.user_data.pop("payment_state", None)
    context.user_data.pop("buy_server_id", None)
    context.user_data.pop("buy_flow", None)
    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    lang = row["language"]
    menu = main_menu(lang, is_admin(user.id))

    subs = await db.get_active_paid_subscriptions(row["id"])
    if not subs:
        await update.message.reply_text(
            t(lang, "replace_no_paid_keys"),
            reply_markup=menu,
        )
        return

    servers = list_servers()
    if len(servers) < 2:
        await update.message.reply_text(
            t(lang, "replace_need_two_servers"),
            reply_markup=menu,
        )
        return

    if not rate_allow(
        f"replace:{user.id}",
        max_calls=5,
        window_sec=86400,
    ):
        await update.message.reply_text(
            t(lang, "rate_limited"),
            reply_markup=menu,
        )
        return

    context.user_data["replace_subs"] = subs

    if len(subs) == 1:
        context.user_data["replace_sub_id"] = subs[0]["id"]
        context.user_data["replace_from_server"] = subs[0].get("server_id")
        await _prompt_target_server(update.message, lang, subs[0], context)
        return

    context.user_data["replace_state"] = REPLACE_SELECT_SUB
    await update.message.reply_text(
        t(lang, "replace_pick_key"),
        parse_mode=PARSE_MODE,
        reply_markup=replace_sub_keyboard(lang, subs),
    )


async def _prompt_target_server(message, lang: str, sub: dict, context) -> None:
    from_server = (sub.get("server_id") or "sg").strip().lower()
    context.user_data["replace_from_server"] = from_server
    servers = [s for s in list_servers() if s.id != from_server]
    if not servers:
        clear_replace_flow(context)
        await message.reply_text(t(lang, "replace_no_other_servers"))
        return
    context.user_data["replace_state"] = REPLACE_SELECT_SERVER
    server = get_server(from_server)
    current = server.name(lang) if server else from_server.upper()
    await message.reply_text(
        t(lang, "replace_pick_server", current=md2(current)),
        parse_mode=PARSE_MODE,
        reply_markup=replace_server_keyboard(lang, servers),
    )


async def replace_text_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if context.user_data.get("buy_flow"):
        return
    state = context.user_data.get("replace_state")
    if not state:
        return
    if not await _guard(update, context):
        clear_replace_flow(context)
        return

    text = (update.message.text or "").strip()
    lang = await _lang(update, context)
    user = update.effective_user
    row = await db.get_or_create_user(user.id, user.username, user.first_name)

    back_labels = {STRINGS["back"]["my"], STRINGS["back"]["en"]}
    if text in back_labels:
        clear_replace_flow(context)
        await update.message.reply_text(
            t(lang, "welcome"),
            parse_mode=PARSE_MODE,
            reply_markup=main_menu(lang, is_admin(user.id)),
        )
        return

    if state == REPLACE_SELECT_SUB:
        subs = context.user_data.get("replace_subs") or []
        sub = _parse_sub_pick(text, subs)
        if not sub:
            return
        context.user_data["replace_sub_id"] = sub["id"]
        await _prompt_target_server(update.message, lang, sub, context)
        return

    if state == REPLACE_SELECT_SERVER:
        server = match_server_label(text)
        if not server:
            return
        if server.id == context.user_data.get("replace_from_server"):
            await update.message.reply_text(t(lang, "replace_same_server"))
            return
        context.user_data["replace_target_server"] = server.id
        context.user_data["replace_state"] = REPLACE_FEEDBACK
        await update.message.reply_text(
            t(lang, "replace_ask_feedback", server=md2(server.name(lang))),
            parse_mode=PARSE_MODE,
        )
        return

    if state == REPLACE_FEEDBACK:
        feedback = text or "—"
        sub_id = context.user_data.get("replace_sub_id")
        target_id = context.user_data.get("replace_target_server")
        if not sub_id or not target_id:
            clear_replace_flow(context)
            return

        sub = await db.get_subscription_by_id(sub_id)
        if (
            not sub
            or sub["user_id"] != row["id"]
            or not sub.get("is_active")
            or sub.get("is_free")
        ):
            clear_replace_flow(context)
            await update.message.reply_text(t(lang, "replace_no_paid_keys"))
            return

        quota = await compute_remaining_quota(sub)
        if not quota:
            clear_replace_flow(context)
            await update.message.reply_text(t(lang, "replace_no_quota"))
            return

        await update.message.reply_text(t(lang, "replace_working"))
        remaining_gb, _expires = quota
        from_server = sub.get("server_id") or "sg"

        ok, msg, updated = await replace_subscription_server(
            sub,
            user.id,
            target_id,
            feedback,
        )
        clear_replace_flow(context)

        if not ok:
            err_key = msg if msg in STRINGS else "replace_failed"
            await update.message.reply_text(
                t(lang, err_key),
                parse_mode=PARSE_MODE,
                reply_markup=main_menu(lang, is_admin(user.id)),
            )
            return

        target = get_server(target_id)
        target_name = target.name(lang) if target else target_id.upper()
        await notify_replacement(
            context.bot,
            telegram_id=user.id,
            username=user.username,
            sub_id=sub_id,
            from_server=from_server,
            to_server=target_id,
            feedback=feedback,
            remaining_gb=remaining_gb,
        )

        await update.message.reply_text(
            t(
                lang,
                "replace_done",
                server=md2(target_name),
                remaining=f"{remaining_gb:.2f}",
                expires=updated["expires_at"][:10] if updated else _expires[:10],
            ),
            parse_mode=PARSE_MODE,
            reply_markup=main_menu(lang, is_admin(user.id)),
        )
        if updated:
            await deliver_vpn_access(
                message=update.message,
                lang=lang,
                user=row,
                vless_key=updated["vless_key"],
                sub_id=updated["id"],
            )
            from handlers.keyboards import restore_main_menu

            await restore_main_menu(context.bot, update.effective_chat.id, lang, user.id)


def build_key_replacement_handlers() -> list:
    return [
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            replace_text_router,
            block=False,
        ),
    ]
