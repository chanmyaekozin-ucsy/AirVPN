"""Approve / reject payment proofs from the admin Telegram group."""
from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import CallbackQueryHandler, ContextTypes, MessageHandler, filters

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
    if query and query.message:
        return query.message.chat_id
    chat = update.effective_chat
    return chat.id if chat else None


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
        return

    await _answer_callback(query, "Approving payment…")

    user = update.effective_user
    if not user or not is_admin(user.id):
        await query.message.reply_text("Access denied.")
        return

    payment = await db.get_payment(payment_id)
    if not payment or payment["status"] != "pending":
        await query.message.reply_text("Payment already processed.")
        return

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
        await query.message.reply_text("Approval failed: internal error")
        return

    if not ok:
        logger.error("Group approve failed for payment %s: %s", payment_id, msg)
        await query.message.reply_text(f"Approval failed: {msg}")
        return

    await update_payment_proof(
        context.bot,
        payment_id,
        "approved",
        note=f"By admin {user.id}",
    )
    await query.message.reply_text(f"Payment #{payment_id} approved.")


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
        return

    await _answer_callback(query)

    user = update.effective_user
    if not user or not is_admin(user.id):
        await query.message.reply_text("Access denied.")
        return

    payment = await db.get_payment(payment_id)
    if not payment or payment["status"] != "pending":
        await query.message.reply_text("Payment already processed.")
        return

    logger.info("Group reject payment #%s by admin %s", payment_id, user.id)
    context.chat_data["group_reject_payment_id"] = payment_id
    context.user_data["group_reject_payment_id"] = payment_id
    lang = await _lang(update)
    try:
        await query.message.reply_text(
            t(lang, "admin_reject_reason_group", payment_id=payment_id)
        )
    except Exception:
        logger.exception("proof_no prompt failed for payment %s", payment_id)
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=t(lang, "admin_reject_reason_group", payment_id=payment_id),
            reply_to_message_id=query.message.message_id,
        )


async def group_reject_reason(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    """Capture rejection reason typed in the proofs group."""
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
    await update.message.reply_text(f"Payment #{payment_id} rejected.")


def _proofs_group_text_filter():
    """Only the proofs group — never match private-chat menu button presses."""
    base = filters.TEXT & ~filters.COMMAND
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
        MessageHandler(_proofs_group_text_filter(), group_reject_reason),
    ]
