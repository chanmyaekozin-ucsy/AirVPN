# AirVPN — Unified Web Platform & Telegram Bot

AirVPN is a high-performance, all-in-one VPN management and sales platform built with **Next.js 15 (App Router)** and **TypeScript**.

It serves as the **single source of truth** for web customers, WathanPay mini-apps, and Telegram bot users.

---

## Features

- **WathanPay Mini-App & Web Checkout**: Direct in-app payment and instant VLESS provisioning.
- **Dominate Gateway Integration**: Automated KBZPay and WavePay direct transfers.
- **Full Admin Panel** (`/admin`):
  - **Servers**: 1-click VPS SSH setup, Reality config generator, and 3x-ui sync.
  - **Plans**: Custom data quotas, durations, and pricing per server.
  - **Keys & Customers**: After-sale management, customer contact tracking (WathanPay, Google, Email, Phone, Telegram), and 1-click key replacement / node switching.
  - **Purchases & Transactions**: Financial overview and payment audits.
- **Unified Telegram Bot Webhook** (`/api/telegram/webhook`):
  - In-app bot server driven directly by `store.json`.
  - Captures customer Telegram usernames for support.
  - Dynamic `/plans` and `/mykeys` lookups.
  - Real-time Telegram payment alerts to admin groups.
- **Dynamic VLESS Subscription Provider** (`/sub/[token]`):
  - Compatible with v2rayNG, Hiddify, Streisand, v2rayN, and Shadowrocket.
  - Auto-updates node remarks (e.g. `Singapore_Ko_Kyaw_100Gb`).

---

## Quick Start (Local Development)

```bash
# 1. Enter the web application directory
cd web

# 2. Install dependencies
npm install

# 3. Copy environment configuration
cp ../.env.example .env

# 4. Start local development server
npm run dev

# 5. Run test suite
npm test
```

---

## Standalone Android Applications

- **Client App** (`android/`): Native Android VPN client with Xray-core / VLESS / SSH tunnel support. See [docs/ANDROID.md](docs/ANDROID.md).
- **Admin App** (`android-admin/`): Native Android administrator application for mobile management.

---

## Deployment with Coolify / Docker

See the full step-by-step guide in [COOLIFY.md](COOLIFY.md).

1. Add your Git repository to Coolify.
2. Select **Dockerfile** build pack (uses root `Dockerfile`).
3. Add persistent volume mapping: Destination `/app/data`.
4. Set environment variables from [.env.example](.env.example).
5. Deploy!


