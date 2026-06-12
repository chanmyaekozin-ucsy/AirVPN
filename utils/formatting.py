"""Telegram HTML escaping for dynamic message content."""
from __future__ import annotations

import html

from telegram.constants import ParseMode

# Default parse mode for bot UI messages (locales use HTML tags).
PARSE_MODE = ParseMode.HTML


def md2(text: object) -> str:
    """Escape dynamic text for HTML messages."""
    return html.escape(str(text))


def md2_code(text: object) -> str:
    """Escape dynamic text placed inside <code>…</code> in locale templates."""
    return html.escape(str(text))
