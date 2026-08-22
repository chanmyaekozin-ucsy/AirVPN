# Dominate Payment Gateway API Integration Guide

Official, zero-dependency integration guide for accepting instant **KBZPay** and **WavePay** deposits and automated P2P payouts on the **Dominate Payment Gateway**.

---

## 1. Overview & Architecture

- **Live Base URL**: `https://pgw.flash-myanmar.com/v1`
- **Admin Dashboard**: `https://pgw.flash-myanmar.com/admin`
- **Supported Providers**: KBZPay, WavePay (Dynamic Multi-Account catalog)
- **Authentication**: `X-API-Key: {YOUR_PROJECT_API_KEY}` (or `Authorization: Bearer {YOUR_PROJECT_API_KEY}`)

```
┌─────────────────┐           ┌────────────────────────┐           ┌─────────────────────┐
│  Client / Shop  │ ────────> │ Dominate Gateway API   │ ────────> │ KBZPay / WavePay    │
│  (Mini App/Web) │ <──────── │ https://pgw.flash...   │ <──────── │ Real-Time Sessions  │
└─────────────────┘           └────────────────────────┘           └─────────────────────┘
```

---

## 2. Quick Start: 3-Step Deposit Flow

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant Shop as Your Server / Shop
    participant Gateway as Dominate Payment Gateway
    participant Wallet as KBZPay / WavePay

    Shop->>Gateway: 1. GET /v1/payment-methods
    Gateway-->>Shop: Active accounts (KBZ / Wave phone numbers & names)
    Shop->>Customer: Display Payee phone number / QR Code

    Shop->>Gateway: 2. POST /v1/deposits (amount, external_ref, account_id)
    Gateway-->>Shop: Deposit Order created (ID: dep_xxx, expires in 15 mins)

    Customer->>Wallet: Transfer money in KBZPay / WavePay app
    Customer->>Shop: Submits Last 5 digits of TrxID (e.g. 94812)

    Shop->>Gateway: 3. POST /v1/deposits/{id}/verify (last5: "94812")
    Gateway->>Wallet: Matches inbound transaction history & amount
    Gateway-->>Shop: status: "paid", matched_order_id: "202608170094812"
    Shop->>Customer: Deliver goods / Top-up balance
