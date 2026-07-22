"""Encrypt connect payloads for the Android client."""
from __future__ import annotations

import base64
import hashlib
import os
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _key_bytes() -> bytes:
    raw = os.getenv("MOBILE_CONFIG_KEY", "").strip()
    if not raw:
        # Dev fallback — never use empty in production
        raw = "airvpn-dev-only-change-me-32b!!"
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return digest


def encrypt_config_payload(plaintext: str, *, ttl_sec: int = 120) -> dict[str, str | int]:
    """AES-GCM encrypt; returns nonce+ciphertext (base64) and expiry unix."""
    key = _key_bytes()
    aes = AESGCM(key)
    nonce = os.urandom(12)
    expires_at = int(time.time()) + ttl_sec
    body = f"{expires_at}|{plaintext}".encode("utf-8")
    ct = aes.encrypt(nonce, body, None)
    return {
        "alg": "AES-256-GCM",
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "ciphertext": base64.b64encode(ct).decode("ascii"),
        "expires_at": expires_at,
    }


def key_fingerprint() -> str:
    return hashlib.sha256(_key_bytes()).hexdigest()[:16]
