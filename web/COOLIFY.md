# Deploy AirVPN Web on Coolify

Public URL suggestion: `https://airvpn.flash-myanmar.com`

## Resource

1. Coolify → **Dockerfile**
2. Repo: AirVPN / branch `main`
3. **Base Directory:** `web`
4. **Port:** `3000`
5. Domain: `airvpn.flash-myanmar.com` + SSL

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
| `SUB_PUBLIC_BASE_URL` | `https://airnetwork.flash-myanmar.com` |

## WathanPay

Allowlist `https://airvpn.flash-myanmar.com` in the WathanPay mini-app config.

## Healthcheck

Path: `/api/health`
