# AirVPN VPS Setup Guide — Auto VLESS Key Generation

This guide walks through setting up a VPS with **3x-ui** so the AirVPN Telegram bot can automatically create VLESS keys when an admin approves a payment.

## Architecture

```
User pays (KBZPay/WavePay)
→ sends receipt photo in Telegram
→ Admin taps Approve in bot
→ Bot calls 3x-ui API → adds client with 100 GB limit
→ Bot builds vless:// URL → sends to user
```

## 1. VPS requirements

- Ubuntu 22.04+ (or Debian)
- 1 GB RAM minimum
- Open ports: `443` (VLESS), `2053` or your panel port (restrict to your IP if possible)

## 2. Install 3x-ui

```bash
bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)
```

After install, note:
- Panel URL (e.g. `https://YOUR_IP:2053/xxxxx`)
- Admin username / password

## 3. Create VLESS + Reality inbound

1. Open panel → **Inbounds** → **Add Inbound**
2. Protocol: **VLESS**
3. Port: **443**
4. Security: **Reality**
5. Set SNI, uTLS fingerprint, short ID, public key (panel generates these)
6. Enable the inbound and copy **Inbound ID** (shown in URL or list)

## 4. Configure AirVPN bot

Copy `.env.example` → `.env` and fill in:

```env
PANEL_URL=https://YOUR_IP:2053/xxxxx
PANEL_USERNAME=admin
PANEL_PASSWORD=your-password
PANEL_INBOUND_ID=1

VPS_HOST=YOUR_PUBLIC_IP_OR_DOMAIN
VPS_PORT=443

VLESS_SECURITY=reality
VLESS_FLOW=xtls-rprx-vision
VLESS_SNI=www.microsoft.com
VLESS_FP=chrome
VLESS_PBK=paste-public-key-from-panel
VLESS_SID=paste-short-id-from-panel
VLESS_SPX=/
```

**Important:** `VLESS_PBK`, `VLESS_SID`, `VLESS_SNI` must match your inbound Reality settings exactly, or clients won't connect.

## 5. How auto-provisioning works

When admin approves payment, `vps/panel_client.py`:

1. Logs into 3x-ui panel
2. Fetches inbound by `PANEL_INBOUND_ID`
3. Appends a new client:
- `email`: `tg_{telegram_id}_{uuid8}`
- `totalGB`: plan data limit (e.g. 100 GB)
- `expiryTime`: plan duration in days
4. Updates inbound via API
5. Builds `vless://uuid@host:port?...` URL
6. Saves to SQLite and messages the user

## 6. Run the bot

```bash
cd AirVPN
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env

python init_db.py # seed 100 GB / 3000 Ks plan + payment accounts
python bot.py
```

## 7. Payment flow (KBZPay / WavePay)

| Step | User | Admin |
|------|------|-------|
| 1 | Tap **ပလန် ဝယ်မည်** → choose 100 GB plan | — |
| 2 | Pick KBZPay or WavePay → transfer 3000 Ks | — |
| 3 | Send receipt screenshot | Gets notification + photo |
| 4 | Waits for approval | Tap ** အတည်ပြုမည်** |
| 5 | Receives VLESS key automatically | — |

Edit payment account numbers in `init_db.py` or directly in SQLite `payment_accounts` table.

## 8. Daily gift flow

- **Free for all users** — no plan required
- Tap **နေ့စဉ် လက်ဆောင်** once per day (Myanmar time UTC+6:30)
- Base: **500 MB/day** (+ streak bonus up to 7 days)
- Bonus MB is saved on the user account
- **Free users** get an auto-generated VLESS key (500 MB limit, renewed each claim)
- **Paid users** get bonus MB added to their subscription instead of a separate free key

## 9. Security tips

- Restrict panel port to your IP via firewall
- Use strong panel password
- Keep `ADMIN_TELEGRAM_IDS` limited to trusted accounts
- Run bot on same VPS or a trusted server with `.env` chmod 600
- Consider HTTPS reverse proxy (nginx) in front of panel

## 10. Troubleshooting

| Problem | Fix |
|---------|-----|
| Panel login failed | Check `PANEL_URL`, username, password |
| add client failed | Verify `PANEL_INBOUND_ID` and inbound is VLESS |
| Key doesn't connect | Re-copy Reality params from panel to `.env` |
| User gets mock key | `PANEL_URL` or `VPS_HOST` empty — fill both |

## Alternative panels

The bot is built for **3x-ui**. For **Marzban**, you would replace `vps/panel_client.py` with Marzban's REST API (`POST /api/user`).
