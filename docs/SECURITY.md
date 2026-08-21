# AirVPN Security Checklist

Use this checklist before running AirVPN in production.

---

## 1. Secrets and Access Control

- [ ] `.env` is **never** committed to version control.
- [ ] `ADMIN_PASSWORD` / `ADMIN_PIN` is strong and changed from defaults.
- [ ] `AUTH_SECRET` / `JWT_SECRET` is a secure 32+ character random string.
- [ ] `ADMIN_TELEGRAM_IDS` and `PAYMENTS_PROOFS_GROUP_ID` are configured to restrict administrative alerts and actions.

---

## 2. Payments & Zero-Trust Verification

- [ ] **WathanPay Mini-App**: Payment verification enforces Zero-Trust server-to-server validation against official merchant API (`/v1/mini-apps/verify-payment`).
- [ ] **Dominate Gateway**: Signatures and transaction IDs are verified before key fulfillment.
- [ ] Stale orders automatically expire after 3 hours to prevent payment drift.
- [ ] Subscriptions are idempotent and bound to unique order IDs.

---

## 3. VPS & 3x-ui Panel Hardening

- [ ] 3x-ui panel ports are protected behind firewall or accessible via secret panel URL tokens.
- [ ] VLESS Reality keys (`PBK`, `SID`, `SNI`) use valid camouflage domains (`www.microsoft.com`, `aws.amazon.com`).
- [ ] Panel credentials (`panelUsername`, `panelPassword`, `panelSecret`) are stored encrypted/safely in `store.json`.

---

## 4. Subscription & Data Persistence

- [ ] Persistent volume `/app/data` is mapped in Coolify / Docker to safeguard `store.json`.
- [ ] Subscription tokens (`/sub/[token]`) use cryptographically random 32-character hex tokens.

