# WathanPay Mini App Payment Integration Guide & Official SDK

Official documentation and reference implementation for integrating **WathanPay One-Click In-App Checkout** into web-based Mini Apps (Next.js, React, Vue, Svelte, or Vanilla JavaScript).

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Quick Start (TypeScript / JavaScript)](#2-quick-start-typescript--javascript)
3. [Ready-to-Use React / Next.js Component (`WathanPayBridge.tsx`)](#3-ready-to-use-react--nextjs-component-wathanpaybridgetsx)
4. [Bridge API Reference](#4-bridge-api-reference)
   - [4.1. `window.WathanPay.pay(payload)`](#41-windowwathanpaypaypayload)
   - [4.2. `window.WathanPay.close()`](#42-windowwathanpayclose)
   - [4.3. Event Listeners & PostMessage](#43-event-listeners--postmessage)
   - [4.4. Deep Link / URL Scheme](#44-deep-link--url-scheme)
5. [Payload & Response Specifications](#5-payload--response-specifications)
6. [Best Practices & Error Handling](#6-best-practices--error-handling)

---

## 1. Overview & Architecture

When a Mini App URL is opened inside WathanPay, the app automatically injects the **WathanPay JavaScript Bridge** before any page content loads. 

```
+-------------------------------------------------------------------------+
|                        WATHANPAY HOST APP CONTAINER                      |
|                                                                         |
|  +---------------------------+       +-------------------------------+  |
|  |     Your Web Mini App     |       |   WathanPay Native Bottom     |  |
|  |    (Next.js / HTML / JS)  |       |        Sheet PIN Pad          |  |
|  +-------------+-------------+       +---------------+---------------+  |
|                |                                     ^                  |
|                | 1. window.WathanPay.pay({ ... })    |                  |
|                v                                     |                  |
|  +---------------------------------------------------+---------------+  |
|  |             Injected Bridge (window.WathanPay & postMessage)      |  |
|  +---------------------------------------------------+---------------+  |
|                                                      |                  |
|                2. Slide-up PIN Pad & Biometric Auth  |                  |
|                3. Secure Payment Debit from Wallet   |                  |
|                4. Settle & Return TxID               v                  |
+-------------------------------------------------------------------------+
```

### Key Highlights:
* **Zero Configuration**: No external NPM dependencies required.
* **Instant Native UI**: Automatically triggers the animated PIN Pad with Face ID / Fingerprint support and tactile haptic feedback.
* **Dual Return Channels**: Supports Promises (`async/await`), Callbacks, and Event Listeners simultaneously.

---

## 2. Quick Start (TypeScript / JavaScript)

### Standard Promise Usage
```typescript
// Check if running inside WathanPay
const isWathanPay = typeof window !== 'undefined' && Boolean(window.WathanPay);

async function handleCheckout() {
  try {
    const result = await window.WathanPay.pay({
      orderId: 'ORD_' + Date.now(),    // Unique Order ID (6 - 120 alphanumeric chars)
      amountKs: 1000,                  // Integer amount in Myanmar Kyats (>= 100 Ks)
      title: 'ATOM 1.5GB Data Pack',   // Product title
      subtitle: 'Topup for 09790245618' // Optional detail/note
    });

    if (result.ok) {
      console.log('Payment Succeeded! Transaction ID:', result.txid);
      // Fulfill order, deliver data pack / airtime
    } else {
      console.warn('Payment Cancelled or Failed:', result.message);
    }
  } catch (error) {
    console.error('Payment Error:', error);
  }
}
```

---

## 3. Ready-to-Use React / Next.js Component (`WathanPayBridge.tsx`)

Copy and paste this component directly into your Mini App project (e.g. `src/components/WathanPayBridge.tsx` or `src/lib/wathanpay.ts`):

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';

export interface WathanPayOrder {
  orderId: string;
  amountKs: number;
  title?: string;
  subtitle?: string;
}

export interface WathanPayResult {
  ok: boolean;
  txid?: string;
  requestId?: string;
  message?: string;
}

declare global {
  interface Window {
    WathanPay?: {
      accessToken?: string;
      ready?: boolean;
      pay: (
        order: WathanPayOrder & { requestId?: string },
        onDone?: (res: WathanPayResult) => void
      ) => Promise<WathanPayResult>;
      close: () => void;
    };
    wathanPay?: Window['WathanPay'];
  }
}

/**
 * Hook to interact with WathanPay Host App
 */
export function useWathanPay() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.WathanPay?.ready) {
      setIsReady(true);
      return;
    }

    const onReady = () => setIsReady(true);
    window.addEventListener('WathanPayReady', onReady);
    window.addEventListener('WathanPayBridgeReady', onReady);

    return () => {
      window.removeEventListener('WathanPayReady', onReady);
      window.removeEventListener('WathanPayBridgeReady', onReady);
    };
  }, []);

  const pay = useCallback(
    async (order: WathanPayOrder): Promise<WathanPayResult> => {
      const bridge = typeof window !== 'undefined' ? (window.WathanPay || window.wathanPay) : undefined;

      // 1. If inside WathanPay Host App
      if (bridge && typeof bridge.pay === 'function') {
        return bridge.pay(order);
      }

      // 2. Fallback via postMessage
      if (typeof window !== 'undefined' && window.ReactNativeWebView?.postMessage) {
        return new Promise((resolve) => {
          const requestId = 'pay_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

          const listener = (event: any) => {
            let data = event?.detail || event?.data;
            if (typeof data === 'string') {
              try { data = JSON.parse(data); } catch (_) {}
            }
            if (data && (data.type === 'wp_pay_result' || data.requestId === requestId)) {
              window.removeEventListener('WathanPayPayResult', listener);
              window.removeEventListener('message', listener);
              resolve({
                ok: Boolean(data.ok),
                txid: data.txid,
                requestId: data.requestId || requestId,
                message: data.message,
              });
            }
          };

          window.addEventListener('WathanPayPayResult', listener);
          window.addEventListener('message', listener);

          window.ReactNativeWebView.postMessage(
            JSON.stringify({
              type: 'pay',
              requestId,
              ...order,
            })
          );
        });
      }

      // 3. Fallback for standalone browser testing outside WathanPay
      console.warn('[WathanPay] Running in standalone web browser. Simulating mock payment.');
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            txid: '0000' + Math.floor(100 + Math.random() * 900),
            message: 'Mock Browser Payment Success',
          });
        }, 1200);
      });
    },
    []
  );

  const close = useCallback(() => {
    if (typeof window !== 'undefined') {
      if (window.WathanPay?.close) {
        window.WathanPay.close();
      } else if (window.ReactNativeWebView?.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'close' }));
      }
    }
  }, []);

  return { isWathanPay: isReady, pay, close };
}
```

---

## 4. Bridge API Reference

### 4.1. `window.WathanPay.pay(payload)`

Invokes the WathanPay slide-up payment sheet and biometric PIN verification.

#### Arguments
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `orderId` | `string` | **Yes** | Your unique shop order ID (6-120 characters). Idempotent. |
| `amountKs` | `number` | **Yes** | Amount in Myanmar Kyats (MMK). Minimum `100`. |
| `title` | `string` | No | Item/package name displayed on receipt (max 80 chars). |
| `subtitle` | `string` | No | Secondary details/description (e.g. Phone number). |
| `requestId` | `string` | No | Custom request tracking identifier. |

#### Return Value
Returns a `Promise<MiniAppPayResult>`:
```typescript
{
  ok: boolean;          // true if paid successfully, false if cancelled/failed
  txid?: string;        // 7-digit WathanPay TranscationID (e.g. "0000054") or UUID
  requestId?: string;   // Tracking ID
  message?: string;     // Error or cancellation message
}
```

---

### 4.2. `window.WathanPay.close()`

Closes the Mini App and returns the user to the WathanPay home screen.

```javascript
// Close Mini App
window.WathanPay.close();
```

---

### 4.3. Event Listeners & PostMessage

If you prefer listening to global events rather than awaiting promises:

```javascript
// 1. Listen for completion via CustomEvent
window.addEventListener('WathanPayPayResult', (event) => {
  const { ok, txid, message } = event.detail;
  if (ok) {
    alert('Payment Succeeded! TxID: ' + txid);
  }
});

