"""Admin broadcast notifications to bot users."""
from __future__ import annotations

import asyncio
import logging

from telegram import Bot
from telegram.error import BadRequest, Forbidden, RetryAfter, TelegramError

import database as db
from locales import t
from utils.formatting import PARSE_MODE, md2

logger = logging.getLogger(__name__)

VALID_AUDIENCES = frozenset({"all", "paid", "active"})

# Expected delivery failures — user blocked bot, deleted account, etc.
_SKIP_MESSAGE_MARKERS = (
    "blocked by the user",
    "user is deactivated",
    "chat not found",
    "bot can't initiate conversation",
    "bot was kicked",
    "have no rights to send",
    "peer_id_invalid",
)


def normalize_audience(audience: str) -> str:
    key = (audience or "all").strip().lower()
    if key in ("paying", "paid_users", "paid-users"):
        return "paid"
    if key not in VALID_AUDIENCES:
        raise ValueError("audience must be all, paid, or active")
    return key


def _is_undeliverable(exc: BaseException) -> bool:
    if isinstance(exc, Forbidden):
        return True
    msg = str(exc).lower()
    return any(m in msg for m in _SKIP_MESSAGE_MARKERS)


async def broadcast_notification(
    bot: Bot,
    audience: str,
    message: str,
    admin_telegram_id: int,
) -> tuple[int, int, int]:
    """
    Send notification to users. Returns (notification_id, sent_count, failed_count).
    audience: 'all' | 'paid' | 'active'
    """
    audience = normalize_audience(audience)
    text_body = (message or "").strip()
    if not text_body:
        raise ValueError("message is required")

    targets = await db.get_broadcast_telegram_ids(audience)
    sent = 0
    failed = 0
    skipped = 0

    for telegram_id in targets:
        user_row = await db.get_or_create_user(telegram_id)
        lang = user_row.get("language") or "my"
        text = t(lang, "user_notification", message=md2(text_body))
        try:
            await bot.send_message(telegram_id, text, parse_mode=PARSE_MODE)
            sent += 1
        except RetryAfter as exc:
            wait = float(getattr(exc, "retry_after", 1) or 1)
            logger.warning("Notify rate-limited; sleeping %.1fs", wait)
            await asyncio.sleep(wait)
            try:
                await bot.send_message(telegram_id, text, parse_mode=PARSE_MODE)
                sent += 1
            except Exception as retry_exc:
                if _is_undeliverable(retry_exc):
                    skipped += 1
                    logger.debug("Notify skip %s: %s", telegram_id, retry_exc)
                else:
                    failed += 1
                    logger.warning("Notify failed for %s: %s", telegram_id, retry_exc)
        except (Forbidden, BadRequest) as exc:
            if _is_undeliverable(exc):
                skipped += 1
                logger.debug("Notify skip %s: %s", telegram_id, exc)
            else:
                failed += 1
                logger.warning("Notify failed for %s: %s", telegram_id, exc)
        except TelegramError as exc:
            if _is_undeliverable(exc):
                skipped += 1
                logger.debug("Notify skip %s: %s", telegram_id, exc)
            else:
                failed += 1
                logger.warning("Notify failed for %s: %s", telegram_id, exc)
        except Exception:
            failed += 1
            logger.exception("Notify failed for %s", telegram_id)
        await asyncio.sleep(0.05)

    # Count undeliverable (blocked) as failed for admin stats, without traceback spam
    failed_total = failed + skipped
    if skipped:
        logger.info(
            "Notify done audience=%s sent=%s failed=%s skipped_blocked=%s",
            audience,
            sent,
            failed,
            skipped,
        )

    notif_id = await db.save_notification(
        audience, text_body, admin_telegram_id, sent, failed_total
    )
    return notif_id, sent, failed_total
