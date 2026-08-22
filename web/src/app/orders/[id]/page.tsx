"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PaymentMethodsSkeleton } from "@/components/LoadingSkeleton";
import { ShopShell } from "@/components/ShopShell";
import { useAuth } from "@/components/Auth";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { WathanPay } from "@/sdk/wathanpay";
import { formatDataGb, formatDuration, formatKs, formatWhen, orderStatusLabel } from "@/lib/format";
import type { Order, Subscription } from "@/lib/types";

type PayMethod = {
  id: string;
  method: string;
  accountNumber?: string;
  accountName?: string;
};

function markKind(status: Order["status"]) {
  if (status === "success") return "ok";
  if (status === "failed" || status === "cancelled") return "bad";
  if (status === "awaiting_payment") return "wait";
  return "muted";
}

function titleFor(status: Order["status"]) {
  if (status === "success") return "VPN ready";
  if (status === "failed") return "Order failed";
  if (status === "cancelled") return "Order cancelled";
  if (status === "awaiting_payment") return "Awaiting payment";
  return orderStatusLabel(status);
}

async function payWithWathanPay(input: {
  orderId: string;
  amountKs: number;
  title?: string;
  subtitle?: string;
}) {
  const result = await WathanPay.pay({
    orderId: input.orderId,
    amount: input.amountKs,
    title: input.title,
    subtitle: input.subtitle,
  });
  if (!result.ok) {
    throw new Error(result.error || "Payment cancelled.");
  }
  return String(result.txid || "");
}


