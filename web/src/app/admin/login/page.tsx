"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/components/Auth";
import { AirVpnLogo } from "@/components/AirVpnLogo";

export default function AdminLoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [require2fa, setRequire2fa] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      const data = await api<{
        require2fa?: boolean;
        message?: string;
        user?: { role: string };
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier,
          pin,
          totpCode: require2fa ? totpCode : undefined,
        }),
      });

      if (data.require2fa) {
        setRequire2fa(true);
        setError("");
        return;
      }

      if (data.user) {
        await refresh();
        if (data.user.role !== "admin") {
          setError("This account is not an admin.");
          return;
        }
        router.push("/admin/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <AirVpnLogo size={56} />
        </div>
        <h1>Admin Sign In</h1>
        <p>{require2fa ? "Google Authenticator 2FA Verification" : "AirVPN Management Control Panel"}</p>
        {error ? <p className="err">{error}</p> : null}

        {!require2fa ? (
          <>
            <label className="field">
              Admin Email
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                placeholder="admin@airvpn.mm"
                required
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
                required
              />
            </label>
            <button className="btn" disabled={busy || !identifier || pin.length !== 6} type="submit">
              {busy ? "Authenticating…" : "Continue"}
            </button>
          </>
        ) : (
          <>
            <div style={{ textAlign: "center", margin: "8px 0 16px", color: "var(--muted)", fontSize: 13 }}>
              Enter the 6-digit verification code from your Google Authenticator app for <b>{identifier}</b>.
            </div>
            <label className="field">
              Google Authenticator 2FA Code
              <input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoFocus
                placeholder="000 000"
                style={{ textAlign: "center", fontSize: 20, letterSpacing: "0.25em" }}
                required
              />
            </label>
            <button className="btn" disabled={busy || totpCode.length !== 6} type="submit">
              {busy ? "Verifying…" : "Verify & Sign In"}
            </button>
            <button
              type="button"
              className="btn small ghost"
              style={{ marginTop: 10, width: "100%" }}
              onClick={() => {
                setRequire2fa(false);
                setTotpCode("");
                setError("");
              }}
            >
              Back to PIN
            </button>
          </>
        )}
      </form>
    </div>
  );
}

