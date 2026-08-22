export interface MiniAppUser {
  id?: string;
  name?: string;
  phone?: string;          // Masked format: "09*****9939"
  maskedPhone?: string;    // Masked format: "09*****9939"
  avatarUrl?: string | null;
}

export interface WathanPayPayParams {
  /** Unique Order ID in your system (e.g. ORD_12345) */
  orderId: string;

  /** Payment amount in Myanmar Kyats (>= 100 Ks) */
  amount?: number;

  /** Alias for amount in Myanmar Kyats */
  amountKs?: number;

  /** Product or item name displayed on the payment sheet */
  title?: string;

  /** Optional subtitle, player ID, server name, or item summary */
  subtitle?: string;

  /** Optional tracking request ID */
  requestId?: string;
}

export interface WathanPayPayResult {
  /** True if payment was authorized and settled on WathanPay ledger */
  ok: boolean;

  /** WathanPay 7-digit transaction ID (e.g. "0001048") */
  txid?: string;

  /** Error or cancellation message if ok is false */
  message?: string;

  /** Failure reason or error details */
  error?: string;

  /** Request ID matching the input */
  requestId?: string;
}

export type PayParams = WathanPayPayParams;
export type PayResult = WathanPayPayResult;
export type WathanPayNativePayInput = WathanPayPayParams;
export type WathanPayNativePayResult = WathanPayPayResult;

export interface WathanPaySDK {
  /** true when running inside the WathanPay native container */
  ready?: boolean;

  /** Cryptographically signed HMAC-SHA256 string for zero-trust backend authentication */
  authData?: string;

  /** Helper function returning the authData string */
  getAuthData?: () => string;

  /** Logged-in user safe public profile */
  user?: MiniAppUser | null;

  /** Helper function returning the user profile */
  getUser?: () => MiniAppUser | null;

  /** Legacy / direct accessToken string */
  accessToken?: string;

  /** Opens the native biometric / PIN bottom sheet for payment */
  pay: (
    params: WathanPayPayParams,
    callback?: (result: WathanPayPayResult) => void
  ) => Promise<WathanPayPayResult>;

  /** Closes the Mini App and returns to the WathanPay home screen */
  close?: () => void;

  /** Toggles immersive fullscreen mode */
  setFullScreen?: (enabled: boolean) => void;

  /** Sets viewport orientation for games/media */
  setOrientation?: (mode: "portrait" | "landscape" | "auto") => void;

  /** Switches app orientation to landscape mode */
  requestLandscape?: () => void;

  /** Switches app orientation to portrait mode */
  requestPortrait?: () => void;
}

declare global {
  interface Window {
    WathanPay?: WathanPaySDK;
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: string;
              size?: string;
              width?: string | number;
              text?: string;
              shape?: string;
            },
          ) => void;
          prompt?: () => void;
        };
      };
    };
  }

  interface WindowEventMap {
    WathanPayReady: CustomEvent<{ bridge: WathanPaySDK }>;
    WathanPayBridgeReady: CustomEvent<{ bridge: WathanPaySDK }>;
    "wathanpay:ready": CustomEvent<{ bridge: WathanPaySDK }>;
  }
}
