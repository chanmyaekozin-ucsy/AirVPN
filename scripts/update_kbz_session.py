#!/usr/bin/env python3
"""Read-only KBZ session probe for AirVPN.

Session writes belong only to Donimate Payment Manager.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import config  # noqa: E402
from payments.kbz.session_store import probe_session  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Probe shared KBZ session (read-only). Use Payment Manager to update."
    )
    parser.add_argument(
        "--session",
        default=config.KBZ_SESSION_PATH,
        help=f"Session JSON path (default: {config.KBZ_SESSION_PATH})",
    )
    args = parser.parse_args()
    session_path = Path(args.session)

    print(
        "Note: AirVPN does not write KBZ sessions.\n"
        "Manage login / upload in Donimate Payment Manager.\n"
    )
    ok, err = probe_session(session_path)
    if ok:
        print("OK — KBZ session is valid")
        return 0
    print(f"INVALID — {err}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
