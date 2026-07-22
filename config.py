"""AirVPN Telegram bot configuration."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ENV: str = os.getenv("ENV", "production").strip().lower()
DEV_MOCK_VPN: bool = os.getenv("DEV_MOCK_VPN", "false").lower() in ("1", "true", "yes")

BOT_TOKEN: str = os.getenv("BOT_TOKEN", "")

_default_db = Path(__file__).resolve().parent / "airvpn.sqlite3"
_env_db = os.getenv("SQLITE_PATH", "").strip()
SQLITE_PATH: str = _env_db if _env_db else str(_default_db)

# Comma-separated Telegram user IDs with full admin access
_admin_raw = os.getenv("ADMIN_TELEGRAM_IDS", "")
ADMIN_TELEGRAM_IDS: list[int] = [
    int(x.strip()) for x in _admin_raw.split(",") if x.strip().isdigit()
]

# Support Telegram usernames (comma-separated, no @) — shown as Admin 1, Admin 2 buttons
_admin_accounts_raw = os.getenv("ADMIN_ACCOUNTS", "")
ADMIN_ACCOUNTS: list[str] = [
    x.strip().lstrip("@") for x in _admin_accounts_raw.split(",") if x.strip()
]

# Telegram group for payment receipt screenshots (negative supergroup id)
_proofs_group_raw = os.getenv("PAYMENTS_PROOFS_GROUP_ID", "").strip()
PAYMENTS_PROOFS_GROUP_ID: int | None = (
    int(_proofs_group_raw) if _proofs_group_raw.lstrip("-").isdigit() else None
)

# ─── 3x-ui panel (VLESS auto-provisioning) ───────────────────────────────────
PANEL_URL: str = os.getenv("PANEL_URL", "").rstrip("/")
PANEL_USERNAME: str = os.getenv("PANEL_USERNAME", "")
PANEL_PASSWORD: str = os.getenv("PANEL_PASSWORD", "")
PANEL_INBOUND_ID: int = int(os.getenv("PANEL_INBOUND_ID", "1"))
PANEL_VERIFY_SSL: bool = os.getenv("PANEL_VERIFY_SSL", "true").lower() in (
    "1",
    "true",
    "yes",
)

# Public VPS endpoint shown in vless:// URL
VPS_HOST: str = os.getenv("VPS_HOST", "")
VPS_PORT: int = int(os.getenv("VPS_PORT", "443"))
VLESS_FLOW: str = os.getenv("VLESS_FLOW", "xtls-rprx-vision")
VLESS_SECURITY: str = os.getenv("VLESS_SECURITY", "reality")
VLESS_SNI: str = os.getenv("VLESS_SNI", "")
VLESS_FP: str = os.getenv("VLESS_FP", "chrome")
VLESS_PBK: str = os.getenv("VLESS_PBK", "")
VLESS_SID: str = os.getenv("VLESS_SID", "")
VLESS_SPX: str = os.getenv("VLESS_SPX", "/")

# Daily gift: resets to this amount each claim (not stacked)
DAILY_GIFT_MB: int = int(os.getenv("DAILY_GIFT_MB", "500"))
DAILY_STREAK_BONUS_MB: int = int(os.getenv("DAILY_STREAK_BONUS_MB", "10"))
MAX_DAILY_STREAK: int = int(os.getenv("MAX_DAILY_STREAK", "7"))

# Free tier VLESS: expiry extended on each daily claim
FREE_SUB_EXPIRY_DAYS: int = int(os.getenv("FREE_SUB_EXPIRY_DAYS", "1"))
# Server ID for daily-gift free keys (must match a VPN_SERVERS entry, e.g. sg)
FREE_KEYS_LOCATION: str = os.getenv("FREE_KEYS_LOCATION", "sg").strip().lower()

# Paid plans marked "Unlimited Date" use this subscription length (~100 years)
UNLIMITED_PLAN_DAYS: int = int(os.getenv("UNLIMITED_PLAN_DAYS", "36500"))

# Myanmar timezone offset (UTC+6:30)
MMT_OFFSET_HOURS: float = 6.5

# Per-user VPN subscription URL (v2rayNG / Hiddify auto-update + usage display)
SUB_PUBLIC_BASE_URL: str = os.getenv("SUB_PUBLIC_BASE_URL", "").rstrip("/")
SUB_SERVER_HOST: str = os.getenv("SUB_SERVER_HOST", "0.0.0.0")
SUB_SERVER_PORT: int = int(os.getenv("SUB_SERVER_PORT", "8080"))
SUB_ENABLED: bool = bool(SUB_PUBLIC_BASE_URL)

# ─── AirVPN Android app ───────────────────────────────────────────────────────
AIRVPN_TELEGRAM_URL: str = os.getenv(
    "AIRVPN_TELEGRAM_URL", "https://t.me/airvpn_myanmar_bot"
).strip()
AIRVPN_PLAY_URL: str = os.getenv(
    "AIRVPN_PLAY_URL",
    "https://play.google.com/store/apps/details?id=com.airvpn.app",
).strip()
AIRVPN_APP_DEEP_LINK: str = os.getenv(
    "AIRVPN_APP_DEEP_LINK", "airvpn://open"
).strip()
AIRVPN_BUY_DEEP_LINK: str = os.getenv(
    "AIRVPN_BUY_DEEP_LINK", AIRVPN_TELEGRAM_URL
).strip()
# Public HTTPS base for Admin deep-link buttons (Telegram requires http/https URLs)
MOBILE_API_PUBLIC_BASE: str = os.getenv(
    "MOBILE_API_PUBLIC_BASE", "https://airvpn.flash-myanmar.com"
).rstrip("/")
MOBILE_CONFIG_KEY: str = os.getenv("MOBILE_CONFIG_KEY", "").strip()
MOBILE_API_HOST: str = os.getenv("MOBILE_API_HOST", "0.0.0.0")
MOBILE_API_PORT: int = int(os.getenv("MOBILE_API_PORT", "8081"))

# ─── KBZPay auto-verify ───────────────────────────────────────────────────────
KBZ_AUTO_VERIFY: bool = os.getenv("KBZ_AUTO_VERIFY", "true").lower() in (
    "1",
    "true",
    "yes",
)
_default_kbz_session = Path(__file__).resolve().parent / "kbz_session.json"
_env_kbz_session = os.getenv("KBZ_SESSION_PATH", "").strip()
KBZ_SESSION_PATH: str = _env_kbz_session if _env_kbz_session else str(_default_kbz_session)
_env_claimed = os.getenv("KBZ_CLAIMED_TX_PATH", "").strip()
KBZ_CLAIMED_TX_PATH: str = _env_claimed or str(
    Path(KBZ_SESSION_PATH).expanduser().resolve().parent / "kbz_claimed_txs.sqlite3"
)
KBZ_BOT_CLAIM_NAME: str = os.getenv("KBZ_BOT_CLAIM_NAME", "airvpn").strip()
KBZ_MERCHANT_NAME: str = os.getenv("KBZ_MERCHANT_NAME", "")
KBZ_MERCHANT_PHONE: str = os.getenv("KBZ_MERCHANT_PHONE", "")
KBZ_TX_EXAMPLE: str = os.getenv("KBZ_TX_EXAMPLE", "82622").strip()
_default_sample_tx = Path(__file__).resolve().parent / "data" / "sample_txid.jpg"
_env_sample_tx = os.getenv("KBZ_SAMPLE_TX_IMAGE", "").strip()
KBZ_SAMPLE_TX_IMAGE: Path = Path(
    _env_sample_tx if _env_sample_tx else str(_default_sample_tx)
)

# Hourly KBZ session health check removed — Donimate Payment Manager owns that.
# AirVPN posts VPN panel / server status instead.
SERVER_STATUS_INTERVAL_SEC: int = int(
    os.getenv("SERVER_STATUS_INTERVAL_SEC", "3600")
)
# Unused on AirVPN — do not enable; Payment Manager is the only session writer
KBZ_FRIDA_LOG_PATH: str = os.getenv("KBZ_FRIDA_LOG_PATH", "").strip()

# Auto-reject KBZPay receipts when the transfer is older than this (hours)
PAYMENT_TX_MAX_AGE_HOURS: int = int(os.getenv("PAYMENT_TX_MAX_AGE_HOURS", "1"))

# Rate limits (per telegram user id)
RATE_DAILY_CLAIM_PER_DAY: int = int(os.getenv("RATE_DAILY_CLAIM_PER_DAY", "1"))
RATE_PAYMENT_PER_HOUR: int = int(os.getenv("RATE_PAYMENT_PER_HOUR", "5"))
RATE_KBZ_VERIFY_PER_HOUR: int = int(os.getenv("RATE_KBZ_VERIFY_PER_HOUR", "10"))
RATE_RECEIPT_SCREENSHOT_PER_MIN: int = int(
    os.getenv("RATE_RECEIPT_SCREENSHOT_PER_MIN", "2")
)

# VPN client download links — Play Store / App Store (label, url)
VPN_APPS_ANDROID: list[tuple[str, str]] = [
    (
        "v2rayNG",
        os.getenv(
            "VPN_ANDROID_V2RAYNG",
            "https://play.google.com/store/apps/details?id=com.v2ray.ang",
        ),
    ),
    (
        "Hiddify",
        os.getenv(
            "VPN_ANDROID_HIDDIFY",
            "https://play.google.com/store/apps/details?id=app.hiddify.com",
        ),
    ),
]
VPN_APPS_IOS: list[tuple[str, str]] = [
    (
        "Streisand",
        os.getenv(
            "VPN_IOS_STREISAND",
            "https://apps.apple.com/app/streisand/id6450534064",
        ),
    ),
    (
        "Hiddify",
        os.getenv(
            "VPN_IOS_HIDDIFY",
            "https://apps.apple.com/app/hiddify-proxy-vpn/id6594873375",
        ),
    ),
]
