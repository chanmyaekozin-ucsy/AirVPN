/**
 * WathanPay wallet charge.
 * When WATHANPAY_API_URL is set, debit the player's WathanPay balance.
 * Until then, AirVPN web uses the local demo wallet.
 */
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
  status: "succeeded" | "pending" | "failed" | "not_found";
  transactionId?: string;
  shopOrderId?: string;
  amountKs?: number;
  paidAt?: string;
  message?: string;
};

/**
 * Server-to-Server Payment Verification (Zero-Trust Security Rule).
 * Official endpoint: GET /v1/mini-apps/verify-payment?shopOrderId={shopOrderId}
 * Header: X-API-Key: {process.env.WATHANPAY_API_KEY}
 */
export async function verifyWathanPayPayment(
  input: VerifyPaymentInput,
): Promise<VerifyPaymentResult> {
  const base = (process.env.WATHANPAY_API_URL || "https://api.wathanpay.com").replace(/\/$/, "");
  const apiKey = process.env.WATHANPAY_API_KEY || "";

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
    const url = `${base}/v1/mini-apps/verify-payment?shopOrderId=${encodeURIComponent(input.shopOrderId)}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
    });

    const data = (await res.json().catch(() => ({}))) as Partial<VerifyPaymentResult> & {
      error?: string | { message?: string };
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

    return {
      ok: Boolean(data.ok),
      verified: Boolean(data.verified),
      status: data.status || (data.ok ? "succeeded" : "not_found"),
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



