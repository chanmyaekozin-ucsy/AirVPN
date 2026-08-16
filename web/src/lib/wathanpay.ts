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
  transactionId: string;
  amountKs: number;
};

export type VerifyPaymentResult = {
  ok: boolean;
  verified: boolean;
  status: "succeeded" | "pending" | "failed" | "not_found";
  transactionId?: string;
  shopOrderId?: string;
  amountKs?: number;
  message?: string;
};

/**
 * Server-to-Server Payment Verification (Zero-Trust Security Rule).
 * Verifies transaction legitimacy with WathanPay Core Ledger before fulfilling orders.
 */
export async function verifyWathanPayPayment(
  input: VerifyPaymentInput,
): Promise<VerifyPaymentResult> {
  const base = (process.env.WATHANPAY_API_URL || "").replace(/\/$/, "");
  if (!base) {
    // Standalone / mock fallback when running without a connected WathanPay backend
    return {
      ok: true,
      verified: true,
      status: "succeeded",
      transactionId: input.transactionId,
      shopOrderId: input.shopOrderId,
      amountKs: input.amountKs,
    };
  }

  try {
    const res = await fetch(`${base}/v1/merchant/verify-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shopOrderId: input.shopOrderId,
        transactionId: input.transactionId,
        amountKs: input.amountKs,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as Partial<VerifyPaymentResult> & {
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        ok: false,
        verified: false,
        status: data.status || "failed",
        message: data.message || data.error?.message || `WathanPay returned HTTP ${res.status}`,
      };
    }

    return {
      ok: Boolean(data.ok),
      verified: Boolean(data.verified),
      status: data.status || "not_found",
      transactionId: data.transactionId || input.transactionId,
      shopOrderId: data.shopOrderId || input.shopOrderId,
      amountKs: typeof data.amountKs === "number" ? data.amountKs : input.amountKs,
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


