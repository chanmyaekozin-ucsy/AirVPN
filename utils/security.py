"""Startup validation and security helpers."""
from __future__ import annotations

import logging
import sys

import config

logger = logging.getLogger(__name__)

ALLOWED_LANGUAGES = frozenset({"my", "en"})


def validate_language(lang: str) -> str:
    return lang if lang in ALLOWED_LANGUAGES else "my"


def validate_production_config() -> None:
    """Fail fast when production settings are missing or unsafe."""
    errors: list[str] = []

    if not config.BOT_TOKEN:
        errors.append("BOT_TOKEN is required")

    if not config.ADMIN_TELEGRAM_IDS:
        errors.append("ADMIN_TELEGRAM_IDS must list at least one admin")

    if not config.DEV_MOCK_VPN:
        from vpn_servers import list_servers

        servers = list_servers()
        if not servers:
            errors.append(
                "Configure VPN_SERVERS and VPN_SERVER_* plans in .env "
                "(or set DEV_MOCK_VPN=true for dev)"
            )
        for server in servers:
            if not server.panel_url or not server.vps_host:
                errors.append(
                    f"Server {server.id!r}: panel URL and VPS host required"
                )
            if not server.panel_password:
                errors.append(f"Server {server.id!r}: panel password required")

    if config.KBZ_AUTO_VERIFY:
        from pathlib import Path

        if not Path(config.KBZ_SESSION_PATH).is_file():
            errors.append(f"KBZ session file missing: {config.KBZ_SESSION_PATH}")

    if errors:
        for err in errors:
            logger.error("Config error: %s", err)
        sys.exit(1)

    logger.info("Production config validation passed")
