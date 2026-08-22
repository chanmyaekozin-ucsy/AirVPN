"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { MiniAppUser } from "@/types/wathanpay";

export type Me = {
  id: string;
  name: string;
  role: "user" | "admin";
  phone?: string;
  email?: string;
  avatarUrl?: string | null;
  loginMethod?: "email" | "google" | "wathanpay" | "phone";
  telegramId?: string;
  balanceKs: number;
  miniApp?: boolean;
};

const AuthContext = createContext<{
  me: Me | null;
  ready: boolean;
  miniApp: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}>({
  me: null,
  ready: false,
  miniApp: false,
  refresh: async () => undefined,
  logout: async () => undefined,
});

export function useAuth() {
  return useContext(AuthContext);
}

function detectMiniAppSignals(): {
  isMiniApp: boolean;
  authData: string | null;
  user: MiniAppUser | null;
} {
  if (typeof window === "undefined") return { isMiniApp: false, authData: null, user: null };

  const urlParams = new URLSearchParams(window.location.search);
  const authDataFromUrl = urlParams.get("authData") || urlParams.get("auth_data") || null;
  const bridgeAuthData =
    window.WathanPay?.authData ||
    (typeof window.WathanPay?.getAuthData === "function" ? window.WathanPay.getAuthData() : null) ||
    null;
  // Signed authData is the only accepted credential — accessToken/JWT
  // fallbacks removed (server rejects them; WathanPay officially supports authData).
  const authData = bridgeAuthData || authDataFromUrl || null;

  const wpUser =
    window.WathanPay?.user ||
    (typeof window.WathanPay?.getUser === "function" ? window.WathanPay.getUser() : null) ||
    null;

  const urlFlag =
    urlParams.get("miniapp") === "1" ||
    urlParams.get("wathanpay") === "1" ||
    urlParams.has("wathanpay") ||
    urlParams.has("miniapp");

  const uaFlag = typeof navigator !== "undefined" && /wathanpay/i.test(navigator.userAgent || "");
  const storageFlag =
    typeof sessionStorage !== "undefined" && sessionStorage.getItem("wathanpay_miniapp") === "true";
  const hasBridge = !!(
    window.WathanPay?.ready ||
    window.WathanPay?.pay ||
    window.WathanPay?.authData
  );

  const isMiniApp = !!(authData || urlFlag || uaFlag || storageFlag || hasBridge || wpUser);

  if (isMiniApp && typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("wathanpay_miniapp", "true");
    document.documentElement.dataset.miniApp = "true";
  }

  return { isMiniApp, authData, user: wpUser };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [miniApp, setMiniApp] = useState(false);
  const authAttempted = useRef(false);

  const authenticateWathanPay = async (
    credentials: { authData?: string | null },
    profileUser?: MiniAppUser | null,
  ) => {
    if (authAttempted.current) return;
    if (!credentials.authData) return;
    authAttempted.current = true;
    setMiniApp(true);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("wathanpay_miniapp", "true");
      document.documentElement.dataset.miniApp = "true";
    }
    try {
      const data = await api<{ user: Me }>("/api/auth/wathanpay", {
        method: "POST",
        body: JSON.stringify({
          authData: credentials.authData || undefined,
          name: profileUser?.name,
          phone: profileUser?.phone || profileUser?.maskedPhone,
          avatarUrl: profileUser?.avatarUrl,
        }),
      });
      setMe(data.user);
    } catch {
      // Fall back to general session
      await refresh();
    } finally {
      setReady(true);
    }
  };

  const refresh = async () => {
    try {
      const data = await api<{ user: Me | null }>("/api/auth/me");
      setMe(data.user);
      if (data.user?.loginMethod === "wathanpay" || data.user?.miniApp) {
        setMiniApp(true);
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem("wathanpay_miniapp", "true");
          document.documentElement.dataset.miniApp = "true";
        }
      }
    } catch {
      setMe(null);
    }
  };

  useEffect(() => {
    const { isMiniApp, authData, user: wpUser } = detectMiniAppSignals();
    if (isMiniApp) {
      setMiniApp(true);
    }

    if (authData) {
      void authenticateWathanPay({ authData }, wpUser);
      return;
    }

    // Check existing cookie session
    void refresh().finally(() => setReady(true));

    // Watch for asynchronous WebView bridge injection (e.g. React Native / Android / iOS WebViews)
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 60;
      const detected = detectMiniAppSignals();
      if (detected.isMiniApp && !miniApp) {
        setMiniApp(true);
      }
      if (detected.authData && !authAttempted.current) {
        clearInterval(interval);
        void authenticateWathanPay({ authData: detected.authData }, detected.user);
      }
      if (elapsed > 3000) {
        clearInterval(interval);
      }
    }, 60);

    const onBridgeReady = () => {
      const detected = detectMiniAppSignals();
      setMiniApp(true);
      if (detected.authData && !authAttempted.current) {
        void authenticateWathanPay({ authData: detected.authData }, detected.user);
      }
    };

    window.addEventListener("WathanPayReady", onBridgeReady);
    window.addEventListener("WathanPayBridgeReady", onBridgeReady);
    window.addEventListener("wathanpay:ready", onBridgeReady);

    return () => {
      clearInterval(interval);
      window.removeEventListener("WathanPayReady", onBridgeReady);
      window.removeEventListener("WathanPayBridgeReady", onBridgeReady);
      window.removeEventListener("wathanpay:ready", onBridgeReady);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setMe(null);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("wathanpay_miniapp");
    }
    if (window.WathanPay?.close) window.WathanPay.close();
  };

  return (
    <AuthContext.Provider value={{ me, ready, miniApp, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
