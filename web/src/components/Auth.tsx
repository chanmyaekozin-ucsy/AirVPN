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
  token: string | null;
  user: MiniAppUser | null;
} {
  if (typeof window === "undefined") return { isMiniApp: false, token: null, user: null };

  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl =
    urlParams.get("token") || urlParams.get("accessToken") || urlParams.get("access_token");
  const bridgeToken = window.WathanPay?.accessToken || null;
  const token = bridgeToken || tokenFromUrl || null;

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
  const hasBridge = !!(window.WathanPay?.ready || window.WathanPay?.pay || window.WathanPay?.accessToken);

  const isMiniApp = !!(token || urlFlag || uaFlag || storageFlag || hasBridge || wpUser);

  if (isMiniApp && typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("wathanpay_miniapp", "true");
    document.documentElement.dataset.miniApp = "true";
  }

  return { isMiniApp, token, user: wpUser };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [miniApp, setMiniApp] = useState(false);
  const authAttempted = useRef(false);

  const authenticateWathanPay = async (token: string, profileUser?: MiniAppUser | null) => {
    if (authAttempted.current) return;
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
          accessToken: token,
          name: profileUser?.name,
          phone: profileUser?.phone,
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
    const { isMiniApp, token, user: wpUser } = detectMiniAppSignals();
    if (isMiniApp) {
      setMiniApp(true);
    }

    if (token) {
      void authenticateWathanPay(token, wpUser);
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
      if (detected.token && !authAttempted.current) {
        clearInterval(interval);
        void authenticateWathanPay(detected.token, detected.user);
      }
      if (elapsed > 3000) {
        clearInterval(interval);
      }
    }, 60);

    const onBridgeReady = () => {
      const detected = detectMiniAppSignals();
      setMiniApp(true);
      if (detected.token && !authAttempted.current) {
        void authenticateWathanPay(detected.token, detected.user);
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
