#!/usr/bin/env python3
"""Poll Telegram getUpdates briefly to discover group/supergroup chat IDs."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

from dotenv import load_dotenv

load_dotenv()
TOKEN = os.getenv("BOT_TOKEN", "")
if not TOKEN:
    print("BOT_TOKEN missing in .env", file=sys.stderr)
    sys.exit(1)

API = f"https://api.telegram.org/bot{TOKEN}"


def get_updates(offset: int | None, timeout: int = 25) -> list:
    url = f"{API}/getUpdates?timeout={timeout}&allowed_updates=%5B%22message%22,%22my_chat_member%22,%22chat_member%22%5D"
    if offset is not None:
        url += f"&offset={offset}"
    with urllib.request.urlopen(url, timeout=timeout + 10) as resp:
        data = json.loads(resp.read())
    if not data.get("ok"):
        raise RuntimeError(data)
    return data.get("result", [])


def extract_chats(updates: list) -> dict[int, dict]:
    found: dict[int, dict] = {}
    for u in updates:
        for key in ("message", "edited_message", "channel_post"):
            obj = u.get(key)
            if not obj:
                continue
            chat = obj.get("chat", {})
            if chat.get("type") in ("group", "supergroup"):
                found[chat["id"]] = {
                    "title": chat.get("title", ""),
                    "type": chat["type"],
                }
        mcm = u.get("my_chat_member")
        if mcm:
            chat = mcm.get("chat", {})
            if chat.get("type") in ("group", "supergroup"):
                found[chat["id"]] = {
                    "title": chat.get("title", ""),
                    "type": chat["type"],
                    "event": "bot_added",
                }
    return found


def main() -> None:
    print("Listening for group activity (send a message in AirVPN Payments Proofs)…")
    print("Press Ctrl+C to stop.\n")
    offset = None
    seen: dict[int, dict] = {}
    deadline = time.time() + 90
    while time.time() < deadline:
        try:
            updates = get_updates(offset, timeout=20)
        except Exception as exc:
            print(f"poll error: {exc}", file=sys.stderr)
            time.sleep(2)
            continue
        for u in updates:
            offset = u["update_id"] + 1
        for cid, info in extract_chats(updates).items():
            if cid not in seen:
                seen[cid] = info
                print(f"FOUND\t{cid}\t{info.get('type')}\t{info.get('title')}")
        if seen:
            for cid, info in sorted(seen.items()):
                title = info.get("title", "")
                if "payment" in title.lower() or "airvpn" in title.lower() or len(seen) == 1:
                    print(f"\nSuggested .env line:")
                    print(f"PAYMENTS_PROOFS_GROUP_ID={cid}")
                    return
    if seen:
        print("\nAll groups seen:")
        for cid, info in sorted(seen.items()):
            print(f"  {cid}  {info.get('title')}")
        print("\nPick the AirVPN Payments Proofs id and set PAYMENTS_PROOFS_GROUP_ID")
    else:
        print("No group updates received. Post any message in the group while this runs.")
        sys.exit(1)


if __name__ == "__main__":
    main()
