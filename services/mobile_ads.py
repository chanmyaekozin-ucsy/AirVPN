"""Admin helpers for first-party mobile ads (banner + connect dialog)."""
from __future__ import annotations

from typing import Any

import database as db


def format_ads_list(rows: list[dict[str, Any]], lang: str) -> str:
    from locales import t

    if not rows:
        return t(lang, "admin_app_ads_empty")
    lines = [t(lang, "admin_app_ads_title"), ""]
    for i, row in enumerate(rows, start=1):
        state = "ON" if row.get("enabled") else "OFF"
        w = int(row.get("image_width") or 0)
        h = int(row.get("image_height") or 0)
        size = f"{w}x{h}" if w > 0 and h > 0 else "auto"
        lines.append(
            t(
                lang,
                "admin_app_ads_row",
                n=i,
                placement=(row.get("placement") or "?").upper(),
                pid=row.get("public_id") or "?",
                size=size,
                state=state,
            )
        )
    return "\n".join(lines)


async def handle_ad_command(text: str) -> tuple[bool, str]:
    """
    Parse admin ad commands.
    ad add placement|id|image_url|click_url|[width]|[height]|[title]
    ad on|off|del <id>
    """
    raw = (text or "").strip()
    lower = raw.lower()

    if lower.startswith("ad add "):
        payload = raw[7:].strip()
        parts = [p.strip() for p in payload.split("|")]
        if len(parts) < 3:
            return False, "admin_app_ads_bad"
        placement = parts[0].lower()
        public_id = parts[1]
        image_url = parts[2]
        click_url = parts[3] if len(parts) > 3 else ""
        width = int(parts[4]) if len(parts) > 4 and parts[4].isdigit() else 0
        height = int(parts[5]) if len(parts) > 5 and parts[5].isdigit() else 0
        title = parts[6] if len(parts) > 6 else ""
        if placement not in ("banner", "dialog"):
            return False, "admin_app_ads_bad"
        if not public_id or not image_url:
            return False, "admin_app_ads_bad"
        await db.upsert_mobile_ad(
            public_id=public_id,
            placement=placement,
            image_url=image_url,
            click_url=click_url,
            title=title,
            image_width=width,
            image_height=height,
            enabled=True,
        )
        return True, "admin_app_ads_ok"

    if lower.startswith("ad on "):
        pid = raw[6:].strip()
        ok = await db.set_mobile_ad_enabled(pid, True)
        return (ok, "admin_app_ads_ok" if ok else "admin_app_ads_bad")

    if lower.startswith("ad off "):
        pid = raw[7:].strip()
        ok = await db.set_mobile_ad_enabled(pid, False)
        return (ok, "admin_app_ads_ok" if ok else "admin_app_ads_bad")

    if lower.startswith("ad del "):
        pid = raw[7:].strip()
        ok = await db.delete_mobile_ad(pid)
        return (ok, "admin_app_ads_ok" if ok else "admin_app_ads_bad")

    return False, "admin_app_ads_bad"
