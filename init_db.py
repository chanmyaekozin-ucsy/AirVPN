#!/usr/bin/env python3
"""Sync plans from .env and seed payment accounts."""
from __future__ import annotations

import asyncio

import aiosqlite

import config
import database as db
from vpn_servers import list_servers


async def seed() -> None:
    async with aiosqlite.connect(config.SQLITE_PATH) as conn:
        await db.init_db()
        await db.sync_plans_from_env()

        print("VPN servers:")
        for server in list_servers():
            print(f"  • {server.id}: {server.name_en} ({len(server.plans)} plans)")

        await conn.execute("DELETE FROM payment_accounts")
        await conn.execute(
            """INSERT INTO payment_accounts (method, account_number, account_name, is_active)
            VALUES ('KBZPay', '09948999939', 'Si Thu Maung', 1)"""
        )
        print("Payment account: 09948999939 (Si Thu Maung)")

        await conn.commit()
        print("Done.")


if __name__ == "__main__":
    asyncio.run(seed())
