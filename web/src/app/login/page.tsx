"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/components/Auth";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const { refresh } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

  useEffect(() => {
    if (!googleClientId) return;

    // Load Google Identity Services script
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response: { credential?: string }) => {
            if (!response.credential) return;
            setBusy(true);
            setError("");
            try {
              await api("/api/auth/google", {
                method: "POST",
                body: JSON.stringify({ credential: response.credential }),
              });
              await refresh();
              const next = search.get("next");
              router.push(next?.startsWith("/") ? next : "/");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Google sign in failed");
            } finally {
              setBusy(false);
            }
          },
        });
        const el = document.getElementById("google-signin-btn");
        if (el) {
          window.google.accounts.id.renderButton(el, {
            theme: "outline",
            size: "large",
            width: "100%",
            text: "continue_with",
            shape: "rectangular",
          });
        }
      }
    };
    document.body.appendChild(script);
  }, [googleClientId, refresh, router, search]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, pin }),
      });
      await refresh();
      const next = search.get("next");
      router.push(next?.startsWith("/") ? next : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="mark">AV</div>
        <h1>AirVPN</h1>
        <p>Sign in to manage your VPN subscriptions and keys.</p>
        {error ? <p className="err">{error}</p> : null}

        {googleClientId ? (
          <div style={{ marginBottom: 16 }}>
            <div id="google-signin-btn" style={{ width: "100%", minHeight: 40 }} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                margin: "16px 0 12px",
                color: "var(--muted)",
                fontSize: 12,
              }}
            >
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span>OR</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
          </div>
        ) : null}

        <form onSubmit={onSubmit}>
          <label className="field">
            Email or Phone
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="e.g. name@email.com or 09xxxxxxxxx"
              autoComplete="username"
            />
          </label>
          <label className="field">
            6-Digit PIN
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="••••••"
            />
          </label>
          <button className="btn" disabled={busy} type="submit" style={{ width: "100%" }}>
            {busy ? "Signing in…" : "Sign In with PIN"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
