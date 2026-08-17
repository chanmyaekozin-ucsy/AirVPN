/**
 * WathanPay Mini App Client SDK
 * Official client helper for accepting in-app payments on the WathanPay platform.
 * See SDK_INTEGRATION.md for reference.
 */

export interface PayParams {
  /** Your store's unique order reference (e.g. 'ORD_109283') */
  orderId: string;
  /** Amount in Myanmar Kyats (minimum 100 Ks) */
  amount: number;
  /** Legacy alias for amount */
  amountKs?: number;
  /** Short title displayed on customer's confirmation screen */
  title?: string;
  /** Secondary note (e.g. 'Server node / Package') */
  subtitle?: string;
}

export interface PayResult {
  /** True if payment succeeded */
  ok: boolean;
  /** 7-digit Transaction ID (e.g. '0000085') */
  txid?: string;
  /** Error message if payment failed or was cancelled */
  error?: string;
}

export const WathanPay = {
  /**
   * Opens the native WathanPay PIN and biometric slide-up sheet.
   */
  async pay(params: PayParams): Promise<PayResult> {
    const rawAmount = typeof params.amount === "number" ? params.amount : (params.amountKs ?? 0);
    const bridge = typeof window !== "undefined" ? window.WathanPay : undefined;

    if (!bridge || typeof bridge.pay !== "function") {
      return {
        ok: false,
        error: "WathanPay SDK is not available. Please open this store inside the WathanPay mobile app.",
      };
    }

    try {
      const result = await bridge.pay({
        orderId: params.orderId,
        amount: rawAmount,
        amountKs: rawAmount,
        title: params.title,
        subtitle: params.subtitle,
      });

      if (result && result.ok) {
        return {
          ok: true,
          txid: String(result.txid || ""),
        };
      }

      return {
        ok: false,
        error: result?.error || result?.message || "Payment cancelled or rejected.",
      };
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Payment request failed.",
      };
    }
  },

  /**
   * Closes the Mini App WebView and returns the customer back to the WathanPay home screen.
   */
  close(): void {
    if (typeof window !== "undefined" && typeof window.WathanPay?.close === "function") {
      window.WathanPay.close();
    }
  },
};
