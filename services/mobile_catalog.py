"""Admin helpers for the mobile app server catalog."""
from __future__ import annotations

from typing import Any

import database as db


def format_server_list(rows: list[dict[str, Any]], lang: str) -> str:
    from locales import t

    if not rows:
        return t(lang, "admin_app_servers_empty")
    lines = [t(lang, "admin_app_servers_title"), ""]
    for i, row in enumerate(rows, start=1):
        state = "ON" if row.get("enabled") else "OFF"
        lines.append(
            t(
                lang,
                "admin_app_servers_row",
                n=i,
                tier=(row.get("tier") or "?").upper(),
                name=row.get("name") or "?",
                proto=(row.get("protocol") or "?").upper(),
                pid=row.get("public_id") or "?",
                state=state,
            )
        )
    return "\n".join(lines)


async def handle_ms_command(text: str) -> tuple[bool, str]:
    """
    Parse admin ms commands.
    Returns (ok, message_key_or_detail).
    """
    raw = (text or "").strip()
    lower = raw.lower()

    if lower.startswith("ms add "):
        payload = raw[7:].strip()
        parts = [p.strip() for p in payload.split("|")]
        if len(parts) < 6:
            return False, "admin_app_servers_bad"
        public_id, name, region, protocol, tier, vpn_server_id = parts[:6]
        plan_id = None
        config_uri = None
        if tier.lower() == "paid":
            if len(parts) < 7 or not parts[6].isdigit():
                return False, "admin_app_servers_bad"
            plan_id = int(parts[6])
        else:
            config_uri = parts[6] if len(parts) > 6 else None
            if not config_uri:
                return False, "admin_app_servers_bad"
        await db.upsert_mobile_server(
            public_id=public_id,
            name=name,
            region=region,
            protocol=protocol,
            tier=tier,
            vpn_server_id=vpn_server_id or None,
            plan_id=plan_id,
            config_uri=config_uri,
            enabled=True,
        )
        return True, "admin_app_servers_ok"

    if lower.startswith("ms on "):
        pid = raw[6:].strip()
        ok = await db.set_mobile_server_enabled(pid, True)
        return (ok, "admin_app_servers_ok" if ok else "admin_app_servers_bad")

    if lower.startswith("ms off "):
        pid = raw[7:].strip()
        ok = await db.set_mobile_server_enabled(pid, False)
        return (ok, "admin_app_servers_ok" if ok else "admin_app_servers_bad")

    if lower.startswith("ms del "):
        pid = raw[7:].strip()
        ok = await db.delete_mobile_server(pid)
        return (ok, "admin_app_servers_ok" if ok else "admin_app_servers_bad")

    return False, "admin_app_servers_bad"
