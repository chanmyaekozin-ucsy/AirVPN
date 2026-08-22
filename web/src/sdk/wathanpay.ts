/**
 * WathanPay Mini App Client SDK
 * Official client helper for accepting in-app payments on the WathanPay platform.
 * See SDK_INTEGRATION.md for reference.
 */

import type {
  MiniAppUser,
  WathanPayPayParams,
  WathanPayPayResult,
  WathanPaySDK,
} from "@/types/wathanpay";

export type { MiniAppUser, WathanPayPayParams, WathanPayPayResult, WathanPaySDK };
export type PayParams = WathanPayPayParams;
export type PayResult = WathanPayPayResult;

export const WathanPay: WathanPaySDK = {
  get ready() {
    if (typeof window === "undefined") return false;
    return Boolean(window.WathanPay?.ready);
  },

  get authData(): string {
    if (typeof window === "undefined") return "";
    return (
      window.WathanPay?.authData ||
      (typeof window.WathanPay?.getAuthData === "function"
        ? window.WathanPay.getAuthData()
        : "") ||
      ""
    );
  },

  getAuthData(): string {
    return this.authData || "";
  },

  get user(): MiniAppUser | null {
    if (typeof window === "undefined") return null;
    return (
      window.WathanPay?.user ||
      (typeof window.WathanPay?.getUser === "function"
        ? window.WathanPay.getUser()
        : null) ||
      null
    );
  },

  getUser(): MiniAppUser | null {
    return this.user ?? null;
  },

  get accessToken() {
    if (typeof window === "undefined") return undefined;
    return window.WathanPay?.accessToken;
  },

  /**
   * Opens the native WathanPay PIN and biometric slide-up sheet.
   */
  async pay(params: WathanPayPayParams): Promise<WathanPayPayResult> {
    if (typeof window === "undefined") {
      return { ok: false, error: "Window is not defined", message: "Window is not defined" };
    }

    if (!window.WathanPay?.pay) {
      return {
        ok: false,
        error:
          "WathanPay SDK is not available. Please open inside the WathanPay mobile app or ensure sdk.js is loaded.",
        message:
          "WathanPay SDK is not available. Please open inside the WathanPay mobile app or ensure sdk.js is loaded.",
      };
    }

    try {
      const normalizedParams: WathanPayPayParams = {
        orderId: params.orderId,
        amount: params.amount ?? params.amountKs ?? 0,
        amountKs: params.amountKs ?? params.amount ?? 0,
        title: params.title,
        subtitle: params.subtitle,
        requestId: params.requestId,
      };

      const result = await window.WathanPay.pay(normalizedParams);

      if (result && result.ok) {
        return {
          ok: true,
          txid: String(result.txid || ""),
          requestId: result.requestId || params.requestId,
        };
      }

      return {
        ok: false,
        txid: result?.txid,
        error: result?.error || result?.message || "Payment cancelled or rejected.",
        message: result?.message || result?.error || "Payment cancelled or rejected.",
        requestId: result?.requestId || params.requestId,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Payment request failed.";
      return {
        ok: false,
        error: errorMsg,
        message: errorMsg,
        requestId: params.requestId,
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

  /**
   * Toggles immersive fullscreen mode.
   */
  setFullScreen(enabled: boolean): void {
    if (typeof window !== "undefined" && typeof window.WathanPay?.setFullScreen === "function") {
      window.WathanPay.setFullScreen(enabled);
    }
  },

  /**
   * Sets viewport orientation for games / media.
   */
  setOrientation(mode: "portrait" | "landscape" | "auto"): void {
    if (typeof window !== "undefined" && typeof window.WathanPay?.setOrientation === "function") {
      window.WathanPay.setOrientation(mode);
    }
  },

  /**
   * Switches app orientation to landscape mode.
   */
  requestLandscape(): void {
    if (typeof window !== "undefined" && typeof window.WathanPay?.requestLandscape === "function") {
      window.WathanPay.requestLandscape();
    }
  },

  /**
   * Switches app orientation to portrait mode.
   */
  requestPortrait(): void {
    if (typeof window !== "undefined" && typeof window.WathanPay?.requestPortrait === "function") {
      window.WathanPay.requestPortrait();
    }
  },
};
