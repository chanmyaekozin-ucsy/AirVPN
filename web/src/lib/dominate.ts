import { dominateConfig } from "./shop-env";

const UA = "AirVPN-PGW/1.0 (Macintosh; Intel Mac OS X 10_15_7)";

export type GatewayMethod = {
  id: string;
  method: string;
  provider: string;
  accountNumber: string;
  accountName: string;
};

export type GatewayPayee = {
  msisdn?: string;
  display_name?: string;
};

export type GatewayDeposit = {
  id: string;
  status: string;
  account_id?: string;
  provider?: string;
  amount_ks?: number;
  external_ref?: string;
  project_id?: string;
  created_at?: number;
  expires_at?: number;
  payee?: GatewayPayee;
  qr_payload?: string | null;
  qr_png_base64?: string | null;
  matched_order_id?: string | null;
  bank_trx_id?: string | null;
  trx_id?: string | null;
  paid_at?: number | null;
  verify_reason?: string | null;
  submitted_last5?: string | null;
  retry?: boolean;
  error?: string | null;
};

function configured() {
  const { key } = dominateConfig();
  return Boolean(key);
}

export function normalizePaymentMethod(methodOrProvider: string): "KBZPay" | "WavePay" | null {
  const val = String(methodOrProvider || "").toLowerCase().replace(/[\s\-_]/g, "");
  if (val.includes("kbz") || val.includes("kpay")) return "KBZPay";
  if (val.includes("wave")) return "WavePay";
  return null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, key } = dominateConfig();
  if (!key) {
    throw Object.assign(new Error("Dominate payment gateway API key is not configured."), { status: 503 });
  }

  // Normalize path so it always appends cleanly to base `/v1` URL
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const normalizedPath = cleanPath.startsWith("/v1/") ? cleanPath.slice(3) : cleanPath;
  const endpoint = `${url}${normalizedPath}`;

  const res = await fetch(endpoint, {
    ...init,
    headers: {
      "X-API-Key": key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as T & {
    detail?: string;
    message?: string;
    error?: string;
  };

  if (!res.ok) {
    const errorObj = Object.assign(
      new Error(body.detail || body.message || body.error || `Gateway HTTP ${res.status}`),
      {
        status: res.status,
        body,
      },
    );
    throw errorObj;
  }
  return body;
}

export function gatewayConfigured() {
  return configured();
}

/**
 * 1. List Available Payment Methods
 * GET /v1/payment-methods
 */
export async function listPaymentMethods(): Promise<GatewayMethod[]> {
  if (!configured()) return [];
  try {
    const data = await request<{ accounts?: Array<Record<string, unknown>> }>("/payment-methods");
    const out: GatewayMethod[] = [];

    for (const acct of data.accounts || []) {
      const rawMethod = String(acct.method || "");
      const rawProvider = String(acct.provider || "");
      const normalized = normalizePaymentMethod(rawMethod) || normalizePaymentMethod(rawProvider);
      if (!normalized) continue;

      const id = String(acct.id || "").trim();
      const msisdn = String(acct.msisdn || acct.account_number || "").trim();
      const displayName = String(acct.display_name || acct.account_name || "").trim();

      if (id) {
        out.push({
          id,
          method: normalized,
          provider: rawProvider || (normalized === "KBZPay" ? "kbz" : "wave"),
          accountNumber: msisdn,
          accountName: displayName || normalized,
        });
      }
    }
    return out;
  } catch (err) {
    console.error("[Dominate Gateway] listPaymentMethods failed:", err);
    return [];
  }
}

/**
 * 2. Create Deposit Order
 * POST /v1/deposits
 */
export function createDeposit(input: {
  accountId: string;
  amountKs: number;
  orderId: string;
  callbackUrl?: string;
}) {
  const payload: Record<string, unknown> = {
    account_id: input.accountId,
    amount_ks: input.amountKs,
    external_ref: input.orderId,
  };
  if (input.callbackUrl) {
    payload.callback_url = input.callbackUrl;
  }

  return request<GatewayDeposit>("/deposits", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * 3. Verify Deposit with Last 5 Digits
 * POST /v1/deposits/{deposit_id}/verify
 * Handles 503 Provider Unavailable gracefully
 */
export async function verifyDepositLast5(depositId: string, last5: string): Promise<GatewayDeposit> {
  try {
    return await request<GatewayDeposit>(`/deposits/${encodeURIComponent(depositId)}/verify`, {
      method: "POST",
      body: JSON.stringify({ last5 }),
    });
  } catch (err: unknown) {
    const errorStatus = (err as { status?: number })?.status;
    // 503 Service Unavailable: Provider session refreshing / rate-limited
    if (errorStatus === 503 || errorStatus === 429) {
      return {
        id: depositId,
        status: "pending",
        retry: true,
        verify_reason: "provider_busy",
        submitted_last5: last5,
        error: "Provider busy or rate-limited. Please retry in a few seconds.",
      };
    }
    throw err;
  }
}

/**
 * 4. Get Deposit Order Status (Polling)
 * GET /v1/deposits/{deposit_id}
 */
export function getDeposit(depositId: string): Promise<GatewayDeposit> {
  return request<GatewayDeposit>(`/deposits/${encodeURIComponent(depositId)}`);
}

/**
 * Helpers for checking transaction outcome statuses
 */
export function paidStatus(status?: string | null) {
  if (!status) return false;
  return ["paid", "succeeded", "success", "completed"].includes(status.toLowerCase());
}

export function failedStatus(status?: string | null) {
  if (!status) return false;
  return ["failed", "expired", "cancelled", "canceled", "rejected"].includes(status.toLowerCase());
}

export function pendingStatus(status?: string | null) {
  if (!status) return false;
  return ["pending", "processing", "initiated"].includes(status.toLowerCase());
}
