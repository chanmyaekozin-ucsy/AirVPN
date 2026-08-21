"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/api";

type TwoFactorInfo = {
  enabled: boolean;
  email?: string;
  secret?: string;
  qrCodeDataUrl?: string;
  otpauthUri?: string;
};

export default function AdminSecurityPage() {
  const [data, setData] = useState<TwoFactorInfo | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => {
    setError("");
    api<TwoFactorInfo>("/api/admin/2fa")
      .then((res) => setData(res))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load 2FA details"));
  };

  useEffect(() => {
    load();
  }, []);

  const onEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.secret || code.length !== 6) return;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const res = await api<{ ok: boolean; message: string }>("/api/admin/2fa", {
        method: "POST",
        body: JSON.stringify({ action: "enable", secret: data.secret, code }),
      });
      setSuccess(res.message || "2FA successfully enabled!");
      setCode("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable 2FA");
    } finally {
      setBusy(false);
    }
  };

  const onDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    if (!confirm("Are you sure you want to disable Google 2FA for the admin account?")) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const res = await api<{ ok: boolean; message: string }>("/api/admin/2fa", {
        method: "POST",
        body: JSON.stringify({ action: "disable", code }),
      });
      setSuccess(res.message || "2FA has been disabled.");
      setCode("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable 2FA");
    } finally {
      setBusy(false);
    }
  };

  const copySecret = () => {
    if (!data?.secret) return;
    void navigator.clipboard.writeText(data.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Admin Security & 2FA</h2>
          <p>Protect your AirVPN administrator account with Google Authenticator Two-Factor Authentication.</p>
        </div>
        <button className="btn small ghost" type="button" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <p className="err" style={{ marginBottom: 16 }}>{error}</p> : null}
      {success ? <p className="success-msg" style={{ marginBottom: 16 }}>{success}</p> : null}

      {!data ? (
        <p className="muted">Loading 2FA security configuration…</p>
      ) : data.enabled ? (
        <div className="panel" style={{ maxWidth: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span
              style={{
                background: "rgba(34, 197, 94, 0.15)",
                color: "#22c55e",
                padding: "6px 12px",
                borderRadius: 99,
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              ✓ Google 2FA Enabled
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              Protected account: <b>{data.email}</b>
            </span>
          </div>

          <p style={{ lineHeight: 1.6, color: "var(--muted)", marginBottom: 20 }}>
            Two-factor authentication is active. Every admin login requires your 6-digit PIN and a dynamic time-based code from the Google Authenticator app.
          </p>

          <form onSubmit={onDisable} style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <h3 style={{ fontSize: 15, marginBottom: 8, color: "#ef4444" }}>Disable 2FA Authentication</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              To turn off two-factor authentication, enter the current 6-digit code from your Google Authenticator app:
            </p>
            <div style={{ display: "flex", gap: 10, maxWidth: 360 }}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000 000"
                style={{ textAlign: "center", fontSize: 18, letterSpacing: "0.2em" }}
                inputMode="numeric"
                required
              />
              <button
                className="btn small danger"
                type="submit"
                disabled={busy || code.length !== 6}
                style={{ whiteSpace: "nowrap" }}
              >
                {busy ? "Disabling…" : "Disable 2FA"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="panel" style={{ maxWidth: 720 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                padding: "6px 12px",
                borderRadius: 99,
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              2FA Not Configured
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              Setup 2FA for: <b>{data.email}</b>
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 24, alignItems: "start" }}>
            {data.qrCodeDataUrl ? (
              <div
                style={{
                  background: "#ffffff",
                  padding: 12,
                  borderRadius: 12,
                  display: "inline-block",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
              >
                <Image
                  src={data.qrCodeDataUrl}
                  alt="Google Authenticator QR Code"
                  width={220}
                  height={220}
                  style={{ display: "block" }}
                  unoptimized
                />
              </div>
            ) : null}

            <div>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>Step 1: Scan with Google Authenticator</h3>
              <ol style={{ paddingLeft: 18, lineHeight: 1.6, fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>
                <li>Open <b>Google Authenticator</b> on your phone.</li>
                <li>Tap <b>+</b> and select <b>Scan a QR code</b>.</li>
                <li>Scan the QR code on the left.</li>
              </ol>

              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Or enter key manually:</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <code style={{ fontSize: 14, padding: "6px 10px", background: "var(--bg-card)", borderRadius: 6 }}>
                    {data.secret}
                  </code>
                  <button type="button" className="btn small ghost" onClick={copySecret}>
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              <h3 style={{ fontSize: 16, marginBottom: 8 }}>Step 2: Enter 6-digit Code to Activate</h3>
              <form onSubmit={onEnable} style={{ display: "flex", gap: 10, maxWidth: 360 }}>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000 000"
                  style={{ textAlign: "center", fontSize: 18, letterSpacing: "0.2em" }}
                  inputMode="numeric"
                  required
                />
                <button
                  className="btn"
                  type="submit"
                  disabled={busy || code.length !== 6}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {busy ? "Activating…" : "Activate 2FA"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
