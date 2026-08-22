/**
 * WathanPay wallet charge and server-to-server ledger verification.
 * See SDK_INTEGRATION.md for reference.
 */

import crypto from "crypto";
import type { MiniAppUser } from "@/types/wathanpay";

export interface VerifyAuthResult {
  ok: boolean;
  error?: string;
  user?: MiniAppUser;
}

/**
 * 🛡️ Cryptographic Anti-Spoofing User Authentication (HMAC-SHA256).
 * Validates the authData string generated natively by WathanPay using your Merchant Secret Key.
 *
 * Algorithm:
 * 1. Parse the query string into key-value pairs.
 * 2. Extract received `hash` parameter and remove it.
 * 3. Sort remaining keys alphabetically.
 * 4. Build `key=value` string separated by newline `\n`.
 * 5. Compute HMAC-SHA256 with WATHANPAY_MERCHANT_SECRET (or WATHANPAY_API_KEY).
 * 6. Timing-safe comparison against received hash.
 * 7. Validate `auth_date` timestamp within maxAgeSeconds (replay protection).
 */
export function verifyWathanPayAuth(
  authDataString: string,
  maxAgeSeconds: number = 86400,
  secret?: string,
): VerifyAuthResult {
  const merchantSecret =
    secret ||
    process.env.WATHANPAY_MERCHANT_SECRET ||
    process.env.WATHANPAY_API_KEY ||
    "";

  if (!authDataString || typeof authDataString !== "string") {
    return { ok: false, error: "Missing authData" };
  }

  // Development fallback when no merchant secret is configured in local dev
  if (!merchantSecret && process.env.NODE_ENV !== "production") {
    const params = new URLSearchParams(authDataString);
    const phone = params.get("phone") || params.get("maskedPhone") || undefined;
    const id = params.get("id") || params.get("userId") || undefined;
    const name = params.get("name") || params.get("username") || undefined;
    return {
      ok: true,
      user: {
        id,
        name,
        phone,
        maskedPhone: phone,
        avatarUrl: params.get("avatarUrl") || null,
      },
    };
  }

  if (!merchantSecret) {
    throw new Error("WATHANPAY_MERCHANT_SECRET is not configured");
  }

  const params = new URLSearchParams(authDataString);
  const receivedHash = params.get("hash");
  if (!receivedHash) {
    return { ok: false, error: "Missing signature hash" };
  }

  params.delete("hash");

  // 1. Sort keys alphabetically
  const sortedKeys = Array.from(params.keys()).sort();
  const dataCheckString = sortedKeys.map((k) => `${k}=${params.get(k)}`).join("\n");

  // 2. Calculate HMAC-SHA256 using Merchant Secret
  const calculatedHash = crypto
    .createHmac("sha256", merchantSecret)
    .update(dataCheckString)
    .digest("hex");

  // 3. Constant-time comparison
  const calcBuf = Buffer.from(calculatedHash.toLowerCase());
  const recvBuf = Buffer.from(receivedHash.toLowerCase());
  const isMatch =
    calcBuf.length === recvBuf.length && crypto.timingSafeEqual(calcBuf, recvBuf);

  if (!isMatch) {
    return { ok: false, error: "Invalid cryptographic signature" };
  }

  // 4. Replay attack protection (timestamp check)
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - authDate) > maxAgeSeconds) {
    return { ok: false, error: "Auth data expired" };
  }

  const phone = params.get("phone") || params.get("maskedPhone") || undefined;

  return {
    ok: true,
    user: {
      id: params.get("id") || params.get("userId") || undefined,
      name: params.get("name") || params.get("username") || undefined,
      phone,
      maskedPhone: phone,
      avatarUrl: params.get("avatarUrl") || null,
    },
  };
}

export type ChargeInput = {
  accessToken?: string;
  amountKs: number;
  orderId: string;
  last5: string;
};

export type ChargeResult = {
  ok: boolean;
  txid: string;
  message: string;
};

