"""Post payment updates to the admin proofs Telegram group."""
from __future__ import annotations

import logging
from typing import Literal

from telegram import Bot, InlineKeyboardMarkup

import config
import database as db
from handlers.keyboards import group_proof_actions

logger = logging.getLogger(__name__)

ProofStatus = Literal[
    "verifying",
    "auto_approved",
    "auto_rejected",
    "manual_review",
    "approved",
    "rejected",
]

_STATUS_HEADING = {
    "verifying": "Verifying…",
    "auto_approved": "Auto Approved.",
    "auto_rejected": "Auto Rejected.",
    "manual_review": "Manual Review Required",
    "approved": "Approved by Admin.",
    "rejected": "Rejected by Admin.",
}


def build_proof_caption(
    payment: dict,
    payment_id: int,
    status: ProofStatus,
    *,
    note: str = "",
) -> str:
    username = payment.get("username")
    user_line = f"@{username}" if username else "—"
    lines = [
        _STATUS_HEADING[status],
        "",
        f"Payment #{payment_id}",
        f"Plan: {payment.get('plan_title', '—')}",
        f"Amount: {payment.get('amount_ks', 0):,} Ks",
        f"UserID: {payment.get('telegram_id', '—')}",
        f"User: {payment.get('first_name', '—')} ({user_line})",
    ]
    if payment.get("receipt_tx_id"):
        lines.append(f"KBZ Tx: {payment['receipt_tx_id']}")
    if note:
        lines.extend(["", note])
    return "\n".join(lines)


def _show_actions(status: ProofStatus, payment: dict) -> bool:
    if payment.get("status") != "pending":
        return False
    return status == "manual_review"


async def post_payment_proof(
    bot: Bot,
    payment_id: int,
    payment: dict,
    photo_file_id: str | None = None,
    status: ProofStatus = "verifying",
    *,
    note: str = "",
) -> None:
    """Send proof to the admin group (text by default; optional legacy photo)."""
    if not config.PAYMENTS_PROOFS_GROUP_ID:
        logger.warning("PAYMENTS_PROOFS_GROUP_ID not set — skipping proof post")
        return

    caption = build_proof_caption(payment, payment_id, status, note=note)
    markup: InlineKeyboardMarkup | None = None
    if _show_actions(status, payment):
        markup = group_proof_actions(payment_id)

    try:
        if photo_file_id:
            msg = await bot.send_photo(
                chat_id=config.PAYMENTS_PROOFS_GROUP_ID,
                photo=photo_file_id,
                caption=caption,
                reply_markup=markup,
            )
        else:
            msg = await bot.send_message(
                chat_id=config.PAYMENTS_PROOFS_GROUP_ID,
                text=caption,
                reply_markup=markup,
            )
        await db.save_proof_message(
            payment_id, config.PAYMENTS_PROOFS_GROUP_ID, msg.message_id
        )
    except Exception:
        logger.exception("Failed to post payment proof #%s to group", payment_id)


async def update_payment_proof(
    bot: Bot,
    payment_id: int,
    status: ProofStatus,
    *,
    note: str = "",
) -> None:
    """Update an existing proofs-group message caption/text and action buttons."""
    payment = await db.get_payment(payment_id)
    if not payment:
        return

    chat_id = payment.get("proof_chat_id")
    message_id = payment.get("proof_message_id")
    if not chat_id or not message_id:
        await post_payment_proof(
            bot,
            payment_id,
            payment,
            payment.get("receipt_file_id"),
            status,
            note=note,
        )
        return

    caption = build_proof_caption(payment, payment_id, status, note=note)
    markup: InlineKeyboardMarkup | None = None
    if _show_actions(status, payment):
        markup = group_proof_actions(payment_id)

    try:
        if payment.get("receipt_file_id"):
            await bot.edit_message_caption(
                chat_id=chat_id,
                message_id=message_id,
                caption=caption,
                reply_markup=markup,
            )
        else:
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text=caption,
                reply_markup=markup,
            )
    except Exception:
        logger.exception("Failed to update payment proof #%s in group", payment_id)
