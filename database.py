"""Async SQLite database for AirVPN bot."""
from __future__ import annotations

import json
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


# ─── Daily gift ──────────────────────────────────────────────────────────────

def _daily_gift_preview(user: aiosqlite.Row | dict[str, Any]) -> dict[str, Any]:
    """Compute today's gift without writing. Used before VPN provisioning."""
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

    bonus_mb = config.DAILY_GIFT_MB
    return {"ok": True, "mb": bonus_mb, "streak": streak, "total_mb": bonus_mb}


async def preview_daily_gift(user_id: int) -> dict[str, Any]:
    """Returns gift preview; ok=False with reason=already_claimed if claimed today."""
    async with _db() as db:
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            user = await cur.fetchone()
    if not user:
        return {"ok": False, "reason": "no_user"}
    return _daily_gift_preview(user)


async def claim_daily_gift(user_id: int) -> dict[str, Any]:
    """Returns {'ok': bool, 'reason'?: str, 'mb'?: int, 'streak'?: int, 'total_mb'?: int}"""
    today = mmt_today()
    async with _db() as db:
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            user = await cur.fetchone()
        if not user:
            return {"ok": False, "reason": "no_user"}

        preview = _daily_gift_preview(user)
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
    from vpn_servers import list_servers, reload_servers

    reload_servers()
    async with _db() as db:
        for server in list_servers():
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
    """Atomically reserve a transaction ID for a pending payment."""
    tx_id = (tx_id or "").strip()
    if not tx_id:
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
                    return False
            cur = await db.execute(
                """UPDATE payments SET receipt_tx_id = ?
                   WHERE id = ? AND status = 'pending'
                   AND (receipt_tx_id IS NULL OR receipt_tx_id = ?)""",
                (tx_id, payment_id, tx_id),
            )
            if cur.rowcount == 0:
                await db.rollback()
                return False
            await db.commit()
            return True
        except aiosqlite.IntegrityError:
            await db.rollback()
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
                   pl.title AS plan_title, pl.data_gb, pl.duration_days
            FROM payments p
            JOIN users u ON u.id = p.user_id
            JOIN plans pl ON pl.id = p.plan_id
            WHERE p.id = ?
            """,
            (payment_id,),
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
            """SELECT s.*, p.title AS plan_title
               FROM subscriptions s
               JOIN plans p ON p.id = s.plan_id
               WHERE s.id = ?""",
            (sub_id,),
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


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


# ─── Notifications (admin broadcast) ─────────────────────────────────────────

async def get_broadcast_telegram_ids(audience: str) -> list[int]:
    """audience: 'all' or 'active'"""
    now = mmt_now().isoformat()
    async with _db() as db:
        if audience == "active":
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
