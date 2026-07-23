# SSH over TLS (stunnel) — AirVPN catalog

AirVPN can publish **SSH** free/paid catalog servers. The app opens a real SSH
session (password auth) wrapped in TLS with a custom SNI, then routes device
traffic through a local SOCKS → TUN path.

Users never paste SSH credentials. Admins configure them in **Admin → Catalog**
with `protocol=ssh`.

## Threat model (read this)

Catalog SSH uses a **shared** tunnel account. Anyone who can call `/v1/connect`
for that server receives a short-lived encrypted payload containing the password.

Therefore the VPS account **must not** be root or a normal shell user.

## Recommended VPS layout

```
Internet :443 (TLS, SNI = e.g. www.microsoft.com)
    → stunnel or nginx stream SSL
        → 127.0.0.1:22 (sshd)
            → user `airtunnel` (tunnel-only)
```

### 1. Tunnel-only SSH user

```bash
sudo adduser --disabled-password airtunnel
sudo passwd airtunnel   # strong unique password — store only in AirVPN admin
```

`/etc/ssh/sshd_config.d/airtunnel.conf`:

```
Match User airtunnel
    AllowTcpForwarding yes
    PermitTunnel no
    X11Forwarding no
    AllowAgentForwarding no
    PermitTTY no
    ForceCommand /bin/false
    PasswordAuthentication yes
```

Disable root password login globally:

```
PermitRootLogin prohibit-password
PasswordAuthentication no
```

(Then enable password only inside the `Match User airtunnel` block as above.)

Reload:

```bash
sudo systemctl reload ssh
```

### 2. stunnel example (TLS + SNI)

`/etc/stunnel/stunnel.conf`:

```
[ssh-tls]
accept  = 443
connect = 127.0.0.1:22
cert    = /etc/stunnel/fullchain.pem
key     = /etc/stunnel/privkey.pem
```

Use a certificate whose CN/SAN matches the SNI you configure in Admin
(e.g. a domain you control, or fronting setup you already operate).

### 3. Admin catalog fields

| Field | Example |
|-------|---------|
| Protocol | `ssh` |
| Tier | `free` or `paid` |
| Host | VPS IP or hostname |
| Port | `443` |
| Username | `airtunnel` |
| Password | (write-only; blank on edit = keep) |
| TLS | on |
| SNI | `www.example.com` |
| Allow insecure | off (blocked on free) |

Password is encrypted at rest (`MOBILE_CONFIG_KEY`) and never returned by admin
GET APIs (`ssh_password_set` only). The consumer app receives it only via
`POST /v1/connect` AES payload (≈120s TTL) and keeps it in memory for the
session.

## Paid entitlement

Paid SSH rows require a logged-in restore code / token and an active paid
subscription (matching `vpn_server_id` when set, otherwise any paid sub).

## Ops checklist

- [ ] Dedicated `airtunnel` user, no shell
- [ ] Root password login disabled
- [ ] Fail2ban or equivalent on sshd / stunnel
- [ ] Strong unique password; rotate if a free tier was abused
- [ ] TLS cert valid for configured SNI (`allowInsecure` off)
