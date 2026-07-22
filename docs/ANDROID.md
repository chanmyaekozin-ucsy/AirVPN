# AirVPN Android + Mobile API

## Layout

- `android/` — Kotlin + Jetpack Compose client (`com.airvpn.app`)
- `api/` — FastAPI mobile REST API (`python -m api.main`)

## Run mobile API

```bash
source .venv/bin/activate
# set MOBILE_CONFIG_KEY in .env (same string as Android CONFIG_KEY_MATERIAL)
python -m api.main
```

Default: `http://0.0.0.0:8081`

Production host: `https://airvpn.flash-myanmar.com/` (Android `API_BASE_URL`).

### Endpoints

- `GET /v1/app/config` — includes update fields + `announcements[]`
- `GET /v1/announcements`
- `GET /v1/servers`
- `POST /v1/import` `{ "code": "847291Ab3c" }`
- `GET /v1/me` + `Authorization: Bearer <code>`
- `POST /v1/connect` `{ "server_id": "sg-free" }`

### Updates & announcements

Edit `data/mobile_app.json` (or env vars):

| Field | Purpose |
|-------|---------|
| `latest_version_code` / `latest_version_name` | Soft/force update notice |
| `force_update` | Stronger update prompt |
| `changelog` | Shown in update dialog |
| `announcements` | Dialogs: `id`, `title`, `body`, `dismissible`, `cta_*` |
| `play_url` / telegram | “Open store” for updates |

**No APK OTA / sideload install** — updates go through Play (or your store link) only.

Env overrides: `AIRVPN_LATEST_VERSION_CODE`, `AIRVPN_FORCE_UPDATE`, etc.

### Admin catalog (Telegram)

Admin → **App Servers**, then:

```
ms add sg-free|Singapore Free|SG|vless|free|sg|vless://...
ms add sg-paid|Singapore Pro|SG|vless|paid|sg|1
ms on sg-free
ms off sg-free
ms del sg-free
```

Paid `plan_id` is the numeric `plans.id` from the bot DB.

### Ads (first-party)

Admin → **App Ads**, then:

```
ad add banner|summer|/ads/summer.png|https://t.me/AirVPNBot|640|100|Summer sale
ad add dialog|promo|https://cdn.example/promo.jpg|https://shop.example|600|800
ad on summer
ad off summer
ad del summer
```

- `banner` — horizontal strip under Connect on Main
- `dialog` — mandatory ~3s interstitial before Connect
- Ads are **hidden** when the user has an active imported subscription or paid AirVPN profile
- Local files: put images in `data/ads/` and use `/ads/filename.png` (set `MOBILE_API_PUBLIC_BASE` for absolute URLs)
- Also configurable via `data/mobile_app.json` → `"ads": [...]`

### Analytics

- `POST /v1/analytics/event` — `app_open` (DAU) and `ad_click`
- Shown in Telegram Admin → **Statistics** (DAU today / 7-day, ad clicks)

## Android

Open `android/` in Android Studio. Set:

- `API_BASE_URL` in `app/build.gradle.kts` (production: `https://airvpn.flash-myanmar.com/`; emulator local: `http://10.0.2.2:8081/`)
- `CONFIG_KEY_MATERIAL` to match `MOBILE_CONFIG_KEY`

Screens: **Main** / **Servers** (Import + Refresh) / **Info**.

VPN: `AirVpnService` establishes TUN + Play-required notification. Wire **AndroidLibXray / libv2ray** into `startCore()` for full VLESS traffic.

## Play Store notes

- VPN disclosure dialog before first connect
- `foregroundServiceType=specialUse` + VPN notification
- Privacy URL in Info
- No injector editor; configs server-controlled