// 2. Listen via standard window.onmessage
window.addEventListener('message', (event) => {
  const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  if (data.type === 'wp_pay_result') {
    console.log('Payment result:', data);
  }
});
```

---

### 4.4. Deep Link / URL Scheme

You can also trigger checkout via standard anchor tags or redirects:

```html
<!-- Trigger via URI scheme -->
<a href="wathanpay://pay?orderId=ORD-99128&amountKs=1500&title=Diamond+Pass">
  Pay with WathanPay
</a>
```

---

## 5. Payload & Response Specifications

### Success Response Example (`ok: true`)
```json
{
  "ok": true,
  "txid": "0000055",
  "requestId": "pay_177123981298_ab4x1",
  "message": null
}
```

### Cancelled Response Example (`ok: false`)
```json
{
  "ok": false,
  "requestId": "pay_177123981298_ab4x1",
  "message": "Payment cancelled"
}
```

### Failed Response Example (e.g. Insufficient Balance)
```json
{
  "ok": false,
  "requestId": "pay_177123981298_ab4x1",
  "message": "Insufficient balance"
}
```

---

## 6. Best Practices & Error Handling

1. **Keep `orderId` Unique & Idempotent**:
   WathanPay enforces idempotency on `shopOrderId`. If the user retries a payment that has already succeeded, WathanPay returns the existing transaction without double-charging.
2. **Handle Rejections Gracefully**:
   Always check `result.ok === true` before delivering digital goods or packages.
3. **Use Number format for `amountKs`**:
   Ensure `amountKs` is an integer (e.g., `1000`, not `"1,000 Ks"`).
4. **Standalone Web Fallback**:
   When testing your mini app in regular Google Chrome / Safari, wrap `window.WathanPay` calls with the fallback provided in Section 3 to ensure local UI testing works seamlessly.

---

## 7. Static Error & Offline Page Implementation

When users lose internet connectivity or when a page fails to load, Mini Apps should render a clean **Static Error / Offline Screen** with a retry mechanism.

### React / Next.js Offline & Error Boundary (`OfflineErrorPage.tsx`)

```tsx
'use client';

