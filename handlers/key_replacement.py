"""User flow: move a paid VPN key to another server."""
from __future__ import annotations

import logging
import re

from telegram import Update
from telegram.ext import ContextTypes, MessageHandler, filters

import database as db
from handlers.keyboards import (
    admin_contact_reply_kwargs,
    is_admin,
    main_menu,
    replace_adjust_keyboard,
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
from services.replace_adjust import ReplaceOption, compute_replace_options, fmt_gb
from utils.formatting import PARSE_MODE, md2
from utils.rate_limit import allow as rate_allow
from utils.vless_delivery import deliver_vpn_access
from vpn_servers import get_server, list_replace_target_servers, list_servers

logger = logging.getLogger(__name__)

REPLACE_SELECT_SUB = "replace_select_sub"
REPLACE_SELECT_SERVER = "replace_select_server"
REPLACE_SELECT_ADJUST = "replace_select_adjust"
REPLACE_FEEDBACK = "replace_feedback"

REPLACE_SUB_RE = re.compile(r"^#(\d+)\s")


def clear_replace_flow(context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data.pop("replace_state", None)
    context.user_data.pop("replace_sub_id", None)
    context.user_data.pop("replace_subs", None)
    context.user_data.pop("replace_from_server", None)
    context.user_data.pop("replace_target_server", None)
    context.user_data.pop("replace_option_map", None)
    context.user_data.pop("replace_adjustment", None)


def _option_button_label(lang: str, index: int, option: ReplaceOption) -> str:
    key = (
        "replace_adjust_option_keep_days"
        if option.key == "keep_days"
        else "replace_adjust_option_keep_data"
    )
    return t(
        lang,
        key,
        n=index,
        gb=fmt_gb(option.data_gb),
        days=option.days,
    )


async def continue_replace_after_server_pick(
    message,
    lang: str,
    context: ContextTypes.DEFAULT_TYPE,
    server,
    sub: dict,
) -> None:
    """After target server is chosen: same-price → feedback; else → pick adjustment."""
    from_server_id = (
        context.user_data.get("replace_from_server") or sub.get("server_id") or "sg"
    ).strip().lower()
    if server.id == from_server_id:
        await message.reply_text(t(lang, "replace_same_server"))
        return

    quota = await compute_remaining_quota(sub)
    if not quota:
        clear_replace_flow(context)
        await message.reply_text(t(lang, "replace_no_quota"))
        return

    remaining_gb, expires_at = quota
    needs_adjust, options = await compute_replace_options(
        sub, remaining_gb, expires_at, server.id
    )

    context.user_data["replace_target_server"] = server.id
    context.user_data.pop("buy_flow", None)
    context.user_data.pop("buy_server_id", None)

    if not needs_adjust:
        context.user_data["replace_state"] = REPLACE_FEEDBACK
        await message.reply_text(
            t(lang, "replace_ask_feedback", server=md2(server.name(lang))),
            parse_mode=PARSE_MODE,
        )
        return

    if not options:
        clear_replace_flow(context)
        await message.reply_text(
            t(lang, "replace_adjust_failed"),
            parse_mode=PARSE_MODE,
            **admin_contact_reply_kwargs(lang),
        )
        return

    labels = [_option_button_label(lang, i + 1, opt) for i, opt in enumerate(options)]
    context.user_data["replace_option_map"] = {
        label: opt.as_dict() for label, opt in zip(labels, options)
    }
    context.user_data["replace_state"] = REPLACE_SELECT_ADJUST

    source_plan = await db.get_plan(sub["plan_id"])
    target_env = None
    if source_plan:
        from vpn_servers import get_env_plan_by_sort

        target_env = get_env_plan_by_sort(
            server.id, int(source_plan.get("sort_order") or 1)
        )
    await message.reply_text(
        t(
            lang,
            "replace_adjust_intro",
            server=md2(server.name(lang)),
            from_price=source_plan["price_ks"] if source_plan else "—",
            to_price=target_env.price_ks if target_env else "—",
            current_gb=fmt_gb(remaining_gb),
            current_days=max(1, int(round(_remaining_days_from_iso(expires_at)))),
        ),
        parse_mode=PARSE_MODE,
        reply_markup=replace_adjust_keyboard(lang, labels),
    )


def _remaining_days_from_iso(expires_at: str) -> float:
    from services.replace_adjust import _remaining_days

    return _remaining_days(expires_at)


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
    servers = list_replace_target_servers(from_server)
    if not servers:
        clear_replace_flow(context)
        await message.reply_text(
            t(lang, "replace_no_other_servers"),
            reply_markup=main_menu(lang, False),
        )
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
            await update.message.reply_text(
                t(lang, "replace_pick_key"),
                parse_mode=PARSE_MODE,
                reply_markup=replace_sub_keyboard(lang, subs),
            )
            return
        context.user_data["replace_sub_id"] = sub["id"]
        await _prompt_target_server(update.message, lang, sub, context)
        return

    if state == REPLACE_SELECT_ADJUST:
        option_map = context.user_data.get("replace_option_map") or {}
        chosen = option_map.get(text)
        if not chosen:
            labels = list(option_map.keys())
            await update.message.reply_text(
                t(lang, "replace_adjust_pick"),
                parse_mode=PARSE_MODE,
                reply_markup=replace_adjust_keyboard(lang, labels),
            )
            return
        context.user_data["replace_adjustment"] = chosen
        context.user_data.pop("replace_option_map", None)
        context.user_data["replace_state"] = REPLACE_FEEDBACK
        target_id = context.user_data.get("replace_target_server")
        target = get_server(target_id) if target_id else None
        target_name = target.name(lang) if target else (target_id or "—").upper()
        await update.message.reply_text(
            t(
                lang,
                "replace_ask_feedback_adjusted",
                server=md2(target_name),
                gb=fmt_gb(chosen["data_gb"]),
                days=chosen["days"],
            ),
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
        adjustment = context.user_data.get("replace_adjustment")
        adjusted_gb = adjustment["data_gb"] if adjustment else None
        adjusted_exp = adjustment["expires_at"] if adjustment else None
        from_server = sub.get("server_id") or "sg"

        ok, msg, updated = await replace_subscription_server(
            sub,
            user.id,
            target_id,
            feedback,
            adjusted_gb=adjusted_gb,
            adjusted_expires_at=adjusted_exp,
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

        final_gb = float(updated["data_limit_gb"]) if updated else remaining_gb
        final_exp = updated["expires_at"] if updated else (adjusted_exp or _expires)

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
            remaining_gb=final_gb,
        )

        await update.message.reply_text(
            t(
                lang,
                "replace_done",
                server=md2(target_name),
                remaining=f"{final_gb:.2f}",
                expires=final_exp[:10] if final_exp else "—",
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
