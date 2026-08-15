# Deploy AirVPN Web on Coolify

Public URL: `https://airnetworkshop.flash-myanmar.com`

## Resource

1. Coolify → **Dockerfile**
2. Repo: AirVPN / branch `main`
3. **Base Directory:** `web`
4. **Port:** `3000`
5. Domain: `airnetworkshop.flash-myanmar.com` + SSL

## Volumes

| Mount | Purpose |
|-------|---------|
| `/app/data` | shop `store.json` |

## Env

| Variable | Notes |
|----------|-------|
| `AUTH_SECRET` | long random |
| `ADMIN_EMAIL` / `ADMIN_PIN` | admin login |
| `DOMINATE_GATEWAY_URL` | e.g. `https://pgw.flash-myanmar.com` |
| `DOMINATE_GATEWAY_API_KEY` | **AirVPN** Dominate project key |

Subscription link base (`/sub/{token}` URLs handed to buyers) is **not** an env var here —
it's `store.settings.subPublicBaseUrl`, set via **Admin → Servers**. Must match this
resource's own domain (`https://airnetworkshop.flash-myanmar.com`), not the bot's
`airnetwork.flash-myanmar.com` — the web shop's `/sub/[token]` route is separate from the
bot's `/sub/{token}` endpoint and reads from `store.json`, not the bot's SQLite DB.

## WathanPay

Allowlist `https://airnetworkshop.flash-myanmar.com` in the WathanPay mini-app config.

## Healthcheck

Path: `/api/health`
