"""Approve / reject payment proofs from the admin Telegram group."""
from __future__ import annotations

import logging

from telegram import ForceReply, Update
from telegram.ext import (
    ApplicationHandlerStop,
    CallbackQueryHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import config
import database as db
from handlers.keyboards import is_admin
from locales import t
from services.payment_approve import approve_and_deliver
from services.payment_proofs import update_payment_proof
from utils.formatting import PARSE_MODE, md2

logger = logging.getLogger(__name__)


async def _lang(update: Update) -> str:
    user = update.effective_user
    if not user:
        return "my"
    row = await db.get_or_create_user(user.id, user.username, user.first_name)
    return row.get("language") or "my"


def _parse_proof_payment_id(data: str, prefix: str) -> int | None:
    if not data.startswith(prefix):
        return None
    tail = data[len(prefix) :]
    if not tail.isdigit():
        return None
    return int(tail)


async def _answer_callback(query, text: str | None = None, *, alert: bool = False) -> None:
    """Telegram requires answer() within ~10s or the button stays on Loading."""
    try:
        if alert:
            await query.answer(text or "…", show_alert=True)
        elif text:
            await query.answer(text)
        else:
            await query.answer()
    except Exception:
        logger.exception("callback answer failed for data=%r", query.data)


def _callback_chat_id(update: Update) -> int | None:
    query = update.callback_query
    msg = query.message if query else None
    if msg is not None:
        chat = getattr(msg, "chat", None)
        if chat is not None and getattr(chat, "id", None) is not None:
            return int(chat.id)
        # Older Message objects expose chat_id directly
        cid = getattr(msg, "chat_id", None)
        if cid is not None:
            return int(cid)
    chat = update.effective_chat
    return chat.id if chat else None


def _callback_message_id(update: Update) -> int | None:
    query = update.callback_query
    msg = query.message if query else None
    if msg is None:
        return None
    mid = getattr(msg, "message_id", None)
    return int(mid) if mid is not None else None


def _callback_thread_id(update: Update) -> int | None:
    query = update.callback_query
    msg = query.message if query else None
    if msg is None:
        return None
    tid = getattr(msg, "message_thread_id", None)
    return int(tid) if tid is not None else None


async def _group_reply(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
    *,
    reply_markup=None,
) -> None:
    """Send feedback in the proofs group without relying on accessible Message helpers."""
    chat_id = _callback_chat_id(update)
    if not chat_id:
        logger.error("Cannot reply to group callback — no chat id (data=%r)", getattr(update.callback_query, "data", None))
        return
    kwargs: dict = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": None,
    }
    thread_id = _callback_thread_id(update)
    if thread_id is not None:
        kwargs["message_thread_id"] = thread_id
    reply_to = _callback_message_id(update)
    if reply_to is not None:
        kwargs["reply_to_message_id"] = reply_to
    if reply_markup is not None:
        kwargs["reply_markup"] = reply_markup
    try:
        await context.bot.send_message(**kwargs)
    except Exception:
        logger.exception("group reply failed chat=%s text=%r", chat_id, text[:80])


async def proof_payment_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    query = update.callback_query
    if not query:
        return

    chat_id = _callback_chat_id(update)
    logger.info(
        "proof_ok callback data=%r user=%s chat=%s",
        query.data,
        update.effective_user.id if update.effective_user else "?",
        chat_id,
    )

    payment_id = _parse_proof_payment_id(query.data or "", "proof_ok_")
    if payment_id is None:
        await _answer_callback(query, "Invalid payment button", alert=True)
        raise ApplicationHandlerStop

    user = update.effective_user
    if not user or not is_admin(user.id):
        await _answer_callback(query, "Access denied — admin only", alert=True)
        raise ApplicationHandlerStop

    payment = await db.get_payment(payment_id)
    if not payment or payment["status"] != "pending":
        await _answer_callback(query, "Payment already processed", alert=True)
        raise ApplicationHandlerStop

    await _answer_callback(query, "Approving payment…")
    logger.info("Group approve payment #%s by admin %s", payment_id, user.id)

    try:
        ok, msg = await approve_and_deliver(
            context.bot,
            payment_id,
            processed_by=user.id,
            auto=False,
            tx_id=payment.get("receipt_tx_id"),
        )
    except Exception:
        logger.exception("Group approve failed for payment %s", payment_id)
        await _group_reply(update, context, f"Approval failed: internal error (#{payment_id})")
        raise ApplicationHandlerStop

    if not ok:
        logger.error("Group approve failed for payment %s: %s", payment_id, msg)
        await _group_reply(update, context, f"Approval failed: {msg}")
        raise ApplicationHandlerStop

    await update_payment_proof(
        context.bot,
        payment_id,
        "approved",
        note=f"By admin {user.id}",
    )
    await _group_reply(update, context, f"Payment #{payment_id} approved.")
    raise ApplicationHandlerStop