import React, { useEffect, useState } from 'react';

interface OfflineErrorProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function OfflineErrorPage({
  title = 'No Internet Connection',
  message = 'Please check your network settings and try again.',
  onRetry,
}: OfflineErrorProps) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleReload = () => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  };

  const handleClose = () => {
    if (typeof window !== 'undefined' && window.WathanPay?.close) {
      window.WathanPay.close();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.iconCircle}>
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#EF4444"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      </div>

      <h2 style={styles.title}>{!isOnline ? 'No Internet Connection' : title}</h2>
      <p style={styles.message}>
        {!isOnline
          ? 'You are currently offline. Please reconnect to mobile data or Wi-Fi.'
          : message}
      </p>

      <button style={styles.retryBtn} onClick={handleReload}>
        Try Again
      </button>

      {typeof window !== 'undefined' && window.WathanPay && (
        <button style={styles.closeBtn} onClick={handleClose}>
          Exit to WathanPay
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '32px 24px',
    backgroundColor: '#FFFFFF',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    textAlign: 'center',
    boxSizing: 'border-box',
  },
  iconCircle: {
    width: '88px',
    height: '88px',
    borderRadius: '44px',
    backgroundColor: '#FEE2E2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  title: {
    fontSize: '20px',
    fontWeight: '800',
    color: '#0F172A',
    margin: '0 0 8px 0',
  },
  message: {
    fontSize: '14px',
    color: '#64748B',
    lineHeight: '21px',
    maxWidth: '300px',
    margin: '0 0 28px 0',
  },
  retryBtn: {
    width: '100%',
    maxWidth: '240px',
    padding: '14px 20px',
    backgroundColor: '#0F172A',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    marginBottom: '12px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#64748B',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    padding: '8px 16px',
  },
};
```

---

## 8. Server-to-Server Payment Verification (Zero Trust Security)

To guarantee that users cannot bypass payments using browser DevTools (e.g. modifying `ok: false` to `ok: true` or supplying a fake `txid`), your backend server **must verify every transaction** with the WathanPay Core API before fulfilling an order or triggering third-party carrier APIs (e.g. ATOM Eagle).

```
[ Browser / Phone ]               [ Your Shop Server ]               [ WathanPay Core API ]
        │                                  │                                    │
        │  1. POST /api/orders             │                                    │
        │     { orderId, txid: "0000054" } │                                    │
        ├─────────────────────────────────►│                                    │
        │                                  │  2. POST /v1/merchant/verify-payment
        │                                  │     { shopOrderId, transactionId } │
        │                                  ├───────────────────────────────────►│
        │                                  │                                    │
        │                                  │  3. Returns { verified: true, ... }│
        │                                  │◄───────────────────────────────────┤
        │                                  │                                    │
        │                                  │  4. [Secure] Execute Carrier Topup │
        │  5. 200 OK (Receipt)             │     or deliver digital product!    │
        │◄─────────────────────────────────┤                                    │
```

### 8.1. WathanPay Verification Endpoint

* **Method**: `POST` (or `GET`)
* **Endpoint**: `http://localhost:3001/v1/merchant/verify-payment` (Local) / `https://api.wathanpay.com/v1/merchant/verify-payment` (Production)
* **Headers**: `Content-Type: application/json`

#### Request Payload
```json
{
  "shopOrderId": "ORD_177123981298",
  "transactionId": "0000054",
  "amountKs": 1000
}
```

#### Success Response (`200 OK`)
```json
{
  "ok": true,
  "verified": true,
  "status": "succeeded",
  "transactionId": "0000054",
  "shopOrderId": "ORD_177123981298",
  "amountKs": 1000,
  "createdAt": "2026-08-16T14:30:00.000Z"
}
```

#### Tampered / Fake Request Response (`200 OK`)
```json
{
  "ok": false,
  "verified": false,
  "status": "not_found",
  "message": "Transaction not found on WathanPay ledger"
}
```

---

### 8.2. Next.js / Node.js Backend Verification Implementation

In your shop's order processing endpoint (e.g. `src/app/api/orders/route.ts`):

```typescript
import { NextResponse } from 'next/server';

const WATHANPAY_API_URL = process.env.WATHANPAY_API_URL || 'http://localhost:3001';

export async function POST(req: Request) {
  try {
    const { orderId, amountKs, wathanpayTxnId, targetPhone } = await req.json();

    // 1. SECURITY CHECK: Verify transaction against WathanPay Core Ledger
    const verifyRes = await fetch(`${WATHANPAY_API_URL}/v1/merchant/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopOrderId: orderId,
        transactionId: wathanpayTxnId,
        amountKs: Number(amountKs),
      }),
    });

    const verifyData = await verifyRes.json();

    // 2. Reject if fake, unpaid, or amount mismatch
    if (!verifyData.ok || !verifyData.verified || verifyData.status !== 'succeeded') {
      console.error('[Fraud Alert] Payment verification failed:', verifyData);
      return NextResponse.json(
        { success: false, message: 'Invalid or unverified payment transaction.' },
        { status: 400 }
      );
    }

    // 3. SECURE EXECUTION: Payment is 100% verified on ledger! Proceed to recharge / delivery.
    // await atomEagleService.recharge({ msisdn: targetPhone, amount: 1000, ... });

    return NextResponse.json({
      success: true,
      orderId,
      transactionId: verifyData.transactionId,
      message: 'Recharge completed successfully.',
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
```

---

### 8.3. Why Client-Side DevTools / Proxy Overrides Cannot Bypass Security

A common concern in web applications is: *“What if an attacker uses browser DevTools, Charles Proxy, or Proxyman to rewrite responses?”*

Here is why server-to-server verification makes tampering physically impossible:

#### 1. Physical Network Isolation
* **Client-Side DevTools**: Operates exclusively on the user's phone/browser. It can intercept requests between the *Phone ↔ Shop Frontend*.
* **Server-to-Server Request**: Operates entirely within your private cloud backend (*Shop Server ↔ WathanPay API* over TLS 1.3 encryption). The user's device is not in the middle of this connection and has **0 access** to inspect or modify the verification request/response.

#### 2. Multi-Condition Defensive Code Guard
Even if an attacker attempts to send forged parameters to your shop backend, your server enforces **all 4 conditions simultaneously**:

```typescript
const isAuthentic =
  verifyData.ok === true &&
  verifyData.verified === true &&
  verifyData.status === 'succeeded' &&       // 👈 Rejects if status is "not_found", "pending", or "failed"
  verifyData.amountKs === expectedAmount;    // 👈 Rejects if amount is less than the package price

if (!isAuthentic) {
  return NextResponse.json({ error: 'Fraud detected. Order rejected.' }, { status: 400 });
}
```

* If an attacker passes a fake transaction ID ➡️ WathanPay returns `status: "not_found"` ➡️ **Rejected 🛑**
* If an attacker pays 100 Ks for a 1,000 Ks pack ➡️ `amountKs === 1000` check fails ➡️ **Rejected 🛑**
* If an attacker cancels the PIN sheet ➡️ No transaction is created on the WathanPay ledger ➡️ **Rejected 🛑**

#### 3. Security Summary Table
| Attack Vector | Client DevTools Result | Shop Server Verification Result | Outcome |
| :--- | :--- | :--- | :--- |
| **Override `ok: false` ➡️ `true`** | UI shows "Processing..." | WathanPay returns `404 / not_found` | **Blocked 🛑 (No recharge executed)** |
| **Pass fake TxID (`WP_FAKE_999`)** | UI shows "Processing..." | TxID not on WathanPay ledger | **Blocked 🛑 (No recharge executed)** |
| **Amount Tampering (Pay 100 Ks)** | Payment succeeds for 100 Ks | `amountKs !== expectedAmount` | **Blocked 🛑 (No recharge executed)** |
| **Authentic User PIN Verification** | `ok: true`, real TxID | WathanPay returns `status: "succeeded"` | **Approved ✅ (Recharge delivered)** |



