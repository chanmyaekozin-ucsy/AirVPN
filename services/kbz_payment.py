"""Async wrapper for KBZPay receipt verification."""
from __future__ import annotations

import asyncio
from pathlib import Path

import config
from payments.kbz.verify import KbzPaymentVerifier, VerifyResult, load_verifier


def _verifier() -> KbzPaymentVerifier | None:
    if not config.KBZ_AUTO_VERIFY:
        return None
    return load_verifier(
        Path(config.KBZ_SESSION_PATH),
        config.KBZ_MERCHANT_NAME,
        config.KBZ_MERCHANT_PHONE,
    )


async def verify_receipt_image(image_bytes: bytes, expected_ks: int) -> VerifyResult:
    v = _verifier()
    if not v:
        return VerifyResult("error", "KBZ auto-verify not configured")
    return await asyncio.to_thread(v.verify_receipt_image, image_bytes, expected_ks)


async def verify_transaction_id(trans_id: str, expected_ks: int) -> VerifyResult:
    v = _verifier()
    if not v:
        return VerifyResult("error", "KBZ auto-verify not configured")
    return await asyncio.to_thread(v.verify_transaction_id, trans_id, expected_ks)
