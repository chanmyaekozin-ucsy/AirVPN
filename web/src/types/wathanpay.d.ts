export {};

declare global {
  interface Window {
    WathanPay?: {
      accessToken?: string;
      close?: () => void;
      pay?: (input: {
        orderId: string;
        amountKs: number;
        title?: string;
        subtitle?: string;
      }) => Promise<{ ok?: boolean; txid?: string; message?: string }>;
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
