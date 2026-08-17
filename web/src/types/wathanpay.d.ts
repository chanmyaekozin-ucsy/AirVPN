export {};

export interface WathanPayNativePayInput {
  orderId: string;
  amount?: number;
  amountKs?: number;
  title?: string;
  subtitle?: string;
}

export interface WathanPayNativePayResult {
  ok?: boolean;
  txid?: string;
  error?: string;
  message?: string;
}

declare global {
  interface Window {
    WathanPay?: {
      accessToken?: string;
      close?: () => void;
      pay?: (input: WathanPayNativePayInput) => Promise<WathanPayNativePayResult>;
    };
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
}

