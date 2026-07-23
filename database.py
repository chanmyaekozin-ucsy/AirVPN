"""Async SQLite database for AirVPN bot."""
from __future__ import annotations

import json
import re
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Optional

import aiosqlite

import config

MMT = timezone(timedelta(hours=config.MMT_OFFSET_HOURS))


def mmt_now() -> datetime:
    return datetime.now(MMT)


def mmt_today() -> str:
    return mmt_now().strftime("%Y-%m-%d")


def new_sub_token() -> str:
    return secrets.token_urlsafe(24)


@asynccontextmanager
async def _db() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("PRAGMA journal_mode = WAL")
        await db.execute("PRAGMA busy_timeout = 5000")
        yield db


async def init_db() -> None:
    async with aiosqlite.connect(config.SQLITE_PATH) as db:
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER NOT NULL UNIQUE,
                username TEXT,
                first_name TEXT,
                language TEXT NOT NULL DEFAULT 'my',
                is_banned INTEGER NOT NULL DEFAULT 0,
                daily_streak INTEGER NOT NULL DEFAULT 0,
                last_daily_claim TEXT,
                bonus_data_mb INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                data_gb REAL NOT NULL,
                price_ks INTEGER NOT NULL,
                duration_days INTEGER NOT NULL DEFAULT 30,
                is_active INTEGER NOT NULL DEFAULT 1,
                is_free INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS payment_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                method TEXT NOT NULL,
                account_number TEXT NOT NULL,
                account_name TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                plan_id INTEGER NOT NULL,
                method TEXT NOT NULL,
                amount_ks INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                receipt_file_id TEXT,
                receipt_note TEXT,
                processed_by INTEGER,
                reject_reason TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                processed_at TEXT,
                receipt_tx_id TEXT,
                verify_status TEXT,
                verify_message TEXT,
                auto_verified INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (plan_id) REFERENCES plans(id)
            );

            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                plan_id INTEGER NOT NULL,
                payment_id INTEGER,
                vless_uuid TEXT NOT NULL,
                vless_key TEXT NOT NULL,
                panel_email TEXT,
                data_limit_gb REAL NOT NULL,
                data_used_gb REAL NOT NULL DEFAULT 0,
                bonus_data_mb INTEGER NOT NULL DEFAULT 0,
                expires_at TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                is_free INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                FOREIGN KEY (payment_id) REFERENCES payments(id)
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                audience TEXT NOT NULL,
                message TEXT NOT NULL,
                sent_by INTEGER NOT NULL,
                sent_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
            CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id, is_active);

            CREATE TABLE IF NOT EXISTS key_replacements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subscription_id INTEGER NOT NULL,
                from_server TEXT NOT NULL,
                to_server TEXT NOT NULL,
                feedback TEXT NOT NULL,
                remaining_gb REAL NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
            );

            CREATE TABLE IF NOT EXISTS bot_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        await _migrate_columns(db)
        await db.commit()


