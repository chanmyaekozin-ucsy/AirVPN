# AirVPN Security Checklist

Use this checklist before running the bot in production.

## Secrets and access

- [ ] `.env` and `kbz_session.json` are **not** committed to git
- [ ] `ADMIN_TELEGRAM_IDS` lists only trusted operators
- [ ] `PANEL_PASSWORD` is strong and panel URL is not publicly exposed without auth
- [ ] KBZ session token is rotated if compromised

## VPS and VPN provisioning

- [ ] `DEV_MOCK_VPN=false` in production
- [ ] `PANEL_URL` and `VPS_HOST` are set — bot refuses to start without them
- [ ] `PANEL_VERIFY_SSL=true` unless you use a valid private CA
- [ ] 3x-ui panel is reachable only over HTTPS / VPN / firewall

## Payments

- [ ] Transaction IDs are **globally unique** in the database (replay blocked)
- [ ] Payment approval is atomic — only one approve succeeds per pending payment
- [ ] Users can only submit receipts for their own pending payments
- [ ] Failed verifications do not leak amount/receiver details to users
- [ ] Stale pending payments are cancelled when a user starts a new purchase

## Rate limiting

Default limits (configurable in `.env`):

| Action | Default limit |
|--------|---------------|
| Daily gift claim | 1 per day per user |
| New payment | 5 per hour per user |
| Receipt screenshot | 2 per minute per user |
| KBZ verify | 10 per hour per user |

## Admin operations

- [ ] Admin actions require Telegram ID in `ADMIN_TELEGRAM_IDS`
- [ ] Internal errors are logged server-side, not shown in Telegram alerts
- [ ] Ban/unban is available for abusive users (`Admin → Ban/Unban`)

## Database

- [ ] SQLite file permissions restrict read/write to the bot user
- [ ] Regular backups of `airvpn.sqlite3`
- [ ] WAL mode enabled (default) for safer concurrent access

## Monitoring

- [ ] Bot logs reviewed for `Panel error`, `provision failed`, `Tx replay blocked`
- [ ] KBZ `token_invalid` alerts trigger session refresh
- [ ] Unhandled errors captured by the global error handler in `bot.py`

## Known limitations

- Admin auth is Telegram ID allowlist only (no 2FA)
- Rate limits are in-memory (reset on bot restart; use one bot instance)
- Panel client uses read-modify-write on inbound settings (low concurrency risk)

## Incident response

1. **Leaked bot token** — Revoke via BotFather, deploy new token
2. **Leaked KBZ session** — Invalidate session, capture new token, update `kbz_session.json`
3. **Compromised panel** — Rotate panel password, audit inbound clients
4. **Payment fraud** — Ban user, check `payments` table for `receipt_tx_id` patterns
