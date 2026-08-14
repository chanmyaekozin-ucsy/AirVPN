"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShopShell } from "@/components/ShopShell";
import { useAuth } from "@/components/Auth";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
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
  const pay = window.WathanPay?.pay;
  if (!pay) throw new Error("Open this shop from WathanPay to pay.");
  const result = await pay(input);
  if (!result?.ok) throw new Error(result?.message || "Payment cancelled.");
  return String(result.txid || "");
}

export default function OrderResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { miniApp, ready } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [payStep, setPayStep] = useState<"idle" | "methods" | "confirm">("idle");
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [selected, setSelected] = useState<PayMethod | null>(null);
  const [last5, setLast5] = useState("");
  const [copied, setCopied] = useState("");
  const autoPay = useRef(false);

  const load = () =>
    api<{ order: Order; subscription: Subscription | null }>(`/api/orders/${id}`).then((data) => {
      setOrder(data.order);
      setSubscription(data.subscription);
      return data.order;
    });

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Order not found"));
  }, [id]);

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
    if (miniApp) await retryWallet(current);
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
  }, [order, ready, miniApp]);

  const startGatewayPay = async () => {
    if (!selected || !order) return;
    setBusy(true);
    setError("");
    try {
      const paid = await api<{ order: Order }>(`/api/orders/${order.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ accountId: selected.id }),
      });
      setOrder(paid.order);
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

            {awaiting && payStep === "idle" ? (
              <button className="btn" disabled={busy || !ready} type="button" onClick={() => void startPay(order)} style={{ marginBottom: 8 }}>
                {busy ? "Paying…" : "Pay Now"}
              </button>
            ) : null}

            {awaiting && payStep === "methods" ? (
              <>
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
                      </span>
                    </button>
                  ))}
                </div>
                <button className="btn" style={{ marginTop: 16, marginBottom: 8 }} disabled={!selected || busy} type="button" onClick={() => void startGatewayPay()}>
                  {busy ? "Starting…" : "Continue"}
                </button>
              </>
            ) : null}

            {awaiting && payStep === "confirm" ? (
              <>
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
    </ShopShell>
  );
}