async def _migrate_columns(db: aiosqlite.Connection) -> None:
    async with db.execute("PRAGMA table_info(plans)") as cur:
        plan_cols = {r[1] for r in await cur.fetchall()}
    if "is_free" not in plan_cols:
        await db.execute("ALTER TABLE plans ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0")
    if "server_id" not in plan_cols:
        await db.execute(
            "ALTER TABLE plans ADD COLUMN server_id TEXT NOT NULL DEFAULT 'sg'"
        )

    async with db.execute("PRAGMA table_info(subscriptions)") as cur:
        sub_cols = {r[1] for r in await cur.fetchall()}
    if "is_free" not in sub_cols:
        await db.execute(
            "ALTER TABLE subscriptions ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0"
        )
    if "server_id" not in sub_cols:
        await db.execute(
            "ALTER TABLE subscriptions ADD COLUMN server_id TEXT NOT NULL DEFAULT 'sg'"
        )

    async with db.execute("PRAGMA table_info(payments)") as cur:
        pay_cols = {r[1] for r in await cur.fetchall()}
    for col, ddl in (
        ("receipt_tx_id", "ALTER TABLE payments ADD COLUMN receipt_tx_id TEXT"),
        ("verify_status", "ALTER TABLE payments ADD COLUMN verify_status TEXT"),
        ("verify_message", "ALTER TABLE payments ADD COLUMN verify_message TEXT"),
        ("auto_verified", "ALTER TABLE payments ADD COLUMN auto_verified INTEGER NOT NULL DEFAULT 0"),
        ("proof_chat_id", "ALTER TABLE payments ADD COLUMN proof_chat_id INTEGER"),
        ("proof_message_id", "ALTER TABLE payments ADD COLUMN proof_message_id INTEGER"),
        ("server_id", "ALTER TABLE payments ADD COLUMN server_id TEXT NOT NULL DEFAULT 'sg'"),
    ):
        if col not in pay_cols:
            await db.execute(ddl)

    await db.execute("DROP INDEX IF EXISTS idx_payments_tx_unique")
    await db.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_tx_unique
           ON payments(receipt_tx_id) WHERE receipt_tx_id IS NOT NULL"""
    )

    async with db.execute("SELECT id FROM plans WHERE is_free = 1 LIMIT 1") as cur:
        if not await cur.fetchone():
            await db.execute(
                """INSERT INTO plans (title, data_gb, price_ks, duration_days, is_active, is_free, sort_order)
                   VALUES ('အခမဲ့ နေ့စဉ်', 0, 0, 1, 1, 1, 0)"""
            )

    async with db.execute("PRAGMA table_info(users)") as cur:
        user_cols = {r[1] for r in await cur.fetchall()}
    if "sub_token" not in user_cols:
        await db.execute(
            "ALTER TABLE users ADD COLUMN sub_token TEXT"
        )
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sub_token ON users(sub_token)"
        )
        async with db.execute(
            "SELECT id FROM users WHERE sub_token IS NULL OR sub_token = ''"
        ) as cur:
            rows = await cur.fetchall()
        for row in rows:
            await db.execute(
                "UPDATE users SET sub_token = ? WHERE id = ?",
                (new_sub_token(), row[0]),
            )

    await db.executescript(
        """
        CREATE TABLE IF NOT EXISTS restore_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            code_hash TEXT NOT NULL UNIQUE,
            code_hint TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            revoked_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_restore_user ON restore_codes(user_id);

        CREATE TABLE IF NOT EXISTS mobile_servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            region TEXT NOT NULL DEFAULT '',
            protocol TEXT NOT NULL DEFAULT 'vless',
            tier TEXT NOT NULL DEFAULT 'free',
            vpn_server_id TEXT,
            plan_id INTEGER,
            config_uri TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (plan_id) REFERENCES plans(id)
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_servers_tier
            ON mobile_servers(tier, enabled, sort_order);
        """
    )

    # Free catalog sub overrides (manual quota / expiry / nodes)
    async with db.execute("PRAGMA table_info(mobile_servers)") as cur:
        ms_cols = {r[1] for r in await cur.fetchall()}
    for col, ddl in (
        ("nodes_text", "ALTER TABLE mobile_servers ADD COLUMN nodes_text TEXT"),
        ("manual_total_bytes", "ALTER TABLE mobile_servers ADD COLUMN manual_total_bytes INTEGER"),
        ("manual_upload_bytes", "ALTER TABLE mobile_servers ADD COLUMN manual_upload_bytes INTEGER"),
        ("manual_download_bytes", "ALTER TABLE mobile_servers ADD COLUMN manual_download_bytes INTEGER"),
        ("manual_expire_at", "ALTER TABLE mobile_servers ADD COLUMN manual_expire_at INTEGER"),
        (
            "list_when_disabled",
            "ALTER TABLE mobile_servers ADD COLUMN list_when_disabled INTEGER NOT NULL DEFAULT 0",
        ),
    ):
        if col not in ms_cols:
            await db.execute(ddl)

    await db.executescript(
        """
        CREATE TABLE IF NOT EXISTS vpn_nodes (
            id TEXT PRIMARY KEY,
            name_en TEXT NOT NULL,
            name_my TEXT NOT NULL DEFAULT '',
            panel_url TEXT NOT NULL DEFAULT '',
            panel_username TEXT NOT NULL DEFAULT '',
            panel_password TEXT NOT NULL DEFAULT '',
            panel_inbound_id INTEGER NOT NULL DEFAULT 1,
            panel_verify_ssl INTEGER NOT NULL DEFAULT 1,
            vps_host TEXT NOT NULL DEFAULT '',
            vps_port INTEGER NOT NULL DEFAULT 443,
            vless_security TEXT NOT NULL DEFAULT 'reality',
            vless_flow TEXT NOT NULL DEFAULT 'xtls-rprx-vision',
            vless_sni TEXT NOT NULL DEFAULT '',
            vless_fp TEXT NOT NULL DEFAULT 'chrome',
            vless_pbk TEXT NOT NULL DEFAULT '',
            vless_sid TEXT NOT NULL DEFAULT '',
            vless_spx TEXT NOT NULL DEFAULT '/',
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_vpn_nodes_order
            ON vpn_nodes(enabled, sort_order, id);

        CREATE TABLE IF NOT EXISTS mobile_ads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_id TEXT NOT NULL UNIQUE,
            placement TEXT NOT NULL DEFAULT 'banner',
            title TEXT NOT NULL DEFAULT '',
            image_url TEXT NOT NULL,
            click_url TEXT NOT NULL DEFAULT '',
            image_width INTEGER NOT NULL DEFAULT 0,
            image_height INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_ads_placement
            ON mobile_ads(placement, enabled, sort_order);

        CREATE TABLE IF NOT EXISTS mobile_dau (
            day TEXT NOT NULL,
            device_id TEXT NOT NULL,
            first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (day, device_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_dau_day ON mobile_dau(day);

        CREATE TABLE IF NOT EXISTS mobile_ad_clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day TEXT NOT NULL,
            ad_id TEXT NOT NULL,
            placement TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_ad_clicks_day ON mobile_ad_clicks(day);
        CREATE INDEX IF NOT EXISTS idx_mobile_ad_clicks_ad
            ON mobile_ad_clicks(ad_id, day);

        -- Per-device VLESS keys for free catalog shared-pool mode (no login).
        CREATE TABLE IF NOT EXISTS free_device_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            parent_id TEXT NOT NULL,
            vpn_server_id TEXT NOT NULL,
            client_uuid TEXT NOT NULL,
            panel_email TEXT NOT NULL,
            vless_key TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(device_id, parent_id, vpn_server_id)
        );
        CREATE INDEX IF NOT EXISTS idx_free_device_keys_parent
            ON free_device_keys(parent_id);
        CREATE INDEX IF NOT EXISTS idx_free_device_keys_device
            ON free_device_keys(device_id, parent_id);

        -- Single-row mobile client config (updates, maintenance, download links).
        CREATE TABLE IF NOT EXISTS mobile_app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            min_version_code INTEGER NOT NULL DEFAULT 1,
            latest_version_code INTEGER NOT NULL DEFAULT 1,
            latest_version_name TEXT NOT NULL DEFAULT '1.0.0',
            force_update INTEGER NOT NULL DEFAULT 0,
            changelog TEXT NOT NULL DEFAULT '',
            maintenance INTEGER NOT NULL DEFAULT 0,
            maintenance_message TEXT NOT NULL DEFAULT '',
            telegram_url TEXT NOT NULL DEFAULT '',
            play_url TEXT NOT NULL DEFAULT '',
            update_url TEXT NOT NULL DEFAULT '',
            buy_url TEXT NOT NULL DEFAULT '',
            privacy_url TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admin_login_otps (
            telegram_id INTEGER PRIMARY KEY,
            code_hash TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_token
            ON admin_sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_user
            ON admin_sessions(telegram_id);
        """
    )


# ─── Users ───────────────────────────────────────────────────────────────────

async def get_or_create_user(
    telegram_id: int,
    username: str | None = None,
    first_name: str | None = None,
) -> dict[str, Any]:
    async with _db() as db:
        async with db.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        ) as cur:
            row = await cur.fetchone()
        if row:
            user = dict(row)
            if not user.get("sub_token"):
                token = new_sub_token()
                await db.execute(
                    "UPDATE users SET sub_token = ? WHERE id = ?",
                    (token, user["id"]),
                )
                await db.commit()
                user["sub_token"] = token
            return user
        token = new_sub_token()
        await db.execute(
            """INSERT INTO users (telegram_id, username, first_name, language, sub_token)
               VALUES (?, ?, ?, 'my', ?)""",
            (telegram_id, username, first_name, token),
        )
        await db.commit()
        async with db.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        ) as cur:
            return dict(await cur.fetchone())


async def get_user_by_sub_token(sub_token: str) -> dict[str, Any] | None:
    token = (sub_token or "").strip()
    if not token:
        return None
    async with _db() as db:
        async with db.execute(
            "SELECT * FROM users WHERE sub_token = ?", (token,)
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def set_user_language(telegram_id: int, language: str) -> None:
    async with _db() as db:
        await db.execute(
            "UPDATE users SET language = ? WHERE telegram_id = ?",
            (language, telegram_id),
        )
        await db.commit()


async def is_banned(telegram_id: int) -> bool:
    async with _db() as db:
        async with db.execute(
            "SELECT is_banned FROM users WHERE telegram_id = ?", (telegram_id,)
        ) as cur:
            row = await cur.fetchone()
    return bool(row and row["is_banned"])


async def get_user_by_telegram_id(telegram_id: int) -> dict[str, Any] | None:
    async with _db() as db:
        async with db.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def set_user_banned(telegram_id: int, banned: bool) -> bool:
    async with _db() as db:
        cur = await db.execute(
            "UPDATE users SET is_banned = ? WHERE telegram_id = ?",
            (1 if banned else 0, telegram_id),
        )
        await db.commit()
        return cur.rowcount > 0


async def count_users() -> int:
    async with _db() as db:
        async with db.execute("SELECT COUNT(*) AS c FROM users") as cur:
            return (await cur.fetchone())["c"]


async def list_users_with_key_counts(
    *, page: int = 1, per_page: int = 10
) -> dict[str, Any]:
    """Paginated users with active free/paid subscription counts."""
    page = max(1, page)
    per_page = max(1, per_page)
    offset = (page - 1) * per_page
    now = mmt_now().isoformat()
    async with _db() as db:
        async with db.execute("SELECT COUNT(*) AS c FROM users") as cur:
            total = int((await cur.fetchone())["c"])
        total_pages = max(1, (total + per_page - 1) // per_page)
        page = min(page, total_pages)
        offset = (page - 1) * per_page
        async with db.execute(
            """
            SELECT
                u.telegram_id,
                u.username,
                u.first_name,
                u.is_banned,
                COALESCE(f.c, 0) AS free_keys,
                COALESCE(p.c, 0) AS paid_keys
            FROM users u
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS c
                FROM subscriptions
                WHERE is_active = 1 AND is_free = 1 AND expires_at > ?
                GROUP BY user_id
            ) f ON f.user_id = u.id
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS c
                FROM subscriptions
                WHERE is_active = 1 AND is_free = 0 AND expires_at > ?
                GROUP BY user_id
            ) p ON p.user_id = u.id
            ORDER BY u.id DESC
            LIMIT ? OFFSET ?
            """,
            (now, now, per_page, offset),
        ) as cur:
            users = [dict(row) for row in await cur.fetchall()]
    return {
        "users": users,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


# ─── Bot settings ────────────────────────────────────────────────────────────

DAILY_GIFT_ENABLED_KEY = "daily_gift_enabled"
DAILY_GIFT_MB_KEY = "daily_gift_mb"


async def get_setting(key: str) -> str | None:
    async with _db() as db:
        async with db.execute(
            "SELECT value FROM bot_settings WHERE key = ?", (key,)
        ) as cur:
            row = await cur.fetchone()
    return row["value"] if row else None


async def set_setting(key: str, value: str) -> None:
    async with _db() as db:
        await db.execute(
            """INSERT INTO bot_settings (key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            (key, value),
        )
        await db.commit()


async def get_daily_gift_settings() -> dict[str, Any]:
    enabled_raw = await get_setting(DAILY_GIFT_ENABLED_KEY)
    mb_raw = await get_setting(DAILY_GIFT_MB_KEY)
    enabled = (enabled_raw if enabled_raw is not None else "1") == "1"
    try:
        mb = int(mb_raw) if mb_raw is not None else config.DAILY_GIFT_MB
    except (TypeError, ValueError):
        mb = config.DAILY_GIFT_MB
    mb = max(1, min(mb, 102_400))
    return {"enabled": enabled, "mb": mb}


async def set_daily_gift_enabled(enabled: bool) -> None:
    await set_setting(DAILY_GIFT_ENABLED_KEY, "1" if enabled else "0")


async def set_daily_gift_mb(mb: int) -> None:
    await set_setting(DAILY_GIFT_MB_KEY, str(max(1, min(int(mb), 102_400))))


# ─── Daily gift ──────────────────────────────────────────────────────────────

def _daily_gift_preview(
    user: aiosqlite.Row | dict[str, Any],
    *,
    enabled: bool,
    gift_mb: int,
) -> dict[str, Any]:
    """Compute today's gift without writing. Used before VPN provisioning."""
    if not enabled:
        return {"ok": False, "reason": "disabled"}

    today = mmt_today()
    if user["last_daily_claim"] == today:
        return {
            "ok": False,
            "reason": "already_claimed",
            "mb": user["bonus_data_mb"],
            "streak": user["daily_streak"],
            "total_mb": user["bonus_data_mb"],
        }

    yesterday = (mmt_now() - timedelta(days=1)).strftime("%Y-%m-%d")
    streak = user["daily_streak"]
    if user["last_daily_claim"] == yesterday:
        streak = min(streak + 1, config.MAX_DAILY_STREAK)
    else:
        streak = 1

    bonus_mb = gift_mb
    return {"ok": True, "mb": bonus_mb, "streak": streak, "total_mb": bonus_mb}


async def preview_daily_gift(user_id: int) -> dict[str, Any]:
    """Returns gift preview; ok=False with reason=already_claimed if claimed today."""
    settings = await get_daily_gift_settings()
    async with _db() as db:
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            user = await cur.fetchone()
    if not user:
        return {"ok": False, "reason": "no_user"}
    return _daily_gift_preview(
        user, enabled=settings["enabled"], gift_mb=settings["mb"]
    )


async def claim_daily_gift(user_id: int) -> dict[str, Any]:
    """Returns {'ok': bool, 'reason'?: str, 'mb'?: int, 'streak'?: int, 'total_mb'?: int}"""
    settings = await get_daily_gift_settings()
    today = mmt_today()
    async with _db() as db:
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            user = await cur.fetchone()
        if not user:
            return {"ok": False, "reason": "no_user"}

        preview = _daily_gift_preview(
            user, enabled=settings["enabled"], gift_mb=settings["mb"]
        )
        if not preview["ok"]:
            return preview

        await db.execute(
            """UPDATE users SET last_daily_claim = ?, daily_streak = ?, bonus_data_mb = ?
               WHERE id = ?""",
            (today, preview["streak"], preview["mb"], user_id),
        )
        # Reset daily bonus on paid subs (do not stack with previous claims)
        await db.execute(
            """UPDATE subscriptions SET bonus_data_mb = ?
               WHERE user_id = ? AND is_active = 1 AND is_free = 0""",
            (preview["mb"], user_id),
        )
        await db.commit()
        return preview


async def has_active_subscription(user_id: int) -> bool:
    sub = await get_active_subscription(user_id)
    return sub is not None


async def has_paid_subscription(user_id: int) -> bool:
    return await get_active_paid_subscription(user_id) is not None


async def get_free_plan() -> dict[str, Any] | None:
    async with _db() as db:
        async with db.execute(
            "SELECT * FROM plans WHERE is_free = 1 AND is_active = 1 LIMIT 1"
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


# ─── Plans ───────────────────────────────────────────────────────────────────

async def get_active_plans(server_id: str) -> list[dict[str, Any]]:
    async with _db() as db:
        async with db.execute(
            """SELECT * FROM plans WHERE is_active = 1 AND is_free = 0
               AND server_id = ?
               ORDER BY sort_order, price_ks""",
            (server_id,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def sync_plans_from_env() -> None:
    """Upsert paid plans from .env into SQLite (per server)."""
    from vpn_servers import (
        _load_server,
        find_unlisted_server_ids,
        list_servers,
        reload_servers,
    )

    reload_servers()
    servers = list(list_servers(include_disabled=True))
    seen = {s.id for s in servers}
    for sid in find_unlisted_server_ids():
        if sid in seen:
            continue
        extra = _load_server(sid)
        if extra and extra.plans:
            servers.append(extra)
            seen.add(sid)

    async with _db() as db:
        for server in servers:
            await db.execute(
                "UPDATE plans SET is_active = 0 WHERE is_free = 0 AND server_id = ?",
                (server.id,),
            )
            for plan in server.plans:
                async with db.execute(
                    """SELECT id FROM plans
                       WHERE is_free = 0 AND server_id = ? AND sort_order = ?
                       ORDER BY id ASC LIMIT 1""",
                    (server.id, plan.sort_order),
                ) as cur:
                    row = await cur.fetchone()
                if row:
                    await db.execute(
                        """UPDATE plans SET title = ?, data_gb = ?, price_ks = ?,
                           duration_days = ?, is_active = 1 WHERE id = ?""",
                        (
                            plan.title,
                            plan.data_gb,
                            plan.price_ks,
                            plan.duration_days,
                            row[0],
                        ),
                    )
                else:
                    await db.execute(
                        """INSERT INTO plans
                           (title, data_gb, price_ks, duration_days, is_free,
                            sort_order, is_active, server_id)
                           VALUES (?, ?, ?, ?, 0, ?, 1, ?)""",
                        (
                            plan.title,
                            plan.data_gb,
                            plan.price_ks,
                            plan.duration_days,
                            plan.sort_order,
                            server.id,
                        ),
                    )
        await db.commit()


async def get_plan(plan_id: int) -> dict[str, Any] | None:
    async with _db() as db:
        async with db.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


# ─── Payment accounts ────────────────────────────────────────────────────────

async def get_payment_accounts(method: str) -> list[dict[str, Any]]:
    async with _db() as db:
        async with db.execute(
            """SELECT * FROM payment_accounts
               WHERE method = ? AND is_active = 1""",
            (method,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def get_payment_account(account_id: int) -> dict[str, Any] | None:
    async with _db() as db:
        async with db.execute(
            "SELECT * FROM payment_accounts WHERE id = ?", (account_id,)
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


# ─── Payments ────────────────────────────────────────────────────────────────

async def create_payment(
    user_id: int,
    plan_id: int,
    method: str,
    amount_ks: int,
    server_id: str,
) -> int:
    async with _db() as db:
        await db.execute(
            """UPDATE payments SET status = 'cancelled', reject_reason = 'superseded'
               WHERE user_id = ? AND status = 'pending'""",
            (user_id,),
        )
        cur = await db.execute(
            """INSERT INTO payments (user_id, plan_id, method, amount_ks, server_id)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, plan_id, method, amount_ks, server_id),
        )
        await db.commit()
        return cur.lastrowid


async def save_proof_message(
    payment_id: int, chat_id: int, message_id: int
) -> None:
    async with _db() as db:
        await db.execute(
            """UPDATE payments SET proof_chat_id = ?, proof_message_id = ?
               WHERE id = ?""",
            (chat_id, message_id, payment_id),
        )
        await db.commit()


async def attach_receipt(payment_id: int, file_id: str, note: str = "") -> bool:
    async with _db() as db:
        cur = await db.execute(
            """UPDATE payments SET receipt_file_id = ?, receipt_note = ?
               WHERE id = ? AND status = 'pending'""",
            (file_id, note, payment_id),
        )
        await db.commit()
        return cur.rowcount > 0


async def set_payment_verification(
    payment_id: int,
    *,
    verify_status: str | None = None,
    verify_message: str | None = None,
) -> None:
    async with _db() as db:
        await db.execute(
            """UPDATE payments SET verify_status = COALESCE(?, verify_status),
               verify_message = COALESCE(?, verify_message)
               WHERE id = ? AND status = 'pending'""",
            (verify_status, verify_message, payment_id),
        )
        await db.commit()


async def try_claim_tx_id(payment_id: int, tx_id: str) -> bool:
    """Atomically reserve a transaction ID locally and in the shared ledger."""
    import asyncio

    from payments.kbz.tx_claims import release_tx, try_claim_tx

    tx_id = (tx_id or "").strip()
    if not tx_id:
        return False

    bot = config.KBZ_BOT_CLAIM_NAME
    ref = str(payment_id)
    path = config.KBZ_CLAIMED_TX_PATH

    global_ok = await asyncio.to_thread(
        try_claim_tx, path, tx_id, bot=bot, ref_id=ref
    )
    if not global_ok:
        return False

    async with _db() as db:
        try:
            await db.execute("BEGIN IMMEDIATE")
            async with db.execute(
                "SELECT id FROM payments WHERE receipt_tx_id = ?",
                (tx_id,),
            ) as cur:
                row = await cur.fetchone()
                if row and row["id"] != payment_id:
                    await db.rollback()
                    await asyncio.to_thread(
                        release_tx, path, tx_id, bot=bot, ref_id=ref
                    )
                    return False
            cur = await db.execute(
                """UPDATE payments SET receipt_tx_id = ?
                   WHERE id = ? AND status = 'pending'
                   AND (receipt_tx_id IS NULL OR receipt_tx_id = ?)""",
                (tx_id, payment_id, tx_id),
            )
            if cur.rowcount == 0:
                await db.rollback()
                await asyncio.to_thread(
                    release_tx, path, tx_id, bot=bot, ref_id=ref
                )
                return False
            await db.commit()
            return True
        except aiosqlite.IntegrityError:
            await db.rollback()
            await asyncio.to_thread(release_tx, path, tx_id, bot=bot, ref_id=ref)
            return False


async def is_tx_id_used(tx_id: str) -> bool:
    async with _db() as db:
        async with db.execute(
            "SELECT id FROM payments WHERE receipt_tx_id = ? LIMIT 1",
            (tx_id,),
        ) as cur:
            return await cur.fetchone() is not None


async def mark_auto_verified(payment_id: int) -> None:
    async with _db() as db:
        await db.execute(
            "UPDATE payments SET auto_verified = 1 WHERE id = ?",
            (payment_id,),
        )
        await db.commit()


async def get_payment(payment_id: int) -> dict[str, Any] | None:
    async with _db() as db:
        async with db.execute(
            """
            SELECT p.*, u.telegram_id, u.first_name, u.username,
                   pl.title AS plan_title, pl.data_gb, pl.duration_days,
                   s.id AS subscription_id,
                   s.data_limit_gb AS sub_data_limit_gb,
                   s.data_used_gb AS sub_data_used_gb,
                   s.bonus_data_mb AS sub_bonus_data_mb,
                   s.expires_at AS sub_expires_at,
                   s.is_active AS sub_is_active,
                   s.server_id AS sub_server_id
            FROM payments p
            JOIN users u ON u.id = p.user_id
            JOIN plans pl ON pl.id = p.plan_id
            LEFT JOIN subscriptions s ON s.id = (
                SELECT id FROM subscriptions
                WHERE payment_id = p.id
                ORDER BY id DESC LIMIT 1
            )
            WHERE p.id = ?
            """,
            (payment_id,),
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def get_latest_pending_payment(user_id: int) -> dict[str, Any] | None:
    """Most recent pending payment for a user (internal user id)."""
    async with _db() as db:
        async with db.execute(
            """
            SELECT p.*, u.telegram_id, u.first_name, u.username,
                   pl.title AS plan_title, pl.data_gb, pl.duration_days
            FROM payments p
            JOIN users u ON u.id = p.user_id
            JOIN plans pl ON pl.id = p.plan_id
            WHERE p.user_id = ? AND p.status = 'pending'
            ORDER BY p.created_at DESC
            LIMIT 1
            """,
            (user_id,),
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def get_pending_payments() -> list[dict[str, Any]]:
    async with _db() as db:
        async with db.execute(
            """
            SELECT p.*, u.telegram_id, u.first_name, u.username,
                   pl.title AS plan_title
            FROM payments p
            JOIN users u ON u.id = p.user_id
            JOIN plans pl ON pl.id = p.plan_id
            WHERE p.status = 'pending' AND p.receipt_file_id IS NOT NULL
            ORDER BY p.created_at
            """
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def count_payments(status: str | None = None) -> int:
    async with _db() as db:
        if status:
            async with db.execute(
                "SELECT COUNT(*) AS c FROM payments WHERE status = ?", (status,)
            ) as cur:
                return (await cur.fetchone())["c"]
        async with db.execute("SELECT COUNT(*) AS c FROM payments") as cur:
            return (await cur.fetchone())["c"]


async def approve_payment(
    payment_id: int,
    admin_telegram_id: int,
    vless_uuid: str,
    vless_key: str,
    panel_email: str,
    *,
    auto_verified: bool = False,
) -> dict[str, Any] | None:
    now = mmt_now().isoformat()

    async with _db() as db:
        async with db.execute(
            """
            SELECT p.*, pl.data_gb, pl.duration_days
            FROM payments p
            JOIN plans pl ON pl.id = p.plan_id
            WHERE p.id = ? AND p.status = 'pending'
            """,
            (payment_id,),
        ) as cur:
            payment = await cur.fetchone()
        if not payment:
            return None

        expires = (
            mmt_now() + timedelta(days=payment["duration_days"])
        ).isoformat()

        server_id = payment["server_id"] or "sg"
        await db.execute(
            """INSERT INTO subscriptions
               (user_id, plan_id, payment_id, vless_uuid, vless_key, panel_email,
                data_limit_gb, expires_at, is_free, server_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            (
                payment["user_id"],
                payment["plan_id"],
                payment_id,
                vless_uuid,
                vless_key,
                panel_email,
                payment["data_gb"],
                expires,
                server_id,
            ),
        )
        cur = await db.execute(
            """UPDATE payments SET status = 'approved', processed_by = ?,
               processed_at = ?, auto_verified = ?
               WHERE id = ? AND status = 'pending'""",
            (admin_telegram_id, now, 1 if auto_verified else 0, payment_id),
        )
        if cur.rowcount == 0:
            await db.rollback()
            return None
        await db.commit()

    return await get_payment(payment_id)


async def reject_payment(
    payment_id: int, admin_telegram_id: int, reason: str
) -> dict[str, Any] | None:
    now = mmt_now().isoformat()
    async with _db() as db:
        cur = await db.execute(
            """UPDATE payments SET status = 'rejected', processed_by = ?,
               reject_reason = ?, processed_at = ?
               WHERE id = ? AND status = 'pending'""",
            (admin_telegram_id, reason, now, payment_id),
        )
        if cur.rowcount == 0:
            return None
        await db.commit()
    return await get_payment(payment_id)


# ─── Subscriptions ───────────────────────────────────────────────────────────

async def get_active_paid_subscriptions(user_id: int) -> list[dict[str, Any]]:
    now = mmt_now().isoformat()
    async with _db() as db:
        async with db.execute(
            """SELECT s.*, p.title AS plan_title
               FROM subscriptions s
               JOIN plans p ON p.id = s.plan_id
               WHERE s.user_id = ? AND s.is_active = 1 AND s.is_free = 0
                 AND s.expires_at > ?
               ORDER BY s.created_at DESC""",
            (user_id, now),
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def get_active_paid_subscription(user_id: int) -> dict[str, Any] | None:
    subs = await get_active_paid_subscriptions(user_id)
    return subs[0] if subs else None


async def get_active_free_subscription(user_id: int) -> dict[str, Any] | None:
    now = mmt_now().isoformat()
    async with _db() as db:
        async with db.execute(
            """SELECT s.*, p.title AS plan_title
               FROM subscriptions s
               JOIN plans p ON p.id = s.plan_id
               WHERE s.user_id = ? AND s.is_active = 1 AND s.is_free = 1
                 AND s.expires_at > ?
               ORDER BY s.created_at DESC LIMIT 1""",
            (user_id, now),
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def get_all_active_subscriptions(user_id: int) -> list[dict[str, Any]]:
    """All active paid keys, then the daily free key if any."""
    subs = await get_active_paid_subscriptions(user_id)
    free = await get_active_free_subscription(user_id)
    if free:
        subs.append(free)
    return subs


async def get_active_subscription(user_id: int) -> dict[str, Any] | None:
    """Newest paid subscription, else free."""
    subs = await get_all_active_subscriptions(user_id)
    return subs[0] if subs else None


async def create_free_subscription(
    user_id: int,
    plan_id: int,
    vless_uuid: str,
    vless_key: str,
    panel_email: str,
    data_limit_gb: float,
) -> None:
    expires = (
        mmt_now() + timedelta(days=config.FREE_SUB_EXPIRY_DAYS)
    ).isoformat()
    async with _db() as db:
        await db.execute(
            "UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_free = 1",
            (user_id,),
        )
        await db.execute(
            """INSERT INTO subscriptions
               (user_id, plan_id, vless_uuid, vless_key, panel_email,
                data_limit_gb, expires_at, is_free)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
            (user_id, plan_id, vless_uuid, vless_key, panel_email, data_limit_gb, expires),
        )
        await db.commit()


async def update_free_subscription(
    sub_id: int,
    vless_uuid: str,
    vless_key: str,
    panel_email: str,
    data_limit_gb: float,
) -> None:
    expires = (
        mmt_now() + timedelta(days=config.FREE_SUB_EXPIRY_DAYS)
    ).isoformat()
    async with _db() as db:
        await db.execute(
            """UPDATE subscriptions SET vless_uuid = ?, vless_key = ?, panel_email = ?,
               data_limit_gb = ?, expires_at = ?, is_active = 1
               WHERE id = ?""",
            (vless_uuid, vless_key, panel_email, data_limit_gb, expires, sub_id),
        )
        await db.commit()


async def get_subscription_by_id(sub_id: int) -> dict[str, Any] | None:
    async with _db() as db:
        async with db.execute(
            """SELECT s.*, p.title AS plan_title, u.telegram_id, u.username, u.first_name,
                      u.sub_token
               FROM subscriptions s
               JOIN plans p ON p.id = s.plan_id
               JOIN users u ON u.id = s.user_id
               WHERE s.id = ?""",
            (sub_id,),
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def list_subscriptions_for_telegram(telegram_id: int) -> list[dict[str, Any]]:
    async with _db() as db:
        async with db.execute(
            """SELECT s.*, p.title AS plan_title, u.telegram_id, u.username, u.first_name,
                      u.sub_token
               FROM subscriptions s
               JOIN plans p ON p.id = s.plan_id
               JOIN users u ON u.id = s.user_id
               WHERE u.telegram_id = ?
               ORDER BY s.is_active DESC, s.id DESC""",
            (telegram_id,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def update_subscription_quota(
    sub_id: int,
    *,
    data_limit_gb: float | None = None,
    bonus_data_mb: int | None = None,
    expires_at: str | None = None,
    vless_uuid: str | None = None,
    vless_key: str | None = None,
    panel_email: str | None = None,
    is_active: bool | None = None,
) -> dict[str, Any] | None:
    """Patch quota / key fields on a subscription."""
    fields: list[str] = []
    args: list[Any] = []
    if data_limit_gb is not None:
        fields.append("data_limit_gb = ?")
        args.append(float(data_limit_gb))
    if bonus_data_mb is not None:
        fields.append("bonus_data_mb = ?")
        args.append(int(bonus_data_mb))
    if expires_at is not None:
        fields.append("expires_at = ?")
        args.append(expires_at)
    if vless_uuid is not None:
        fields.append("vless_uuid = ?")
        args.append(vless_uuid)
    if vless_key is not None:
        fields.append("vless_key = ?")
        args.append(vless_key)
    if panel_email is not None:
        fields.append("panel_email = ?")
        args.append(panel_email)
    if is_active is not None:
        fields.append("is_active = ?")
        args.append(1 if is_active else 0)
    if not fields:
        return await get_subscription_by_id(sub_id)
    args.append(sub_id)
    async with _db() as db:
        await db.execute(
            f"UPDATE subscriptions SET {', '.join(fields)} WHERE id = ?",
            tuple(args),
        )
        await db.commit()
    return await get_subscription_by_id(sub_id)


async def create_manual_subscription(
    *,
    user_id: int,
    plan_id: int,
    server_id: str,
    vless_uuid: str,
    vless_key: str,
    panel_email: str,
    data_limit_gb: float,
    expires_at: str,
) -> dict[str, Any]:
    async with _db() as db:
        cur = await db.execute(
            """INSERT INTO subscriptions
               (user_id, plan_id, payment_id, vless_uuid, vless_key, panel_email,
                data_limit_gb, expires_at, is_free, server_id, is_active)
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0, ?, 1)""",
            (
                user_id,
                plan_id,
                vless_uuid,
                vless_key,
                panel_email,
                data_limit_gb,
                expires_at,
                server_id,
            ),
        )
        await db.commit()
        sub_id = cur.lastrowid
    row = await get_subscription_by_id(int(sub_id))
    if not row:
        raise RuntimeError("Failed to load created subscription")
    return row


async def get_subscription_by_payment_id(payment_id: int) -> dict[str, Any] | None:
    async with _db() as db:
        async with db.execute(
            """SELECT s.*, p.title AS plan_title
               FROM subscriptions s
               JOIN plans p ON p.id = s.plan_id
               WHERE s.payment_id = ?
               ORDER BY s.id DESC LIMIT 1""",
            (payment_id,),
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def update_subscription_usage(sub_id: int, used_gb: float) -> None:
    async with _db() as db:
        await db.execute(
            "UPDATE subscriptions SET data_used_gb = ? WHERE id = ?",
            (used_gb, sub_id),
        )
        await db.commit()


async def update_subscription_after_server_change(
    sub_id: int,
    *,
    server_id: str,
    vless_uuid: str,
    vless_key: str,
    panel_email: str,
    data_limit_gb: float,
    expires_at: str,
) -> None:
    """Point subscription at a new panel client after server migration."""
    async with _db() as db:
        await db.execute(
            """UPDATE subscriptions SET
               server_id = ?, vless_uuid = ?, vless_key = ?, panel_email = ?,
               data_limit_gb = ?, data_used_gb = 0, bonus_data_mb = 0,
               expires_at = ?
               WHERE id = ? AND is_active = 1""",
            (
                server_id,
                vless_uuid,
                vless_key,
                panel_email,
                data_limit_gb,
                expires_at,
                sub_id,
            ),
        )
        await db.commit()


async def log_key_replacement(
    user_id: int,
    subscription_id: int,
    *,
    from_server: str,
    to_server: str,
    feedback: str,
    remaining_gb: float,
    expires_at: str,
) -> None:
    async with _db() as db:
        await db.execute(
            """INSERT INTO key_replacements
               (user_id, subscription_id, from_server, to_server, feedback,
                remaining_gb, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                subscription_id,
                from_server,
                to_server,
                feedback,
                remaining_gb,
                expires_at,
            ),
        )
        await db.commit()


async def count_active_subscriptions() -> int:
    now = mmt_now().isoformat()
    async with _db() as db:
        async with db.execute(
            "SELECT COUNT(*) AS c FROM subscriptions WHERE is_active = 1 AND expires_at > ?",
            (now,),
        ) as cur:
            return (await cur.fetchone())["c"]


_ACTIVE_SUB_WHERE = """
    s.is_active = 1 AND s.expires_at > ? AND u.is_banned = 0
"""


async def get_subscriptions_with_panel(user_id: int) -> list[dict[str, Any]]:
    async with _db() as db:
        async with db.execute(
            """SELECT * FROM subscriptions
               WHERE user_id = ? AND panel_email IS NOT NULL AND panel_email != ''""",
            (user_id,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def deactivate_all_user_subscriptions(user_id: int) -> int:
    async with _db() as db:
        cur = await db.execute(
            "UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1",
            (user_id,),
        )
        await db.commit()
        return cur.rowcount


async def get_active_panel_subscriptions() -> list[dict[str, Any]]:
    """Active, non-banned subscriptions that have a panel client."""
    now = mmt_now().isoformat()
    async with _db() as db:
        async with db.execute(
            f"""SELECT s.* FROM subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE {_ACTIVE_SUB_WHERE}
                  AND s.panel_email IS NOT NULL AND s.panel_email != ''""",
            (now,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def get_active_keys_by_server() -> dict[str, int]:
    """Active subscription counts grouped by server_id."""
    now = mmt_now().isoformat()
    async with _db() as db:
        async with db.execute(
            f"""SELECT COALESCE(s.server_id, 'sg') AS server_id, COUNT(*) AS c
                FROM subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE {_ACTIVE_SUB_WHERE}
                GROUP BY server_id""",
            (now,),
        ) as cur:
            return {row["server_id"]: int(row["c"]) for row in await cur.fetchall()}


async def get_admin_dashboard_stats() -> dict[str, Any]:
    now = mmt_now().isoformat()
    async with _db() as db:
        async with db.execute("SELECT COUNT(*) AS c FROM users") as cur:
            users = int((await cur.fetchone())["c"])
        async with db.execute(
            "SELECT COUNT(*) AS c FROM users WHERE is_banned = 1"
        ) as cur:
            banned = int((await cur.fetchone())["c"])
        async with db.execute(
            f"""SELECT COUNT(*) AS c FROM subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE {_ACTIVE_SUB_WHERE}""",
            (now,),
        ) as cur:
            active_keys = int((await cur.fetchone())["c"])
        async with db.execute(
            f"""SELECT COUNT(*) AS c FROM subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE {_ACTIVE_SUB_WHERE} AND s.is_free = 0""",
            (now,),
        ) as cur:
            paid_keys = int((await cur.fetchone())["c"])
        async with db.execute(
            f"""SELECT COUNT(*) AS c FROM subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE {_ACTIVE_SUB_WHERE} AND s.is_free = 1""",
            (now,),
        ) as cur:
            free_keys = int((await cur.fetchone())["c"])
        async with db.execute(
            f"""SELECT COUNT(DISTINCT s.user_id) AS c FROM subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE {_ACTIVE_SUB_WHERE}""",
            (now,),
        ) as cur:
            active_users = int((await cur.fetchone())["c"])
        async with db.execute(
            "SELECT COUNT(*) AS c FROM payments WHERE status = 'pending'"
        ) as cur:
            pending = int((await cur.fetchone())["c"])
        async with db.execute(
            "SELECT COUNT(*) AS c FROM payments WHERE status = 'approved'"
        ) as cur:
            approved = int((await cur.fetchone())["c"])
        async with db.execute(
            "SELECT COUNT(*) AS c FROM payments WHERE status = 'rejected'"
        ) as cur:
            rejected = int((await cur.fetchone())["c"])
        async with db.execute(
            "SELECT COALESCE(SUM(amount_ks), 0) AS total FROM payments WHERE status = 'approved'"
        ) as cur:
            revenue_ks = int((await cur.fetchone())["total"])
        async with db.execute(
            f"""SELECT COALESCE(SUM(s.data_used_gb), 0) AS used,
                       COALESCE(SUM(s.data_limit_gb + (s.bonus_data_mb / 1024.0)), 0) AS limit_gb
                FROM subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE {_ACTIVE_SUB_WHERE}""",
            (now,),
        ) as cur:
            usage_row = await cur.fetchone()

    return {
        "users": users,
        "banned": banned,
        "active_users": active_users,
        "active_keys": active_keys,
        "paid_keys": paid_keys,
        "free_keys": free_keys,
        "pending": pending,
        "approved": approved,
        "rejected": rejected,
        "revenue_ks": revenue_ks,
        "used_gb": float(usage_row["used"]),
        "limit_gb": float(usage_row["limit_gb"]),
    }


async def record_mobile_dau(device_id: str, *, day: str | None = None) -> bool:
    """Record one DAU hit. Returns True if this is a new device for the day."""
    did = (device_id or "").strip()[:128]
    if not did:
        return False
    d = day or mmt_now().date().isoformat()
    async with _db() as db:
        cur = await db.execute(
            """INSERT OR IGNORE INTO mobile_dau (day, device_id)
               VALUES (?, ?)""",
            (d, did),
        )
        await db.commit()
        return cur.rowcount > 0


async def record_mobile_ad_click(
    *,
    ad_id: str,
    device_id: str = "",
    placement: str = "",
    day: str | None = None,
) -> None:
    aid = (ad_id or "").strip()[:64]
    if not aid:
        return
    d = day or mmt_now().date().isoformat()
    async with _db() as db:
        await db.execute(
            """INSERT INTO mobile_ad_clicks (day, ad_id, placement, device_id)
               VALUES (?, ?, ?, ?)""",
            (
                d,
                aid,
                (placement or "").strip()[:32],
                (device_id or "").strip()[:128],
            ),
        )
        await db.commit()


async def get_mobile_analytics_stats() -> dict[str, Any]:
    """DAU + ad click counters for admin dashboard."""
    today = mmt_now().date().isoformat()
    # Last 7 calendar days including today
    from datetime import timedelta

    days_7 = [(mmt_now().date() - timedelta(days=i)).isoformat() for i in range(7)]
    placeholders = ",".join("?" * len(days_7))
    async with _db() as db:
        async with db.execute(
            "SELECT COUNT(*) AS c FROM mobile_dau WHERE day = ?", (today,)
        ) as cur:
            dau_today = int((await cur.fetchone())["c"])
        async with db.execute(
            f"SELECT COUNT(DISTINCT device_id) AS c FROM mobile_dau WHERE day IN ({placeholders})",
            days_7,
        ) as cur:
            dau_7d = int((await cur.fetchone())["c"])
        async with db.execute(
            "SELECT COUNT(*) AS c FROM mobile_ad_clicks WHERE day = ?", (today,)
        ) as cur:
            ad_clicks_today = int((await cur.fetchone())["c"])
        async with db.execute(
            "SELECT COUNT(*) AS c FROM mobile_ad_clicks"
        ) as cur:
            ad_clicks_total = int((await cur.fetchone())["c"])
        async with db.execute(
            """SELECT ad_id, COUNT(*) AS c FROM mobile_ad_clicks
               WHERE day = ?
               GROUP BY ad_id
               ORDER BY c DESC
               LIMIT 5""",
            (today,),
        ) as cur:
            top_rows = await cur.fetchall()
    top_ads = " · ".join(f"{r['ad_id']} ({r['c']})" for r in top_rows) or "—"
    return {
        "dau_today": dau_today,
        "dau_7d": dau_7d,
        "ad_clicks_today": ad_clicks_today,
        "ad_clicks_total": ad_clicks_total,
        "ad_clicks_top": top_ads,
    }


# ─── Notifications (admin broadcast) ─────────────────────────────────────────

async def get_broadcast_telegram_ids(audience: str) -> list[int]:
    """audience: 'all' | 'paid' | 'active' (active kept as any live sub for history)."""
    now = mmt_now().isoformat()
    key = (audience or "all").strip().lower()
    async with _db() as db:
        if key in ("paid", "paying"):
            async with db.execute(
                """SELECT DISTINCT u.telegram_id
                   FROM users u
                   JOIN subscriptions s ON s.user_id = u.id
                   WHERE u.is_banned = 0
                     AND s.is_active = 1
                     AND s.is_free = 0
                     AND s.expires_at > ?""",
                (now,),
            ) as cur:
                return [r["telegram_id"] for r in await cur.fetchall()]
        if key == "active":
            async with db.execute(
                """SELECT DISTINCT u.telegram_id
                   FROM users u
                   JOIN subscriptions s ON s.user_id = u.id
                   WHERE u.is_banned = 0 AND s.is_active = 1 AND s.expires_at > ?""",
                (now,),
            ) as cur:
                return [r["telegram_id"] for r in await cur.fetchall()]
        async with db.execute(
            "SELECT telegram_id FROM users WHERE is_banned = 0"
        ) as cur:
            return [r["telegram_id"] for r in await cur.fetchall()]


async def count_broadcast_audiences() -> dict[str, int]:
    return {
        "all": len(await get_broadcast_telegram_ids("all")),
        "paid": len(await get_broadcast_telegram_ids("paid")),
        "active": len(await get_broadcast_telegram_ids("active")),
    }

async def save_notification(
    audience: str,
    message: str,
    sent_by: int,
    sent_count: int,
    failed_count: int,
) -> int:
    async with _db() as db:
        cur = await db.execute(
            """INSERT INTO notifications (audience, message, sent_by, sent_count, failed_count)
               VALUES (?, ?, ?, ?, ?)""",
            (audience, message, sent_by, sent_count, failed_count),
        )
        await db.commit()
        return cur.lastrowid


async def get_recent_notifications(limit: int = 10) -> list[dict[str, Any]]:
    async with _db() as db:
        async with db.execute(
            """SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


# ─── Restore codes (AirVPN app import) ───────────────────────────────────────

def new_restore_code() -> str:
    """6 digits + 4 alphanumeric chars, e.g. 847291Kq3m."""
    digits = f"{secrets.randbelow(1_000_000):06d}"
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    suffix = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"{digits}{suffix}"


def hash_restore_code(code: str) -> str:
    import hashlib

    normalized = (code or "").strip().replace("-", "").replace(" ", "")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


async def issue_restore_code(user_id: int) -> str:
    """Create a new restore code for the user; returns plaintext once."""
    code = new_restore_code()
    code_hash = hash_restore_code(code)
    hint = f"{code[:2]}••••{code[-2:]}"
    async with _db() as db:
        await db.execute(
            """INSERT INTO restore_codes (user_id, code_hash, code_hint)
               VALUES (?, ?, ?)""",
            (user_id, code_hash, hint),
        )
        await db.commit()
    return code


async def get_user_by_restore_code(code: str) -> dict[str, Any] | None:
    code_hash = hash_restore_code(code)
    async with _db() as db:
        async with db.execute(
            """SELECT u.* FROM restore_codes r
               JOIN users u ON u.id = r.user_id
               WHERE r.code_hash = ? AND r.revoked_at IS NULL
                 AND u.is_banned = 0""",
            (code_hash,),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def list_restore_hints(user_id: int) -> list[dict[str, Any]]:
    async with _db() as db:
        async with db.execute(
            """SELECT id, code_hint, created_at, revoked_at FROM restore_codes
               WHERE user_id = ? ORDER BY id DESC LIMIT 5""",
            (user_id,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


# ─── Mobile server catalog ───────────────────────────────────────────────────

async def list_mobile_servers(
    *,
    enabled_only: bool = True,
    include_list_when_disabled: bool = False,
    page: int | None = None,
    per_page: int = 20,
) -> list[dict[str, Any]] | dict[str, Any]:
    async with _db() as db:
        sql = """
            SELECT m.*, p.title AS plan_title, p.price_ks AS plan_price_ks,
                   p.data_gb AS plan_data_gb, p.duration_days AS plan_duration_days
            FROM mobile_servers m
            LEFT JOIN plans p ON p.id = m.plan_id
        """
        args: list[Any] = []
        if enabled_only and include_list_when_disabled:
            sql += (
                " WHERE m.enabled = 1 OR "
                "(COALESCE(m.list_when_disabled, 0) = 1 AND LOWER(m.tier) = 'free')"
            )
        elif enabled_only:
            sql += " WHERE m.enabled = 1"
        sql += " ORDER BY m.sort_order ASC, m.id ASC"
        if page is None:
            async with db.execute(sql, tuple(args)) as cur:
                return [dict(r) for r in await cur.fetchall()]
        page = max(1, page)
        per_page = min(100, max(1, per_page))
        count_sql = "SELECT COUNT(*) AS c FROM mobile_servers m"
        if enabled_only and include_list_when_disabled:
            count_sql += (
                " WHERE m.enabled = 1 OR "
                "(COALESCE(m.list_when_disabled, 0) = 1 AND LOWER(m.tier) = 'free')"
            )
        elif enabled_only:
            count_sql += " WHERE m.enabled = 1"
        async with db.execute(count_sql) as cur:
            total = int((await cur.fetchone())["c"])
        total_pages = max(1, (total + per_page - 1) // per_page)
        page = min(page, total_pages)
        offset = (page - 1) * per_page
        async with db.execute(sql + " LIMIT ? OFFSET ?", (*args, per_page, offset)) as cur:
            items = [dict(r) for r in await cur.fetchall()]
        return {
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages,
        }


async def get_mobile_server(public_id: str) -> dict[str, Any] | None:
    async with _db() as db:
        async with db.execute(
            """SELECT m.*, p.title AS plan_title, p.price_ks AS plan_price_ks,
                      p.data_gb AS plan_data_gb, p.duration_days AS plan_duration_days
               FROM mobile_servers m
               LEFT JOIN plans p ON p.id = m.plan_id
               WHERE m.public_id = ?""",
            (public_id,),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def upsert_mobile_server(
    *,
    public_id: str,
    name: str,
    region: str = "",
    protocol: str = "vless",
    tier: str = "free",
    vpn_server_id: str | None = None,
    plan_id: int | None = None,
    config_uri: str | None = None,
    nodes_text: str | None = None,
    manual_total_bytes: int | None = None,
    manual_upload_bytes: int | None = None,
    manual_download_bytes: int | None = None,
    manual_expire_at: int | None = None,
    list_when_disabled: bool = False,
    enabled: bool = True,
    sort_order: int = 0,
) -> dict[str, Any]:
    async with _db() as db:
        await db.execute(
            """INSERT INTO mobile_servers
               (public_id, name, region, protocol, tier, vpn_server_id, plan_id,
                config_uri, nodes_text, manual_total_bytes, manual_upload_bytes,
                manual_download_bytes, manual_expire_at, list_when_disabled,
                enabled, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(public_id) DO UPDATE SET
                 name = excluded.name,
                 region = excluded.region,
                 protocol = excluded.protocol,
                 tier = excluded.tier,
                 vpn_server_id = excluded.vpn_server_id,
                 plan_id = excluded.plan_id,
                 config_uri = excluded.config_uri,
                 nodes_text = excluded.nodes_text,
                 manual_total_bytes = excluded.manual_total_bytes,
                 manual_upload_bytes = excluded.manual_upload_bytes,
                 manual_download_bytes = excluded.manual_download_bytes,
                 manual_expire_at = excluded.manual_expire_at,
                 list_when_disabled = excluded.list_when_disabled,
                 enabled = excluded.enabled,
                 sort_order = excluded.sort_order
            """,
            (
                public_id,
                name,
                region,
                protocol.lower(),
                tier.lower(),
                vpn_server_id,
                plan_id,
                config_uri,
                (nodes_text or "").strip() or None,
                manual_total_bytes,
                manual_upload_bytes,
                manual_download_bytes,
                manual_expire_at,
                1 if list_when_disabled else 0,
                1 if enabled else 0,
                sort_order,
            ),
        )
        await db.commit()
    row = await get_mobile_server(public_id)
    assert row is not None
    return row


async def get_free_device_key(
    device_id: str,
    parent_id: str,
    vpn_server_id: str,
) -> dict[str, Any] | None:
    did = (device_id or "").strip()[:128]
    pid = (parent_id or "").strip()
    sid = (vpn_server_id or "").strip().lower()
    if not did or not pid or not sid:
        return None
    async with _db() as db:
        async with db.execute(
            """SELECT * FROM free_device_keys
               WHERE device_id = ? AND parent_id = ? AND vpn_server_id = ?""",
            (did, pid, sid),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def list_free_device_keys_for_parent(parent_id: str) -> list[dict[str, Any]]:
    pid = (parent_id or "").strip()
    if not pid:
        return []
    async with _db() as db:
        async with db.execute(
            """SELECT * FROM free_device_keys WHERE parent_id = ?
               ORDER BY id ASC""",
            (pid,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def upsert_free_device_key(
    *,
    device_id: str,
    parent_id: str,
    vpn_server_id: str,
    client_uuid: str,
    panel_email: str,
    vless_key: str,
) -> dict[str, Any]:
    did = (device_id or "").strip()[:128]
    pid = (parent_id or "").strip()
    sid = (vpn_server_id or "").strip().lower()
    uid = (client_uuid or "").strip()
    email = (panel_email or "").strip()
    key = (vless_key or "").strip()
    if not did or not pid or not sid or not uid or not email or not key:
        raise ValueError("free_device_key fields required")
    now = mmt_now().isoformat()
    async with _db() as db:
        await db.execute(
            """INSERT INTO free_device_keys
               (device_id, parent_id, vpn_server_id, client_uuid, panel_email,
                vless_key, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(device_id, parent_id, vpn_server_id) DO UPDATE SET
                 client_uuid = excluded.client_uuid,
                 panel_email = excluded.panel_email,
                 vless_key = excluded.vless_key,
                 updated_at = excluded.updated_at
            """,
            (did, pid, sid, uid, email, key, now, now),
        )
        await db.commit()
    row = await get_free_device_key(did, pid, sid)
    assert row is not None
    return row


async def set_mobile_server_enabled(public_id: str, enabled: bool) -> bool:
    async with _db() as db:
        cur = await db.execute(
            "UPDATE mobile_servers SET enabled = ? WHERE public_id = ?",
            (1 if enabled else 0, public_id),
        )
        await db.commit()
        return cur.rowcount > 0


async def delete_mobile_server(public_id: str) -> bool:
    async with _db() as db:
        cur = await db.execute(
            "DELETE FROM mobile_servers WHERE public_id = ?", (public_id,)
        )
        await db.commit()
        return cur.rowcount > 0


# ─── Mobile ads (first-party banner / dialog) ─────────────────────────────────

async def list_mobile_ads(
    *,
    enabled_only: bool = True,
    page: int | None = None,
    per_page: int = 20,
) -> list[dict[str, Any]] | dict[str, Any]:
    async with _db() as db:
        where = " WHERE enabled = 1" if enabled_only else ""
        order = " ORDER BY sort_order ASC, id ASC"
        if page is None:
            async with db.execute(
                f"SELECT * FROM mobile_ads{where}{order}"
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]
        page = max(1, page)
        per_page = min(100, max(1, per_page))
        async with db.execute(f"SELECT COUNT(*) AS c FROM mobile_ads{where}") as cur:
            total = int((await cur.fetchone())["c"])
        total_pages = max(1, (total + per_page - 1) // per_page)
        page = min(page, total_pages)
        offset = (page - 1) * per_page
        async with db.execute(
            f"SELECT * FROM mobile_ads{where}{order} LIMIT ? OFFSET ?",
            (per_page, offset),
        ) as cur:
            items = [dict(r) for r in await cur.fetchall()]
        return {
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages,
        }


async def get_mobile_ad(public_id: str) -> dict[str, Any] | None:
    async with _db() as db:
        async with db.execute(
            "SELECT * FROM mobile_ads WHERE public_id = ?", (public_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def upsert_mobile_ad(
    *,
    public_id: str,
    placement: str,
    image_url: str,
    click_url: str = "",
    title: str = "",
    image_width: int = 0,
    image_height: int = 0,
    enabled: bool = True,
    sort_order: int = 0,
) -> dict[str, Any]:
    pid = public_id.strip()
    place = (placement or "banner").strip().lower()
    if place not in ("banner", "dialog"):
        place = "banner"
    async with _db() as db:
        await db.execute(
            """INSERT INTO mobile_ads
               (public_id, placement, title, image_url, click_url,
                image_width, image_height, enabled, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(public_id) DO UPDATE SET
                 placement = excluded.placement,
                 title = excluded.title,
                 image_url = excluded.image_url,
                 click_url = excluded.click_url,
                 image_width = excluded.image_width,
                 image_height = excluded.image_height,
                 enabled = excluded.enabled,
                 sort_order = excluded.sort_order
            """,
            (
                pid,
                place,
                title or "",
                image_url.strip(),
                (click_url or "").strip(),
                int(image_width or 0),
                int(image_height or 0),
                1 if enabled else 0,
                int(sort_order or 0),
            ),
        )
        await db.commit()
    row = await get_mobile_ad(pid)
    assert row is not None
    return row


async def set_mobile_ad_enabled(public_id: str, enabled: bool) -> bool:
    async with _db() as db:
        cur = await db.execute(
            "UPDATE mobile_ads SET enabled = ? WHERE public_id = ?",
            (1 if enabled else 0, public_id.strip()),
        )
        await db.commit()
        return cur.rowcount > 0


async def delete_mobile_ad(public_id: str) -> bool:
    async with _db() as db:
        cur = await db.execute(
            "DELETE FROM mobile_ads WHERE public_id = ?", (public_id.strip(),)
        )
        await db.commit()
        return cur.rowcount > 0


_DEFAULT_APP_SETTINGS: dict[str, Any] = {
    "min_version_code": 1,
    "latest_version_code": 1,
    "latest_version_name": "1.0.0",
    "force_update": 0,
    "changelog": "",
    "maintenance": 0,
    "maintenance_message": "",
    "telegram_url": "",
    "play_url": "",
    "update_url": "",
    "buy_url": "",
    "privacy_url": "",
}


def _normalize_app_settings_row(row: dict[str, Any] | None) -> dict[str, Any]:
    base = dict(_DEFAULT_APP_SETTINGS)
    if row:
        base.update(dict(row))
    return {
        "min_version_code": int(base.get("min_version_code") or 1),
        "latest_version_code": int(base.get("latest_version_code") or 1),
        "latest_version_name": str(base.get("latest_version_name") or "1.0.0").strip(),
        "force_update": bool(int(base.get("force_update") or 0)),
        "changelog": str(base.get("changelog") or ""),
        "maintenance": bool(int(base.get("maintenance") or 0)),
        "maintenance_message": str(base.get("maintenance_message") or ""),
        "telegram_url": str(base.get("telegram_url") or "").strip(),
        "play_url": str(base.get("play_url") or "").strip(),
        "update_url": str(base.get("update_url") or "").strip(),
        "buy_url": str(base.get("buy_url") or "").strip(),
        "privacy_url": str(base.get("privacy_url") or "").strip(),
        "updated_at": base.get("updated_at"),
    }


async def get_mobile_app_settings() -> dict[str, Any]:
    async with _db() as db:
        async with db.execute(
            "SELECT * FROM mobile_app_settings WHERE id = 1"
        ) as cur:
            row = await cur.fetchone()
            if row:
                return _normalize_app_settings_row(dict(row))
    return _normalize_app_settings_row(None)


async def upsert_mobile_app_settings(**fields: Any) -> dict[str, Any]:
    """Create or update the single mobile_app_settings row (id=1)."""
    current = await get_mobile_app_settings()
    merged = {
        "min_version_code": int(
            fields.get("min_version_code", current["min_version_code"]) or 1
        ),
        "latest_version_code": int(
            fields.get("latest_version_code", current["latest_version_code"]) or 1
        ),
        "latest_version_name": str(
            fields.get("latest_version_name", current["latest_version_name"]) or "1.0.0"
        ).strip()[:32],
        "force_update": 1 if fields.get(
            "force_update", current["force_update"]
        ) else 0,
        "changelog": str(fields.get("changelog", current["changelog"]) or "")[:4000],
        "maintenance": 1 if fields.get(
            "maintenance", current["maintenance"]
        ) else 0,
        "maintenance_message": str(
            fields.get("maintenance_message", current["maintenance_message"]) or ""
        )[:1000],
        "telegram_url": str(
            fields.get("telegram_url", current["telegram_url"]) or ""
        ).strip()[:512],
        "play_url": str(fields.get("play_url", current["play_url"]) or "").strip()[:512],
        "update_url": str(
            fields.get("update_url", current["update_url"]) or ""
        ).strip()[:512],
        "buy_url": str(fields.get("buy_url", current["buy_url"]) or "").strip()[:512],
        "privacy_url": str(
            fields.get("privacy_url", current["privacy_url"]) or ""
        ).strip()[:512],
    }
    if merged["latest_version_code"] < merged["min_version_code"]:
        merged["latest_version_code"] = merged["min_version_code"]
    now = mmt_now().isoformat()
    async with _db() as db:
        await db.execute(
            """INSERT INTO mobile_app_settings (
                 id, min_version_code, latest_version_code, latest_version_name,
                 force_update, changelog, maintenance, maintenance_message,
                 telegram_url, play_url, update_url, buy_url, privacy_url, updated_at
               ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 min_version_code = excluded.min_version_code,
                 latest_version_code = excluded.latest_version_code,
                 latest_version_name = excluded.latest_version_name,
                 force_update = excluded.force_update,
                 changelog = excluded.changelog,
                 maintenance = excluded.maintenance,
                 maintenance_message = excluded.maintenance_message,
                 telegram_url = excluded.telegram_url,
                 play_url = excluded.play_url,
                 update_url = excluded.update_url,
                 buy_url = excluded.buy_url,
                 privacy_url = excluded.privacy_url,
                 updated_at = excluded.updated_at
            """,
            (
                merged["min_version_code"],
                merged["latest_version_code"],
                merged["latest_version_name"],
                merged["force_update"],
                merged["changelog"],
                merged["maintenance"],
                merged["maintenance_message"],
                merged["telegram_url"],
                merged["play_url"],
                merged["update_url"],
                merged["buy_url"],
                merged["privacy_url"],
                now,
            ),
        )
        await db.commit()
    return await get_mobile_app_settings()


async def ensure_mobile_app_settings_seeded(
    *,
    defaults: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Insert defaults once if the settings row is missing."""
    async with _db() as db:
        async with db.execute(
            "SELECT id FROM mobile_app_settings WHERE id = 1"
        ) as cur:
            if await cur.fetchone():
                return await get_mobile_app_settings()
    seed = dict(_DEFAULT_APP_SETTINGS)
    if defaults:
        seed.update({k: v for k, v in defaults.items() if v is not None})
    return await upsert_mobile_app_settings(**seed)


async def get_active_sub_for_vpn_server(
    user_id: int, vpn_server_id: str
) -> dict[str, Any] | None:
    now = mmt_now().isoformat()
    async with _db() as db:
        async with db.execute(
            """SELECT s.*, p.title AS plan_title FROM subscriptions s
               JOIN plans p ON p.id = s.plan_id
               WHERE s.user_id = ? AND s.is_active = 1 AND s.expires_at > ?
                 AND s.server_id = ? AND s.is_free = 0
               ORDER BY s.expires_at DESC LIMIT 1""",
            (user_id, now, vpn_server_id),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


# ─── Admin app auth (OTP + sessions) ─────────────────────────────────────────

def hash_admin_secret(value: str) -> str:
    """Hash OTP / session token with a BOT_TOKEN pepper."""
    import hashlib

    import config

    pepper = (config.BOT_TOKEN or "airvpn")[:48]
    return hashlib.sha256(f"{pepper}:{value}".encode("utf-8")).hexdigest()


async def store_admin_login_otp(telegram_id: int, code: str, *, ttl_sec: int = 300) -> None:
    expires = (mmt_now() + timedelta(seconds=ttl_sec)).isoformat()
    code_hash = hash_admin_secret(code.strip())
    async with _db() as db:
        await db.execute(
            """INSERT INTO admin_login_otps (telegram_id, code_hash, expires_at)
               VALUES (?, ?, ?)
               ON CONFLICT(telegram_id) DO UPDATE SET
                 code_hash = excluded.code_hash,
                 expires_at = excluded.expires_at,
                 created_at = CURRENT_TIMESTAMP""",
            (int(telegram_id), code_hash, expires),
        )
        await db.commit()


async def consume_admin_login_otp(telegram_id: int, code: str) -> bool:
    """Validate and consume a one-time admin login code."""
    now = mmt_now().isoformat()
    code_hash = hash_admin_secret(code.strip())
    async with _db() as db:
        async with db.execute(
            """SELECT code_hash, expires_at FROM admin_login_otps
               WHERE telegram_id = ?""",
            (int(telegram_id),),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return False
        if str(row["expires_at"]) < now:
            await db.execute(
                "DELETE FROM admin_login_otps WHERE telegram_id = ?",
                (int(telegram_id),),
            )
            await db.commit()
            return False
        if row["code_hash"] != code_hash:
            return False
        await db.execute(
            "DELETE FROM admin_login_otps WHERE telegram_id = ?",
            (int(telegram_id),),
        )
        await db.commit()
        return True


async def create_admin_session(
    telegram_id: int, token: str, *, ttl_days: int = 30
) -> None:
    expires = (mmt_now() + timedelta(days=ttl_days)).isoformat()
    token_hash = hash_admin_secret(token)
    async with _db() as db:
        await db.execute(
            """INSERT INTO admin_sessions (telegram_id, token_hash, expires_at)
               VALUES (?, ?, ?)""",
            (int(telegram_id), token_hash, expires),
        )
        await db.commit()


async def resolve_admin_session(token: str) -> int | None:
    """Return telegram_id if token is a valid non-revoked session."""
    now = mmt_now().isoformat()
    token_hash = hash_admin_secret(token.strip())
    async with _db() as db:
        async with db.execute(
            """SELECT telegram_id, expires_at FROM admin_sessions
               WHERE token_hash = ? AND revoked_at IS NULL""",
            (token_hash,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return None
        if str(row["expires_at"]) < now:
            await db.execute(
                """UPDATE admin_sessions SET revoked_at = ?
                   WHERE token_hash = ?""",
                (now, token_hash),
            )
            await db.commit()
            return None
        return int(row["telegram_id"])


async def revoke_admin_session(token: str) -> bool:
    now = mmt_now().isoformat()
    token_hash = hash_admin_secret(token.strip())
    async with _db() as db:
        cur = await db.execute(
            """UPDATE admin_sessions SET revoked_at = ?
               WHERE token_hash = ? AND revoked_at IS NULL""",
            (now, token_hash),
        )
        await db.commit()
        return cur.rowcount > 0


# ─── Admin CRUD helpers ──────────────────────────────────────────────────────

async def list_payment_accounts_all(
    *, method: str | None = None, active_only: bool = False
) -> list[dict[str, Any]]:
    async with _db() as db:
        clauses: list[str] = []
        args: list[Any] = []
        if method:
            clauses.append("method = ?")
            args.append(method)
        if active_only:
            clauses.append("is_active = 1")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        async with db.execute(
            f"SELECT * FROM payment_accounts {where} ORDER BY method, id",
            tuple(args),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def upsert_payment_account(
    *,
    account_id: int | None = None,
    method: str,
    account_number: str,
    account_name: str,
    is_active: bool = True,
) -> dict[str, Any]:
    method_s = (method or "KBZPay").strip()
    number = account_number.strip()
    name = account_name.strip()
    active = 1 if is_active else 0
    async with _db() as db:
        if account_id:
            await db.execute(
                """UPDATE payment_accounts
                   SET method = ?, account_number = ?, account_name = ?, is_active = ?
                   WHERE id = ?""",
                (method_s, number, name, active, int(account_id)),
            )
            await db.commit()
            row = await get_payment_account(int(account_id))
            if not row:
                raise ValueError("account not found")
            return row
        cur = await db.execute(
            """INSERT INTO payment_accounts
               (method, account_number, account_name, is_active)
               VALUES (?, ?, ?, ?)""",
            (method_s, number, name, active),
        )
        await db.commit()
        new_id = int(cur.lastrowid)
    row = await get_payment_account(new_id)
    assert row is not None
    return row


async def set_payment_account_active(account_id: int, active: bool) -> bool:
    async with _db() as db:
        cur = await db.execute(
            "UPDATE payment_accounts SET is_active = ? WHERE id = ?",
            (1 if active else 0, int(account_id)),
        )
        await db.commit()
        return cur.rowcount > 0


async def list_payments(
    *,
    status: str | None = None,
    page: int = 1,
    per_page: int = 20,
) -> dict[str, Any]:
    page = max(1, page)
    per_page = min(100, max(1, per_page))
    offset = (page - 1) * per_page
    select_sql = """
        SELECT p.*, u.telegram_id, u.first_name, u.username,
               pl.title AS plan_title, pl.data_gb, pl.duration_days,
               s.id AS subscription_id,
               s.data_limit_gb AS sub_data_limit_gb,
               s.data_used_gb AS sub_data_used_gb,
               s.bonus_data_mb AS sub_bonus_data_mb,
               s.expires_at AS sub_expires_at,
               s.is_active AS sub_is_active,
               s.server_id AS sub_server_id
        FROM payments p
        JOIN users u ON u.id = p.user_id
        JOIN plans pl ON pl.id = p.plan_id
        LEFT JOIN subscriptions s ON s.id = (
            SELECT id FROM subscriptions
            WHERE payment_id = p.id
            ORDER BY id DESC LIMIT 1
        )
    """
    async with _db() as db:
        if status:
            async with db.execute(
                "SELECT COUNT(*) AS c FROM payments WHERE status = ?",
                (status,),
            ) as cur:
                total = int((await cur.fetchone())["c"])
            sql = select_sql + """
                WHERE p.status = ?
                ORDER BY p.created_at DESC
                LIMIT ? OFFSET ?
            """
            args: tuple[Any, ...] = (status, per_page, offset)
        else:
            async with db.execute("SELECT COUNT(*) AS c FROM payments") as cur:
                total = int((await cur.fetchone())["c"])
            sql = select_sql + """
                ORDER BY p.created_at DESC
                LIMIT ? OFFSET ?
            """
            args = (per_page, offset)
        async with db.execute(sql, args) as cur:
            items = [dict(r) for r in await cur.fetchall()]
    total_pages = max(1, (total + per_page - 1) // per_page)
    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


async def list_plans(
    *, server_id: str | None = None, include_inactive: bool = True
) -> list[dict[str, Any]]:
    async with _db() as db:
        clauses: list[str] = ["is_free = 0"]
        args: list[Any] = []
        if server_id:
            clauses.append("server_id = ?")
            args.append(server_id)
        if not include_inactive:
            clauses.append("is_active = 1")
        where = " AND ".join(clauses)
        async with db.execute(
            f"""SELECT * FROM plans WHERE {where}
                ORDER BY server_id, sort_order, price_ks""",
            tuple(args),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def count_paid_plans() -> int:
    async with _db() as db:
        async with db.execute(
            "SELECT COUNT(*) AS c FROM plans WHERE is_free = 0"
        ) as cur:
            return int((await cur.fetchone())["c"])


async def upsert_plan(
    *,
    plan_id: int | None = None,
    title: str,
    data_gb: float,
    price_ks: int,
    duration_days: int,
    server_id: str,
    sort_order: int = 0,
    is_active: bool = True,
) -> dict[str, Any]:
    title_s = title.strip()
    sid = (server_id or "sg").strip().lower()
    active = 1 if is_active else 0
    async with _db() as db:
        if plan_id:
            await db.execute(
                """UPDATE plans SET title = ?, data_gb = ?, price_ks = ?,
                   duration_days = ?, server_id = ?, sort_order = ?,
                   is_active = ?, is_free = 0
                   WHERE id = ?""",
                (
                    title_s,
                    float(data_gb),
                    int(price_ks),
                    int(duration_days),
                    sid,
                    int(sort_order),
                    active,
                    int(plan_id),
                ),
            )
            await db.commit()
            row = await get_plan(int(plan_id))
            if not row:
                raise ValueError("plan not found")
            return row
        cur = await db.execute(
            """INSERT INTO plans
               (title, data_gb, price_ks, duration_days, is_free,
                sort_order, is_active, server_id)
               VALUES (?, ?, ?, ?, 0, ?, ?, ?)""",
            (
                title_s,
                float(data_gb),
                int(price_ks),
                int(duration_days),
                int(sort_order),
                active,
                sid,
            ),
        )
        await db.commit()
        new_id = int(cur.lastrowid)
    row = await get_plan(new_id)
    assert row is not None
    return row


async def set_plan_active(plan_id: int, active: bool) -> bool:
    async with _db() as db:
        cur = await db.execute(
            "UPDATE plans SET is_active = ? WHERE id = ? AND is_free = 0",
            (1 if active else 0, int(plan_id)),
        )
        await db.commit()
        return cur.rowcount > 0


async def delete_plan(plan_id: int) -> bool:
    """Delete a paid catalog plan (never deletes free gift plan)."""
    async with _db() as db:
        cur = await db.execute(
            "DELETE FROM plans WHERE id = ? AND is_free = 0",
            (int(plan_id),),
        )
        await db.commit()
        return cur.rowcount > 0


async def search_users(
    *,
    q: str = "",
    page: int = 1,
    per_page: int = 20,
) -> dict[str, Any]:
    """Search users by telegram id, username, or name."""
    page = max(1, page)
    per_page = min(50, max(1, per_page))
    offset = (page - 1) * per_page
    now = mmt_now().isoformat()
    query = (q or "").strip()
    async with _db() as db:
        if query.isdigit():
            where = "u.telegram_id = ?"
            args_base: list[Any] = [int(query)]
        elif query:
            like = f"%{query.lower()}%"
            where = (
                "(LOWER(COALESCE(u.username, '')) LIKE ? "
                "OR LOWER(COALESCE(u.first_name, '')) LIKE ?)"
            )
            args_base = [like, like]
        else:
            where = "1=1"
            args_base = []

        async with db.execute(
            f"SELECT COUNT(*) AS c FROM users u WHERE {where}",
            tuple(args_base),
        ) as cur:
            total = int((await cur.fetchone())["c"])
        total_pages = max(1, (total + per_page - 1) // per_page)
        page = min(page, total_pages)
        offset = (page - 1) * per_page
        async with db.execute(
            f"""
            SELECT
                u.telegram_id,
                u.username,
                u.first_name,
                u.is_banned,
                COALESCE(f.c, 0) AS free_keys,
                COALESCE(p.c, 0) AS paid_keys
            FROM users u
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS c
                FROM subscriptions
                WHERE is_active = 1 AND is_free = 1 AND expires_at > ?
                GROUP BY user_id
            ) f ON f.user_id = u.id
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS c
                FROM subscriptions
                WHERE is_active = 1 AND is_free = 0 AND expires_at > ?
                GROUP BY user_id
            ) p ON p.user_id = u.id
            WHERE {where}
            ORDER BY u.id DESC
            LIMIT ? OFFSET ?
            """,
            (now, now, *args_base, per_page, offset),
        ) as cur:
            users = [dict(row) for row in await cur.fetchall()]
    return {
        "users": users,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


# ─── VPN nodes (admin-managed locations) ─────────────────────────────────────

async def count_vpn_nodes() -> int:
    async with _db() as db:
        async with db.execute("SELECT COUNT(*) AS c FROM vpn_nodes") as cur:
            return int((await cur.fetchone())["c"])


async def list_vpn_nodes(*, enabled_only: bool = False) -> list[dict[str, Any]]:
    async with _db() as db:
        where = "WHERE enabled = 1" if enabled_only else ""
        async with db.execute(
            f"""SELECT * FROM vpn_nodes {where}
                ORDER BY sort_order ASC, id ASC"""
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def get_vpn_node(node_id: str) -> dict[str, Any] | None:
    sid = (node_id or "").strip().lower()
    if not sid:
        return None
    async with _db() as db:
        async with db.execute(
            "SELECT * FROM vpn_nodes WHERE id = ?", (sid,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def upsert_vpn_node(
    *,
    node_id: str,
    name_en: str,
    name_my: str = "",
    panel_url: str = "",
    panel_username: str = "",
    panel_password: str = "",
    panel_inbound_id: int = 1,
    panel_verify_ssl: bool = True,
    vps_host: str = "",
    vps_port: int = 443,
    vless_security: str = "reality",
    vless_flow: str = "xtls-rprx-vision",
    vless_sni: str = "",
    vless_fp: str = "chrome",
    vless_pbk: str = "",
    vless_sid: str = "",
    vless_spx: str = "/",
    enabled: bool = True,
    sort_order: int = 0,
) -> dict[str, Any]:
    sid = (node_id or "").strip().lower()
    if not sid or not re.match(r"^[a-z0-9_-]{1,32}$", sid):
        raise ValueError("node id must be 1-32 chars: a-z, 0-9, _, -")
    name_en_s = (name_en or sid.upper()).strip()
    name_my_s = (name_my or name_en_s).strip()
    now = mmt_now().isoformat()
    async with _db() as db:
        await db.execute(
            """INSERT INTO vpn_nodes (
                id, name_en, name_my, panel_url, panel_username, panel_password,
                panel_inbound_id, panel_verify_ssl, vps_host, vps_port,
                vless_security, vless_flow, vless_sni, vless_fp, vless_pbk,
                vless_sid, vless_spx, enabled, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name_en = excluded.name_en,
                name_my = excluded.name_my,
                panel_url = excluded.panel_url,
                panel_username = excluded.panel_username,
                panel_password = CASE
                    WHEN excluded.panel_password = '' THEN vpn_nodes.panel_password
                    ELSE excluded.panel_password
                END,
                panel_inbound_id = excluded.panel_inbound_id,
                panel_verify_ssl = excluded.panel_verify_ssl,
                vps_host = excluded.vps_host,
                vps_port = excluded.vps_port,
                vless_security = excluded.vless_security,
                vless_flow = excluded.vless_flow,
                vless_sni = excluded.vless_sni,
                vless_fp = excluded.vless_fp,
                vless_pbk = CASE
                    WHEN excluded.vless_pbk = '' THEN vpn_nodes.vless_pbk
                    ELSE excluded.vless_pbk
                END,
                vless_sid = excluded.vless_sid,
                vless_spx = excluded.vless_spx,
                enabled = excluded.enabled,
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at
            """,
            (
                sid,
                name_en_s,
                name_my_s,
                (panel_url or "").strip().rstrip("/"),
                (panel_username or "").strip(),
                (panel_password or "").strip(),
                int(panel_inbound_id or 1),
                1 if panel_verify_ssl else 0,
                (vps_host or "").strip(),
                int(vps_port or 443),
                (vless_security or "reality").strip(),
                (vless_flow or "xtls-rprx-vision").strip(),
                (vless_sni or "").strip(),
                (vless_fp or "chrome").strip(),
                (vless_pbk or "").strip(),
                (vless_sid or "").strip(),
                (vless_spx or "/").strip() or "/",
                1 if enabled else 0,
                int(sort_order or 0),
                now,
                now,
            ),
        )
        await db.commit()
    row = await get_vpn_node(sid)
    if not row:
        raise ValueError("node save failed")
    return row


async def set_vpn_node_enabled(node_id: str, enabled: bool) -> bool:
    sid = (node_id or "").strip().lower()
    async with _db() as db:
        cur = await db.execute(
            """UPDATE vpn_nodes SET enabled = ?, updated_at = ?
               WHERE id = ?""",
            (1 if enabled else 0, mmt_now().isoformat(), sid),
        )
        await db.commit()
        return cur.rowcount > 0


async def delete_vpn_node(node_id: str) -> bool:
    sid = (node_id or "").strip().lower()
    async with _db() as db:
        cur = await db.execute("DELETE FROM vpn_nodes WHERE id = ?", (sid,))
        await db.commit()
        return cur.rowcount > 0
