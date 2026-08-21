# AirVPN VPS Setup & 1-Click Provisioning Guide

AirVPN supports automated VLESS Reality node setup and 3x-ui panel synchronization directly from the Admin Panel (`/admin/servers`).

---

## 1. Automated 1-Click VPS Provisioning (Recommended)

You can provision a fresh VPS directly through the AirVPN Admin Panel without manual configuration:

1. Log into your Admin Panel: `https://your-domain.com/admin/login`
2. Navigate to **Servers** → **Add Server**
3. Enter your VPS connection details:
   - **Host IP**
   - **SSH Port** (default: `22`)
   - **Root Password** or **SSH Private Key**
4. Click **Provision Node**:
   - The platform securely executes `web/scripts/remote-bootstrap.sh` over SSH.
   - Installs Docker and 3x-ui.
   - Configures optimized Reality keys, short IDs, SNI (`www.microsoft.com` / `aws.amazon.com`), and Vision flow.
   - Automatically registers the new server node in `store.json` with ready-to-sell plans!

---

## 2. Manual 3x-ui Installation (Alternative)

If you prefer to configure a server manually:

1. Install 3x-ui on your Ubuntu/Debian VPS:
   ```bash
   bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)
   ```
2. Create a **VLESS + Reality** Inbound:
   - Protocol: `VLESS`
   - Port: `443` (or custom port)
   - Security: `Reality`
   - Flow: `xtls-rprx-vision`
   - Set SNI (e.g., `www.microsoft.com`) and copy the generated **Public Key (PBK)** and **Short ID (SID)**.
3. In AirVPN Admin Panel (`/admin/servers`), add or edit the server entry with:
   - Panel URL, Username, and Password (or Bearer Secret)
   - Host, Port, and Reality settings.

---

## 3. How Auto-Provisioning & Key Delivery Works

```
1. Customer purchases via WathanPay Mini App, Telegram Bot (/plans), or Web Checkout (Dominate)
2. Payment is verified (Zero-Trust API ledger check or Admin approval)
3. AirVPN server communicates with the VPS 3x-ui panel via REST API
4. Client is added with configured quota and expiry
5. Unique Subscription link (/sub/[token]) and raw VLESS key are delivered to the user immediately
```

---

## 4. Key Replacement & Node Switching

Administrators can switch customer keys or replace banned IPs with a single click in `/admin/keys`:
- Automatically deletes the old client on the source 3x-ui panel.
- Provisions a new UUID on the target server.
- Preserves the customer's remaining quota and expiry timestamp.
- Dynamically updates the `/sub/[token]` subscription URL without requiring the customer to import a new link!