export default function OrderResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { miniApp, ready, me } = useAuth();
  const isMiniApp =
    miniApp ||
    Boolean(
      (typeof window !== "undefined" &&
        (window.WathanPay?.pay != null ||
          window.WathanPay?.accessToken != null ||
          sessionStorage.getItem("wathanpay_miniapp") === "true")) ||
        me?.loginMethod === "wathanpay" ||
        me?.miniApp,
    );
  const [order, setOrder] = useState<Order | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [payStep, setPayStep] = useState<"idle" | "methods" | "confirm">("idle");
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [selected, setSelected] = useState<PayMethod | null>(null);
  const [qrPng, setQrPng] = useState<string | null>(null);
  const [last5, setLast5] = useState("");
  const [copied, setCopied] = useState("");
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);
  const [replaceReason, setReplaceReason] = useState("Connection blocked on my SIM / Wi-Fi");
  const [replaceNote, setReplaceNote] = useState("");
  const [submittingReplace, setSubmittingReplace] = useState(false);
  const autoPay = useRef(false);

  const load = useCallback(
    () =>
      api<{ order: Order; subscription: Subscription | null }>(`/api/orders/${id}`).then((data) => {
        setOrder(data.order);
        setSubscription(data.subscription);
        return data.order;
      }),
    [id],
  );

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Order not found"));
  }, [load]);

  const requestKeyReplacement = async () => {
    setSubmittingReplace(true);
    setError("");
    try {
      await api(`/api/orders/${id}/replacement-request`, {
        method: "POST",
        body: JSON.stringify({
          reason: replaceReason,
          customerNote: replaceNote,
        }),
      });
      setReplaceModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit key replacement request");
    } finally {
      setSubmittingReplace(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/orders/${id}`, { method: "DELETE" });
      setPayStep("idle");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  };

  const retryWallet = async (current: Order) => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/orders/${current.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ accountId: "wathanpay" }),
      });
      const txid = await payWithWathanPay({
        orderId: current.id,
        amountKs: current.amountKs,
        title: "AirVPN",
        subtitle: `${current.serverName} · ${current.planTitle}`,
      });
      await api(`/api/orders/${current.id}/paid`, {
        method: "POST",
        body: JSON.stringify({ txid }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pay with WathanPay");
    } finally {
      setBusy(false);
    }
  };

  const openGatewayPay = async (current: Order) => {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ methods: PayMethod[] }>("/api/payment-methods");
      setMethods(data.methods);
      const match = data.methods.find((method) => method.method === current.paymentMethod);
      setSelected(match ?? data.methods[0] ?? null);
      setPayStep(current.depositId || current.payeePhone ? "confirm" : "methods");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load payment methods");
    } finally {
      setBusy(false);
    }
  };

  const startPay = async (current: Order) => {
    if (isMiniApp) await retryWallet(current);
    else await openGatewayPay(current);
  };

  useEffect(() => {
    if (!order || !ready || autoPay.current) return;
    if (order.status !== "awaiting_payment") return;
    if (new URLSearchParams(window.location.search).get("pay") !== "1") return;
    autoPay.current = true;
    window.history.replaceState(null, "", `/orders/${order.id}`);
    void startPay(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, ready, isMiniApp]);

  const startGatewayPay = async () => {
    if (!selected || !order) return;
    setBusy(true);
    setError("");
    try {
      const paid = await api<{
        order: Order;
        deposit?: { qrPngBase64?: string | null };
        payee?: { qrPngBase64?: string | null };
      }>(`/api/orders/${order.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ accountId: selected.id }),
      });
      setOrder(paid.order);
      setQrPng(paid.deposit?.qrPngBase64 || paid.payee?.qrPngBase64 || null);
      setPayStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start payment");
    } finally {
      setBusy(false);
    }
  };

  const confirmPay = async () => {
    if (!order) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/orders/${order.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ last5 }),
      });
      setPayStep("idle");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const status = order?.status ?? "awaiting_payment";
  const kind = markKind(status);
  const awaiting = status === "awaiting_payment";

  return (
    <ShopShell title="Order" backHref="/orders">
      {error ? <p className="err" style={{ padding: 16 }}>{error}</p> : null}
      {order ? (
        <>
          <div className="result">
            <div className={`result-mark ${kind}`}>
              {kind === "ok" ? "✓" : kind === "bad" ? "✕" : "…"}
            </div>
            <h1>{titleFor(status)}</h1>
            <div className="amount">{formatKs(order.amountKs)}</div>
            <p>
              {order.serverName} · {order.planTitle}
            </p>
            {order.failReason ? <p className="err">{order.failReason}</p> : null}
          </div>
          <div className="pad">
            <div className="summary">
              <div className="row" style={{ borderTop: 0 }}>
                <span>Status</span>
                <b>{orderStatusLabel(order.status)}</b>
              </div>
              <div className="row">
                <span>Server</span>
                <b>{order.serverName}</b>
              </div>
              <div className="row">
                <span>Plan</span>
                <b>{order.planTitle}</b>
              </div>
              <div className="row">
                <span>Data</span>
                <b>{formatDataGb(order.dataGb)}</b>
              </div>
              <div className="row">
                <span>Duration</span>
                <b>{formatDuration(order.durationDays)}</b>
              </div>
              {order.paymentMethod ? (
                <div className="row">
                  <span>Method</span>
                  <b>{order.paymentMethod}</b>
                </div>
              ) : null}
              {payStep === "confirm" && order.payeePhone ? (
                <div className="row">
                  <span>Number</span>
                  <b>{order.payeePhone}</b>
                </div>
              ) : null}
              <div className="row">
                <span>Placed</span>
                <b>{formatWhen(order.createdAt)}</b>
              </div>
            </div>

            {order.replacementRequested ? (
              <div
                style={{
                  background: "#e3f2fd",
                  border: "1px solid #bbdefb",
                  borderRadius: 12,
                  padding: "12px 14px",
                  margin: "12px 0",
                  fontSize: 13,
                  color: "#0d47a1",
                }}
              >
                <strong>Key Replacement Requested (Under Review)</strong>
                <div style={{ marginTop: 3, fontSize: 12, color: "#1565c0" }}>
                  Reason: {order.replacementReason || "Customer requested key replacement"}
                </div>
              </div>
            ) : null}

            {subscription && status === "success" ? (
              <div className="summary">
                <div className="muted">Subscription link</div>
                <div className="row" style={{ borderTop: 0 }}>
                  <span style={{ wordBreak: "break-all", fontWeight: 600 }}>{subscription.subUrl}</span>
                </div>
                <button
                  className="btn"
                  type="button"
                  style={{ marginTop: 12 }}
                  onClick={() =>
                    void copyText(subscription.subUrl).then((ok) => {
                      if (!ok) return;
                      setCopied("sub");
                      window.setTimeout(() => setCopied(""), 1500);
                    })
                  }
                >
                  {copied === "sub" ? "Copied" : "Copy subscription URL"}
                </button>
                <p className="hint" style={{ marginTop: 12 }}>
                  Import this link in AirVPN / v2rayN / Streisand.
                </p>
              </div>
            ) : null}

            {status === "success" && !order.replacementRequested ? (
              <button
                className="btn ghost"
                type="button"
                style={{ marginTop: 8, marginBottom: 8, color: "var(--text-2)", borderColor: "var(--border)" }}
                onClick={() => {
                  setReplaceModalOpen(true);
                  setReplaceReason("Connection blocked on my SIM / Wi-Fi");
                  setReplaceNote("");
                }}
              >
                Request Key Replacement
              </button>
            ) : null}

            {awaiting && payStep === "idle" ? (
              <button className="btn" disabled={busy || !ready} type="button" onClick={() => void startPay(order)} style={{ marginBottom: 8 }}>
                {busy ? "Paying…" : "Pay Now"}
              </button>
            ) : null}

            {awaiting && payStep === "methods" ? (
              <>
                {methods.length === 0 ? (
                  <PaymentMethodsSkeleton count={2} />
                ) : (
                  <div className="pay-list">
                    {methods.map((method) => (
                      <button
                        key={method.id}
                        className={selected?.id === method.id ? "pay-method on" : "pay-method"}
                        type="button"
                        onClick={() => setSelected(method)}
                      >
                        <span className={`pay-mark ${method.method === "WavePay" ? "wave" : "kbz"}`}>
                          {method.method === "WavePay" ? "W" : "K"}
                        </span>
                        <span>
                          <b>{method.method}</b>
                          <span className="pay-sub">
                            {method.accountName || method.method}
                            {method.accountNumber ? ` · ${method.accountNumber}` : ""}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <button className="btn" style={{ marginTop: 16, marginBottom: 8 }} disabled={!selected || busy} type="button" onClick={() => void startGatewayPay()}>
                  {busy ? "Starting…" : "Continue"}
                </button>
              </>
            ) : null}

            {awaiting && payStep === "confirm" ? (
              <>
                {qrPng ? (
                  <div
                    style={{
                      textAlign: "center",
                      margin: "14px 0",
                      padding: "16px",
                      background: "#ffffff",
                      borderRadius: 14,
                      border: "1px solid var(--border)",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                    }}
                  >
                    <img
                      src={qrPng.startsWith("data:") ? qrPng : `data:image/png;base64,${qrPng}`}
                      alt="Payment QR Code"
                      style={{ width: 170, height: 170, objectFit: "contain", margin: "0 auto", display: "block" }}
                    />
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 8, fontWeight: 500 }}>
                      Scan with {order.paymentMethod || "Wallet"} App to pay exact {formatKs(order.amountKs)}
                    </p>
                  </div>
                ) : null}
                <label className="field">
                  TxID last 5
                  <input
                    value={last5}
                    onChange={(e) => setLast5(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    inputMode="numeric"
                    placeholder="•••••"
                  />
                </label>
                <button className="btn" disabled={busy || last5.length !== 5} type="button" onClick={() => void confirmPay()} style={{ marginBottom: 8 }}>
                  {busy ? "Confirming…" : "Confirm order"}
                </button>
              </>
            ) : null}

            {awaiting ? (
              <button className="btn ghost" disabled={busy} type="button" onClick={() => void cancel()} style={{ marginBottom: 8 }}>
                Cancel order
              </button>
            ) : null}
            <button className={awaiting ? "btn ghost" : "btn"} type="button" onClick={() => router.push("/orders")}>
              Back to orders
            </button>
          </div>
        </>
      ) : null}

      {/* Request Key Replacement Modal */}
      {replaceModalOpen ? (
        <div className="busy" style={{ background: "rgba(16, 42, 67, 0.45)" }}>
          <div
            style={{
              background: "var(--white)",
              borderRadius: 16,
              padding: 24,
              width: "min(460px, 92vw)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <h3 style={{ fontSize: 18, marginBottom: 8, color: "var(--navy)" }}>
              Request Key Replacement
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 16, lineHeight: 1.45 }}>
              Having issues connecting with your current VPN key? Submit a key replacement request and our admin team will be notified immediately to re-issue or switch your server node.
            </p>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Reason for Replacement
              </label>
              <select
                className="box"
                value={replaceReason}
                onChange={(e) => setReplaceReason(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="Connection blocked on my SIM / Wi-Fi">Connection blocked on my SIM / Wi-Fi</option>
                <option value="Slow speed / Ping drops">Slow speed / Ping drops</option>
                <option value="Key not connecting on my device">Key not connecting on my device</option>
                <option value="Want to switch to another server node">Want to switch to another server node</option>
                <option value="Other connection issue">Other connection issue</option>
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Additional Details (Optional)
              </label>
              <textarea
                className="box"
                rows={3}
                placeholder="e.g. MPT 4G connects but no internet, want to try Japan node..."
                value={replaceNote}
                onChange={(e) => setReplaceNote(e.target.value)}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn small"
                style={{ background: "var(--bg-soft)", color: "var(--text)" }}
                onClick={() => setReplaceModalOpen(false)}
                disabled={submittingReplace}
              >
                Close
              </button>
              <button
                type="button"
                className="btn small"
                onClick={requestKeyReplacement}
                disabled={submittingReplace}
              >
                {submittingReplace ? "Submitting…" : "Submit Replacement Request"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ShopShell>
  );
}

