"""Shared payment approval — admin manual + KBZ auto-verify."""
from __future__ import annotations

import logging

from telegram import Bot

import database as db
from locales import t
from utils.formatting import md2
from utils.vless_delivery import deliver_vless_key
from vps.panel_client import PanelError, provision_vless

logger = logging.getLogger(__name__)


async def approve_and_deliver(
    bot: Bot,
    payment_id: int,
    *,
    processed_by: int = 0,
    auto: bool = False,
    tx_id: str | None = None,
) -> tuple[bool, str]:
    """Provision VLESS and notify user. Returns (success, message)."""
    payment = await db.get_payment(payment_id)
    if not payment or payment["status"] != "pending":
        return False, "Payment not pending"

    if tx_id and not await db.try_claim_tx_id(payment_id, tx_id):
        return False, "Transaction ID already used"

    try:
        uid, email, vless_key = await provision_vless(
            payment["telegram_id"],
            payment["data_gb"],
            payment["duration_days"],
            server_id=payment.get("server_id") or "sg",
        )
    except PanelError as e:
        logger.error("Panel error for payment %s: %s", payment_id, e)
        return False, "Panel provisioning failed"
    except Exception:
        logger.exception("provision failed for payment %s", payment_id)
        return False, "Provisioning failed"

    result = await db.approve_payment(
        payment_id,
        processed_by,
        uid,
        vless_key,
        email,
        auto_verified=auto,
    )
    if not result:
        return False, "Payment already processed"

    user_row = await db.get_or_create_user(payment["telegram_id"])
    u_lang = user_row.get("language", "my")
    try:
        msg_key = "pay_approved_auto" if auto else "pay_approved_user"
        summary = t(
            u_lang,
            msg_key,
            plan=md2(payment["plan_title"]),
            data_gb=md2(payment["data_gb"]),
            days=payment["duration_days"],
        )
        sub = await db.get_subscription_by_payment_id(payment_id)
        await deliver_vless_key(
            bot=bot,
            chat_id=payment["telegram_id"],
            lang=u_lang,
            vless_key=vless_key,
            prefix_text=summary,
            sub_id=sub["id"] if sub else None,
        )
    except Exception:
        logger.exception("Failed to notify user %s", payment["telegram_id"])

    return True, "approved"
