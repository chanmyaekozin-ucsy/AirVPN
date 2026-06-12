"""Free-tier VLESS provisioning after daily gift claim."""
from __future__ import annotations

import logging

import database as db
from vps.panel_client import PanelError, provision_free_vless

logger = logging.getLogger(__name__)


async def sync_free_vpn_after_claim(
    user_id: int,
    telegram_id: int,
    total_mb: int,
) -> dict:
    """
    Provision or reset free VLESS — call only from daily gift claim.
    Returns {'provisioned': bool, 'vless_key'?: str, 'error'?: str}.
    """
    free_plan = await db.get_free_plan()
    if not free_plan:
        return {"provisioned": False, "error": "free_plan_missing"}

    free_sub = await db.get_active_free_subscription(user_id)
    existing_uuid = free_sub["vless_uuid"] if free_sub else None

    try:
        uid, email, vless_key = await provision_free_vless(
            telegram_id, total_mb, existing_uuid
        )
    except PanelError as e:
        logger.exception("Free VLESS provision failed for tg %s", telegram_id)
        return {"provisioned": False, "error": str(e)}

    limit_gb = total_mb / 1024
    if free_sub:
        await db.update_free_subscription(
            free_sub["id"], uid, vless_key, email, limit_gb
        )
    else:
        await db.create_free_subscription(
            user_id, free_plan["id"], uid, vless_key, email, limit_gb
        )

    return {"provisioned": True, "vless_key": vless_key, "total_mb": total_mb}
