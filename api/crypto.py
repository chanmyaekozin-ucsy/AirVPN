"""Encrypt connect payloads for the Android client + at-rest secrets."""
from __future__ import annotations

import base64
import hashlib
import os
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_AT_REST_PREFIX = "v1:"


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


def encrypt_at_rest(plaintext: str) -> str:
    """Encrypt a secret for SQLite storage (AES-GCM, MOBILE_CONFIG_KEY)."""
    text = plaintext or ""
    key = _key_bytes()
    aes = AESGCM(key)
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, text.encode("utf-8"), None)
    blob = base64.b64encode(nonce + ct).decode("ascii")
    return _AT_REST_PREFIX + blob


def decrypt_at_rest(blob: str | None) -> str:
    """Decrypt a value from encrypt_at_rest. Empty/invalid → empty string."""
    raw = (blob or "").strip()
    if not raw:
        return ""
    if not raw.startswith(_AT_REST_PREFIX):
        # Legacy plaintext — treat as already clear (should not happen for SSH)
        return raw
    try:
        data = base64.b64decode(raw[len(_AT_REST_PREFIX) :], validate=True)
        if len(data) < 13:
            return ""
        nonce, ct = data[:12], data[12:]
        aes = AESGCM(_key_bytes())
        return aes.decrypt(nonce, ct, None).decode("utf-8")
    except Exception:
        return ""


def key_fingerprint() -> str:
    return hashlib.sha256(_key_bytes()).hexdigest()[:16]
