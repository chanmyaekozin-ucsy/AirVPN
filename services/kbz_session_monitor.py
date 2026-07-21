"""Hourly KBZPay session health check (read-only).

Does not refresh or write tokens — Donimate Payment Manager is the only writer.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from telegram import Bot

import config
from payments.kbz.session_store import probe_session

logger = logging.getLogger(__name__)

_last_state: str | None = None


async def notify_proofs_group(bot: Bot, text: str) -> None:
    gid = config.PAYMENTS_PROOFS_GROUP_ID
    if not gid:
        logger.warning("PAYMENTS_PROOFS_GROUP_ID not set — KBZ alert not sent")
        return
    try:
        await bot.send_message(gid, text)
    except Exception:
        logger.exception("Failed to send KBZ session alert to proofs group")


def _session_path() -> Path:
    return Path(config.KBZ_SESSION_PATH)


async def run_kbz_session_check(bot: Bot) -> None:
    """Probe shared session; alert proofs group on state changes. Never writes."""
    global _last_state

    if not config.KBZ_AUTO_VERIFY:
        return

    session_path = _session_path()
    ok, err = await asyncio.to_thread(probe_session, session_path)

    if ok:
        if _last_state == "invalid":
            await notify_proofs_group(
                bot,
                "✅ KBZ auto-verify is working again.\n"
                "Payment receipts can be approved automatically.",
            )
        _last_state = "ok"
        logger.info("KBZ session check OK")
        return

    logger.warning("KBZ session invalid: %s", err)
    if _last_state != "invalid":
        await notify_proofs_group(
            bot,
            "⚠️ KBZ auto-verify is OFF — session expired.\n\n"
            "Payments need manual approval until the session is renewed.\n\n"
            "Fix in **Donimate Payment Manager** only:\n"
            "• Session → upload / Login\n"
            "• Keep KBZPay closed on the phone after login\n\n"
            f"Shared path: `{session_path}`",
        )
    _last_state = "invalid"


async def kbz_session_monitor_loop(bot: Bot) -> None:
    interval = max(300, config.KBZ_SESSION_CHECK_INTERVAL_SEC)
    await asyncio.sleep(30)
    while True:
        try:
            await run_kbz_session_check(bot)
        except Exception:
            logger.exception("KBZ session monitor tick failed")
        await asyncio.sleep(interval)
