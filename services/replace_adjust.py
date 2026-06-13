"""Fair quota adjustment when moving keys between differently priced servers."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import database as db
from vpn_servers import (
    get_env_plan_by_sort,
    get_server,
    servers_have_same_pricing,
)

MIN_ADJUST_GB = 0.001  # 1 MB


@dataclass(frozen=True)
class ReplaceOption:
    key: str  # keep_days | keep_data
    data_gb: float
    expires_at: str
    days: int

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "data_gb": self.data_gb,
            "expires_at": self.expires_at,
            "days": self.days,
        }


def _parse_expires(expires_at: str) -> datetime:
    exp = datetime.fromisoformat(expires_at)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=db.MMT)
    return exp


def _remaining_days(expires_at: str) -> float:
    exp = _parse_expires(expires_at)
    now = db.mmt_now()
    return max(0.0, (exp - now).total_seconds() / 86400)


def fmt_gb(gb: float) -> str:
    if abs(gb - round(gb)) < 0.05:
        return str(int(round(gb)))
    text = f"{gb:.1f}".rstrip("0").rstrip(".")
    return text or "0"


async def compute_replace_options(
    sub: dict,
    remaining_gb: float,
    expires_at: str,
    target_server_id: str,
) -> tuple[bool, list[ReplaceOption]]:
    """
    When source/target plan prices differ, return two fair conversion choices.
    Returns (needs_adjustment, options). options is empty if adjustment failed.
    """
    from_server = (sub.get("server_id") or "sg").strip().lower()
    target_server_id = target_server_id.strip().lower()
    source = get_server(from_server)
    target = get_server(target_server_id)
    if not source or not target:
        return False, []

    if servers_have_same_pricing(source, target):
        return False, []

    plan = await db.get_plan(sub["plan_id"])
    sort_order = int(plan["sort_order"]) if plan and plan.get("sort_order") else 1
    source_plan = get_env_plan_by_sort(from_server, sort_order)
    target_plan = get_env_plan_by_sort(target_server_id, sort_order)
    if not source_plan or not target_plan or target_plan.price_ks <= 0:
        return True, []

    ratio = source_plan.price_ks / target_plan.price_ks
    rem_days = _remaining_days(expires_at)
    if rem_days < 1 or remaining_gb < MIN_ADJUST_GB:
        return True, []

    options: list[ReplaceOption] = []

    keep_days_gb = round(max(MIN_ADJUST_GB, remaining_gb * ratio), 4)
    if keep_days_gb * (1024**3) >= 1024 * 1024:
        options.append(
            ReplaceOption(
                key="keep_days",
                data_gb=keep_days_gb,
                expires_at=expires_at,
                days=max(1, int(round(rem_days))),
            )
        )

    keep_data_days = max(1, int(round(rem_days * ratio)))
    keep_data_exp = (db.mmt_now() + timedelta(days=keep_data_days)).isoformat()
    if remaining_gb * (1024**3) >= 1024 * 1024:
        options.append(
            ReplaceOption(
                key="keep_data",
                data_gb=round(remaining_gb, 4),
                expires_at=keep_data_exp,
                days=keep_data_days,
            )
        )

    return True, options
