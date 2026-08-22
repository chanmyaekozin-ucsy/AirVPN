# Coolify Deployment Guide — AirVPN Unified Web & Bot

AirVPN runs as a **single unified Next.js 15 application** that serves:
1. **AirVPN Web & Mini-App Shop** (WathanPay, KBZPay, WavePay direct checkout).
2. **Admin Panel** (`/admin`, `/admin/keys`, `/admin/purchases`, `/admin/plans`, `/admin/servers`, `/admin/transactions`).
3. **In-App Telegram Bot Webhook** (`/api/telegram/webhook`).
4. **VLESS Subscription Provider** (`/sub/[token]`).
5. **3x-UI Panel & Key Management** (Auto-provisioning & 1-click replacement).

---

## 1. Migration from Old Bot & Web Containers

> **Do you need to remove old containers?**
> **YES.** You can delete the separate legacy Python Bot container and old web container.
> Now you only need **1 single Application resource** in Coolify.

---

## 2. Step-by-Step Setup in Coolify

### Step 1: Create a New Application Resource
1. In Coolify, go to your **Project → Environment**.
2. Click **+ New Resource** → **Public/Private Git Repository**.
3. Repository URL: `https://github.com/chanmyaekozin-ucsy/AirVPN.git`
4. Branch: `main`
5. Build Pack: **Dockerfile** (Coolify will automatically detect the root `Dockerfile`).

### Step 2: Configure Domains & Ports
* **Domains:** `https://airnetwork.flash-myanmar.com` (or your custom domain).
* **Port Exposes:** `3000` (Next.js default).

### Step 3: Configure Persistent Storage (Crucial!)
Go to **Storages / Persistent Storage** tab in Coolify and add:
* **Destination Path:** `/app/data`
* **Source Path:** (Leave default named volume or set a host directory like `/data/airvpn`)
> This ensures your `store.json` (plans, users, keys, and servers) persists across redeployments!

### Step 4: Add Environment Variables
In the **Environment Variables** tab, add:

```env
APP_URL=https://airnetwork.flash-myanmar.com
NEXT_PUBLIC_APP_URL=https://airnetwork.flash-myanmar.com
NODE_ENV=production
PORT=3000

# Admin Password & Auth
ADMIN_PASSWORD=your_secure_admin_password
JWT_SECRET=your_random_32_char_secret

# Telegram Bot & Payment Notifications
BOT_TOKEN=your_bot_token_from_botfather
PAYMENTS_PROOFS_GROUP_ID=-1001234567890
ADMIN_TELEGRAM_IDS=123456789

# Payment Gateway (Dominate)
DOMINATE_GATEWAY_URL=https://pgw.flash-myanmar.com
DOMINATE_GATEWAY_API_KEY=your_dominate_key

# WathanPay
NEXT_PUBLIC_WATHANPAY_MINIAPP=true
```

### Step 5: Deploy
Click **Deploy**! Coolify will build the Docker container using Node 22 and start the server.

---

## 3. Activate Telegram Bot Webhook (1-Click)

Once deployed, link your Telegram bot to the live server:
1. Log into your Admin Panel at `https://airnetwork.flash-myanmar.com/admin/login`.
2. Open in your browser:
   ```text
   https://airnetwork.flash-myanmar.com/api/telegram/set-webhook
   ```
3. You will receive: `{"ok": true, "webhookUrl": "https://airnetwork.flash-myanmar.com/api/telegram/webhook", "telegramResponse": {"ok": true, "result": true, "description": "Webhook was set"}}`.

Now when users message your Telegram bot (`/start`, `/plans`, `/mykeys`), it instantly interacts with the live database!