```

---

## 3. Authentication & Headers

Every request to `/v1/*` requires your Project API Key (generated inside the Admin Dashboard at `https://pgw.flash-myanmar.com/admin/projects`).

```http
X-API-Key: dpk_live_xxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```
*(Or header `Authorization: Bearer dpk_live_xxxxxxxxxxxxxxxxxxxxxxxx`)*

---

## 4. API Endpoints Reference

### 4.1. Health Check
Check gateway status and uptime.

```http
GET https://pgw.flash-myanmar.com/health
```

#### Response (`200 OK`):
```json
{
  "ok": true,
  "service": "dominate-payment-gateway"
}
```

---

### 4.2. List Available Payment Methods
Returns active KBZPay and WavePay accounts enabled for your project.

```http
GET https://pgw.flash-myanmar.com/v1/payment-methods
X-API-Key: {YOUR_API_KEY}
```

#### Response (`200 OK`):
```json
{
  "accounts": [
    {
      "id": "kbz_09987654321",
      "provider": "kbz",
      "method": "kbzpay",
      "msisdn": "09987654321",
      "display_name": "U DOMINATE SHOP"
    },
    {
      "id": "wave_09771234567",
      "provider": "wave",
      "method": "wavepay",
      "msisdn": "09771234567",
      "display_name": "DAW PAYMENT HUB"
    }
  ]
}
```

---

### 4.3. Create Deposit Order
Creates a pending deposit request with automated QR code and 15-minute TTL.

```http
POST https://pgw.flash-myanmar.com/v1/deposits
X-API-Key: {YOUR_API_KEY}
Content-Type: application/json
```

#### Request Body:
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `account_id` | `string` | **Yes** | Selected account ID from `/payment-methods` |
| `amount_ks` | `integer` | **Yes** | Exact amount in Myanmar Kyats (e.g. `5000`) |
| `external_ref` | `string` | **Yes** | Your store's unique Order ID (idempotent key) |
| `callback_url` | `string` | No | Webhook URL triggered immediately when paid |

#### Request Example:
```json
{
  "account_id": "kbz_09987654321",
  "amount_ks": 5000,
  "external_ref": "ORDER_20260817_1001",
  "callback_url": "https://your-shop.com/api/webhooks/payment"
}
```

#### Response (`200 OK`):
```json
{
  "id": "dep_a1b2c3d4e5f67890",
  "status": "pending",
  "account_id": "kbz_09987654321",
  "provider": "kbz",
  "amount_ks": 5000,
  "external_ref": "ORDER_20260817_1001",
  "project_id": "wathanpay",
  "created_at": 1787059200.0,
  "expires_at": 1787060100.0,
  "payee": {
    "msisdn": "09987654321",
    "display_name": "U DOMINATE SHOP"
  },
  "qr_payload": "00020101021126...",
  "qr_png_base64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "matched_order_id": null,
  "paid_at": null,
  "error": null
}
```

---

### 4.4. Verify Deposit with TrxID Last 5 Digits
Automated matching against official bank/wallet transaction history.

```http
POST https://pgw.flash-myanmar.com/v1/deposits/{deposit_id}/verify
X-API-Key: {YOUR_API_KEY}
Content-Type: application/json
```

#### Request Body:
```json
{
  "last5": "45678"
}
```

#### Successful Response (`200 OK` - Paid):
```json
{
  "id": "dep_a1b2c3d4e5f67890",
  "status": "paid",
  "account_id": "kbz_09987654321",
  "provider": "kbz",
  "amount_ks": 5000,
  "external_ref": "ORDER_20260817_1001",
  "matched_order_id": "202608170045678",
  "paid_at": 1787059345.0,
  "verify_reason": "matched",
  "submitted_last5": "45678"
}
```

#### Response (`200 OK` - Not Found Yet):
```json
{
  "id": "dep_a1b2c3d4e5f67890",
  "status": "pending",
  "verify_reason": "no_match",
  "submitted_last5": "45678"
}
```

> [!TIP]
> **503 Provider Unavailable Handling**: If the wallet provider is rate-limiting (429) or refreshing sessions, the API returns `503 Service Unavailable`. The deposit expiry is automatically extended. **Do not treat 503 as a wrong TrxID; prompt the user or retry polling after a few seconds.**

---

### 4.5. Get Deposit Order Status (Polling)
Check order status anytime.

```http
GET https://pgw.flash-myanmar.com/v1/deposits/{deposit_id}
X-API-Key: {YOUR_API_KEY}
```

---

### 4.6. Automated Payout / Cashout (Withdrawal)
Initiate real-time P2P transfer from your wallet balance to customer's KBZ/Wave account.

```http
POST https://pgw.flash-myanmar.com/v1/withdrawals
X-API-Key: {YOUR_API_KEY}
Content-Type: application/json
```

#### Request Body:
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `account_id` | `string` | **Yes** | Sender wallet account ID |
| `to_msisdn` | `string` | **Yes** | Receiver phone number (e.g. `09123456789`) |
| `amount_ks` | `integer` | **Yes** | Amount in Myanmar Kyats |
| `external_ref` | `string` | **Yes** | Unique withdrawal reference ID |
| `note` | `string` | No | Transfer note/remark (default: `"Payment"`) |

#### Request Example:
```json
{
  "account_id": "kbz_09987654321",
  "to_msisdn": "09123456789",
  "amount_ks": 10000,
  "external_ref": "WD_20260817_9901",
  "note": "WathanPay Cashout"
}
```

#### Response (`200 OK` - Processing / Timeout):
```json
{
  "id": "wd_f8e7d6c5b4a321",
  "status": "processing",
  "account_id": "kbz_09987654321",
  "provider": "kbz",
  "to_msisdn": "09123456789",
  "amount_ks": 10000,
  "external_ref": "WD_20260817_9901",
  "order_id": null,
  "created_at": 1787059200.0,
  "completed_at": null,
  "error": "Upstream network timeout - payout pending verification"
}
```

> [!TIP]
> **Timeout & Double-Payout Defense**: If upstream bank servers experience a network delay during transfer, status remains `"processing"`. **Do not immediately retry the transfer**; poll `GET /v1/withdrawals/{id}` to verify completion.

---

## 5. Webhook Callbacks

When you provide a `callback_url` during deposit creation, Dominate Gateway sends an HTTP `POST` request with the deposit object as soon as the deposit is verified as `paid`.

### Security & Signature Verification:
1. **SSRF Protection**: Webhook URLs must be public `http` or `https` endpoints (internal IP ranges like `127.0.0.1` or `192.168.x.x` are blocked).
2. **Signature Header**: Every webhook request includes an HMAC-SHA256 signature header:
   ```http
   X-Signature-SHA256: a1b2c3d4e5f6...
   Content-Type: application/json; charset=utf-8
   User-Agent: Dominate-Payment-Gateway-Webhook/1.0
   ```

### Webhook Payload Example:
```json
{
  "id": "dep_a1b2c3d4e5f67890",
  "status": "paid",
  "account_id": "kbz_09987654321",
  "provider": "kbz",
  "amount_ks": 5000,
  "external_ref": "ORDER_20260817_1001",
  "project_id": "wathanpay",
  "created_at": 1787059200.0,
  "expires_at": 1787060100.0,
  "payee": {
    "msisdn": "09987654321",
    "display_name": "U DOMINATE SHOP"
  },
  "matched_order_id": "202608170045678",
  "paid_at": 1787059345.0,
  "submitted_last5": "45678",
  "verify_reason": "matched"
}
```

> [!IMPORTANT]
> Your webhook receiver endpoint must return an HTTP status code in the `2xx` range (e.g. `200 OK`).

---

## 6. Implementation Code Examples

### Node.js / Express / TypeScript

```typescript
import axios from 'axios';

const GATEWAY_URL = 'https://pgw.flash-myanmar.com/v1';
const API_KEY = process.env.DOMINATE_API_KEY!;

const client = axios.create({
  baseURL: GATEWAY_URL,
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// 1. Get Payment Accounts
export async function getPaymentMethods() {
  const { data } = await client.get('/payment-methods');
  return data.accounts;
}

// 2. Create Deposit
export async function createDeposit(orderId: string, amountKs: number, accountId: string) {
  const { data } = await client.post('/deposits', {
    account_id: accountId,
    amount_ks: amountKs,
    external_ref: orderId,
    callback_url: 'https://your-domain.com/api/payment-webhook',
  });
  return data;
}

// 3. Verify Payment with Last 5 Digits
export async function verifyPayment(depositId: string, last5Digits: string) {
  try {
    const { data } = await client.post(`/deposits/${depositId}/verify`, {
      last5: last5Digits,
    });
    return { success: data.status === 'paid', deposit: data };
  } catch (err: any) {
    if (err.response?.status === 503) {
      return { success: false, retry: true, message: 'Provider busy, retry in 5s' };
    }
    throw err;
  }
}
```

---

### Python (FastAPI / Requests)

```python
import requests

GATEWAY_URL = "https://pgw.flash-myanmar.com/v1"
API_KEY = "dpk_live_xxxxxxxxxxxxxxxxxxxxxxxx"

HEADERS = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

def create_deposit(order_id: str, amount_ks: int, account_id: str) -> dict:
    url = f"{GATEWAY_URL}/deposits"
    payload = {
        "account_id": account_id,
        "amount_ks": amount_ks,
        "external_ref": order_id,
        "callback_url": "https://your-domain.com/api/webhook"
    }
    resp = requests.post(url, json=payload, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json()

def verify_deposit(deposit_id: str, last5: str) -> dict:
    url = f"{GATEWAY_URL}/deposits/{deposit_id}/verify"
    resp = requests.post(url, json={"last5": last5}, headers=HEADERS, timeout=15)
    if resp.status_code == 503:
        return {"status": "pending", "retry": True}
    resp.raise_for_status()
    return resp.json()
```

---

### PHP (cURL / Laravel)

```php
<?php

class DominateGateway {
    private string $baseUrl = 'https://pgw.flash-myanmar.com/v1';
    private string $apiKey;

    public function __construct(string $apiKey) {
        $this->apiKey = $apiKey;
    }

    private function request(string $method, string $path, array $data = []): array {
        $ch = curl_init("{$this->baseUrl}{$path}");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'X-API-Key: ' . $this->apiKey,
            'Content-Type: application/json'
        ]);
        if (!empty($data)) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }
        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ['status' => $code, 'data' => json_decode($res, true)];
    }

    public function createDeposit(string $accountId, int $amountKs, string $orderId): array {
        return $this->request('POST', '/deposits', [
            'account_id' => $accountId,
            'amount_ks' => $amountKs,
            'external_ref' => $orderId
        ]);
    }

    public function verifyDeposit(string $depositId, string $last5): array {
        return $this->request('POST', "/deposits/{$depositId}/verify", [
            'last5' => $last5
        ]);
    }
}
```

---

## 7. Status Reference & Error Codes

### Deposit Statuses:
| Status | Description |
| :--- | :--- |
| `pending` | Order created; waiting for user payment / verification |
| `paid` | Successfully verified against bank/wallet records |
| `expired` | TTL reached (15 minutes) without matching payment |

### HTTP Status Codes:
| Code | Meaning |
| :--- | :--- |
| `200 OK` | Request succeeded |
| `400 Bad Request` | Invalid parameters (e.g. `last5` not 5 digits, negative amount) |
| `401 Unauthorized` | Missing or invalid `X-API-Key` |
| `403 Forbidden` | Account not assigned or disabled for your project |
| `404 Not Found` | Deposit or withdrawal ID not found |
| `503 Unavailable` | Wallet provider busy / rate-limited (retry allowed) |
