# AirVPN Web

Next.js shop for AirVPN plans — same pattern as Cloud Game Shop.

- **Standalone web:** Dominate KBZPay / WavePay + TxID last 5
- **WathanPay mini-app:** wallet PIN via `window.WathanPay.pay`
- **Admin:** servers, plans, purchases, transactions

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000  
Admin: http://localhost:3000/admin/login (`ADMIN_EMAIL` / `ADMIN_PIN`)

Public URL (Coolify): `https://airvpn.flash-myanmar.com` (or your chosen subdomain).

After payment, the shop provisions a real VLESS client on the server panel configured in Admin → Servers.

## One-click VPS → shop

**From Admin UI (recommended):** Admin → Servers → **One-click VPS install**  
Enter IP + root password, choose **Force (fresh install)** or **Reuse existing 3x-ui**, then deploy.

**From CLI (optional):**

```bash
npm run vps:install -- --ip 1.2.3.4 --password 'rootpass' --id us2 --region US --mode fresh
```

Then open Admin → Servers → **Test** on the new node.