export async function chargeWathanPay(input: ChargeInput): Promise<ChargeResult | null> {
  const base = (process.env.WATHANPAY_API_URL || "").replace(/\/$/, "");
  if (!base || !input.accessToken) return null;

  const res = await fetch(`${base}/v1/mini-apps/charge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amountKs: input.amountKs,
      orderId: input.orderId,
      last5: input.last5,
      merchant: "airvpn",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    txid?: string;
    id?: string;
    message?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    return {
      ok: false,
      txid: "",
      message: body.error?.message || body.message || "WathanPay payment failed",
    };
  }
  return {
    ok: body.ok !== false,
    txid: String(body.txid || body.id || ""),
    message: body.message || "Paid with WathanPay",
  };
}

export type VerifyPaymentInput = {
  shopOrderId: string;
  transactionId?: string;
  amountKs?: number;
};

export type VerifyPaymentResult = {
  ok: boolean;
  verified: boolean;
  status: "succeeded" | "pending" | "failed" | "not_found" | string;
  transactionId?: string;
  shopOrderId?: string;
  amountKs?: number;
  paidAt?: string;
  message?: string;
};

/**
 * Server-to-Server Zero-Trust Payment Verification.
 * Official endpoint: GET https://api.wathanpay.com/v1/merchant/verify-payment?shopOrderId={shopOrderId}
 * Header: X-API-Key: {process.env.WATHANPAY_MERCHANT_SECRET || process.env.WATHANPAY_API_KEY}
 */
export async function verifyWathanPayPayment(
  input: VerifyPaymentInput,
): Promise<VerifyPaymentResult> {
  const base = (process.env.WATHANPAY_API_URL || "https://api.wathanpay.com").replace(/\/$/, "");
  const apiKey =
    process.env.WATHANPAY_MERCHANT_SECRET || process.env.WATHANPAY_API_KEY || "";

  // Mock / offline fallback when running in development without live WathanPay API
  if (!process.env.WATHANPAY_API_URL && !apiKey && process.env.NODE_ENV !== "production") {
    return {
      ok: true,
      verified: true,
      status: "succeeded",
      transactionId: input.transactionId || "0000001",
      shopOrderId: input.shopOrderId,
      amountKs: input.amountKs,
      paidAt: new Date().toISOString(),
    };
  }

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }

    // Try official merchant verification endpoint first
    let url = `${base}/v1/merchant/verify-payment?shopOrderId=${encodeURIComponent(input.shopOrderId)}`;
    if (input.transactionId) {
      url += `&transactionId=${encodeURIComponent(input.transactionId)}`;
    }
    if (typeof input.amountKs === "number") {
      url += `&amountKs=${encodeURIComponent(input.amountKs)}`;
    }

    let res = await fetch(url, {
      method: "GET",
      headers,
    });

    // Fallback to legacy endpoint if 404
    if (res.status === 404) {
      const fallbackUrl = `${base}/v1/mini-apps/verify-payment?shopOrderId=${encodeURIComponent(input.shopOrderId)}`;
      const fallbackRes = await fetch(fallbackUrl, {
        method: "GET",
        headers,
      });
      if (fallbackRes.ok) {
        res = fallbackRes;
      }
    }

    const data = (await res.json().catch(() => ({}))) as Partial<VerifyPaymentResult> & {
      error?: string | { message?: string };
      message?: string;
    };

    if (!res.ok) {
      const errText =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || data.message || `WathanPay verification returned HTTP ${res.status}`;
      return {
        ok: false,
        verified: false,
        status: data.status || "failed",
        message: errText,
      };
    }

    const isVerified = Boolean(data.verified || (data.ok && data.status === "succeeded"));

    return {
      ok: Boolean(data.ok),
      verified: isVerified,
      status: data.status || (isVerified ? "succeeded" : "not_found"),
      transactionId: data.transactionId || input.transactionId,
      shopOrderId: data.shopOrderId || input.shopOrderId,
      amountKs: typeof data.amountKs === "number" ? data.amountKs : input.amountKs,
      paidAt: data.paidAt,
      message: data.message,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      verified: false,
      status: "failed",
      message: err instanceof Error ? err.message : "Failed to reach WathanPay verification service",
    };
  }
}