async def proof_reject_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Admin taps Reject on a group proof post."""
    query = update.callback_query
    if not query:
        return

    chat_id = _callback_chat_id(update)
    logger.info(
        "proof_no callback data=%r user=%s chat=%s",
        query.data,
        update.effective_user.id if update.effective_user else "?",
        chat_id,
    )

    payment_id = _parse_proof_payment_id(query.data or "", "proof_no_")
    if payment_id is None:
        await _answer_callback(query, "Invalid payment button", alert=True)
        raise ApplicationHandlerStop

    user = update.effective_user
    if not user or not is_admin(user.id):
        await _answer_callback(query, "Access denied — admin only", alert=True)
        raise ApplicationHandlerStop

    payment = await db.get_payment(payment_id)
    if not payment or payment["status"] != "pending":
        await _answer_callback(query, "Payment already processed", alert=True)
        raise ApplicationHandlerStop

    await _answer_callback(query)
    logger.info("Group reject payment #%s by admin %s", payment_id, user.id)
    context.chat_data["group_reject_payment_id"] = payment_id
    context.user_data["group_reject_payment_id"] = payment_id
    lang = await _lang(update)

    # ForceReply + reply-to-bot is required when BotFather privacy mode is on;
    # plain group text is otherwise invisible to the bot.
    await _group_reply(
        update,
        context,
        t(lang, "admin_reject_reason_group", payment_id=payment_id),
        reply_markup=ForceReply(
            selective=True,
            input_field_placeholder="Rejection reason",
        ),
    )
    raise ApplicationHandlerStop


async def group_reject_reason(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Capture rejection reason typed as a reply in the proofs group."""
    payment_id = context.chat_data.get("group_reject_payment_id")
    if not payment_id:
        payment_id = context.user_data.get("group_reject_payment_id")
    if not payment_id:
        return

    user = update.effective_user
    if not user or not is_admin(user.id) or not update.message:
        return

    reason = (update.message.text or "").strip() or "—"
    context.chat_data.pop("group_reject_payment_id", None)
    context.user_data.pop("group_reject_payment_id", None)

    await reject_payment_from_group(
        update.get_bot(), payment_id, user.id, reason
    )
    await update.message.reply_text(
        f"Payment #{payment_id} rejected.",
        parse_mode=None,
    )
    raise ApplicationHandlerStop


def _proofs_group_reject_filter():
    """Proofs group only; prefer replies so privacy mode still delivers the text."""
    base = filters.TEXT & ~filters.COMMAND & filters.REPLY
    gid = config.PAYMENTS_PROOFS_GROUP_ID
    if gid:
        return base & filters.Chat(gid)
    return base & filters.ChatType.GROUPS


async def reject_payment_from_group(
    bot,
    payment_id: int,
    admin_id: int,
    reason: str,
) -> None:
    """Reject payment and refresh the proofs-group caption."""
    payment = await db.reject_payment(payment_id, admin_id, reason)
    if not payment:
        return

    await update_payment_proof(
        bot,
        payment_id,
        "rejected",
        note=f"Reason: {reason}",
    )

    user_row = await db.get_or_create_user(payment["telegram_id"])
    u_lang = user_row.get("language", "my")
    try:
        from handlers.keyboards import restore_main_menu

        await bot.send_message(
            payment["telegram_id"],
            t(u_lang, "pay_rejected_user", reason=md2(reason)),
            parse_mode=PARSE_MODE,
        )
        await restore_main_menu(
            bot, payment["telegram_id"], u_lang, payment["telegram_id"]
        )
    except Exception:
        logger.exception("notify user reject failed")


def build_group_payment_handlers() -> list:
    return [
        CallbackQueryHandler(proof_payment_callback, pattern=r"^proof_ok_\d+$"),
        CallbackQueryHandler(proof_reject_callback, pattern=r"^proof_no_\d+$"),
        MessageHandler(_proofs_group_reject_filter(), group_reject_reason),
    ]
