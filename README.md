# AirVPN

Burmese Telegram VPN bot with daily gifts, KBZPay auto-verification, and automatic VLESS provisioning via 3x-ui.

## Features

- **Daily gift** — 500 MB/day for all users, with streak bonuses and a free-tier VLESS key
- **Plan purchase** — KBZPay payment with receipt QR auto-verify or manual admin review
- **Auto provisioning** — VLESS keys created on the VPS through the 3x-ui panel API
- **Admin panel** — Approve/reject payments, stats, user ban/unban, broadcast notifications
- **Bilingual UI** — Burmese (default) and English

## Requirements

- Python 3.9+
- Telegram Bot Token ([BotFather](https://t.me/BotFather))
- VPS with 3x-ui panel and a VLESS inbound configured
- KBZPay merchant session for auto-verify (optional)

## Quick start

```bash
cd AirVPN
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — BOT_TOKEN, ADMIN_TELEGRAM_IDS, panel, VPS settings

cp kbz_session.example.json kbz_session.json
# Or point KBZ_SESSION_PATH at the shared file from Payment Manager

python init_db.py
python bot.py
```

For local development without a VPS, set `DEV_MOCK_VPN=true` in `.env`. **Never use this in production.**

## Configuration

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token |
| `ADMIN_TELEGRAM_IDS` | Comma-separated admin Telegram user IDs |
| `PANEL_URL` | 3x-ui panel base URL |
| `VPS_HOST` | Public host/IP for `vless://` URLs |
| `KBZ_AUTO_VERIFY` | Enable receipt QR / transaction ID verification |
| `KBZ_SESSION_PATH` | Path to merchant session JSON (**read-only**). Coolify: `/data/kbz/kbz_session.json` — written only by Donimate Payment Manager |
| `PAYMENTS_PROOFS_GROUP_ID` | Telegram group for receipt screenshots |
| `DEV_MOCK_VPN` | `true` = mock keys (dev only) |

### Payments proofs group

1. Create a Telegram group (e.g. **AirVPN Payments Proofs**)
2. Add the bot as an **admin** (must be able to post messages)
3. Get the group chat ID (forward a group message to `@userinfobot`, or call `getUpdates` after posting in the group)
4. Set `PAYMENTS_PROOFS_GROUP_ID=-100xxxxxxxxxx` in `.env`

Every receipt screenshot is posted to this group with status, plan, amount, and user ID. Manual-review payments include **Approve | Reject** inline buttons.

See [docs/VPS_SETUP.md](docs/VPS_SETUP.md) for panel setup and [docs/SECURITY.md](docs/SECURITY.md) for the production checklist.

## Project layout

```
bot.py # Entry point
config.py # Environment config
database.py # SQLite models and queries
handlers/ # User and admin Telegram handlers
services/ # Payment approval, KBZ verify, notifications
payments/kbz/ # KBZPay API client and verification
vps/panel_client.py # 3x-ui API + VLESS URL builder
utils/ # Formatting, rate limits, startup validation
```

## Admin usage

Admins see a ** Admin** button in the main menu.

- **Pending payments** — Review receipts, approve or reject
- **Stats** — User and subscription counts
- **Ban/Unban** — Enter a Telegram user ID to toggle ban
- **Notifications** — Broadcast to all users or active subscribers

## Production deployment

1. Set `ENV=production` and `DEV_MOCK_VPN=false`
2. Fill all VPS and KBZ settings; run `python bot.py` once to validate config
3. Keep `kbz_session.json` and `.env` out of git (see `.gitignore`)
4. Run under systemd or a process manager; back up `airvpn.sqlite3` regularly
5. Review [docs/SECURITY.md](docs/SECURITY.md) before going live

## License

Private project — use and modify as needed for your deployment.
