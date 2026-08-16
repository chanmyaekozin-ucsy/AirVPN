"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FlagIcon } from "@/components/FlagIcon";
import { PlanListSkeleton } from "@/components/LoadingSkeleton";
import { ShopShell } from "@/components/ShopShell";
import { useAuth } from "@/components/Auth";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { formatDataGb, formatDuration, formatKs, formatOffBadge, planDiscount } from "@/lib/format";
import type { Plan, Server } from "@/lib/types";

type PayMethod = {
  id: string;
  method: string;
  accountNumber?: string;
  accountName?: string;
};

type Step = "plans" | "pay" | "confirm";

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

export default function BuyPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { me, ready, miniApp } = useAuth();
  const [step, setStep] = useState<Step>("plans");
  const [server, setServer] = useState<Server | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [selected, setSelected] = useState<PayMethod | null>(null);
  const [orderId, setOrderId] = useState("");
  const [payee, setPayee] = useState<{ name: string | null; phone: string | null; method: string } | null>(
    null,
  );
  const [last5, setLast5] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const orderIdRef = useRef("");
  const walletLaunch = useRef(false);

  useEffect(() => {
    api<{ server: Server; plans: Plan[] }>(`/api/servers/${slug}`)
      .then((data) => {
        setServer(data.server);
        setPlans(data.plans);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Server not found"));
  }, [slug]);

  useEffect(() => {
    if (ready && !me && !miniApp && (step === "pay" || step === "confirm")) {
      router.replace(`/login?next=/buy/${slug}`);
    }
  }, [ready, me, miniApp, router, step, slug]);

  useEffect(() => {
    if (miniApp || step !== "pay") return;
    api<{ methods: PayMethod[] }>("/api/payment-methods")
      .then((data) => {
        setMethods(data.methods);
        setSelected((current) => current ?? data.methods[0] ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load payment methods"));
  }, [step, miniApp]);

  useEffect(() => {
    if (step !== "pay") walletLaunch.current = false;
  }, [step]);

  const createOrder = async () => {
    if (!plan) throw new Error("Choose a plan first.");
    if (orderIdRef.current) return orderIdRef.current;
    const created = await api<{ order: { id: string } }>("/api/orders", {
      method: "POST",
      body: JSON.stringify({ planId: plan.id }),
    });
    orderIdRef.current = created.order.id;
    setOrderId(created.order.id);
    return created.order.id;
  };

  const startWalletPay = async () => {
    if (!server || !plan || walletLaunch.current) return;
    walletLaunch.current = true;
    setBusy(true);
    setError("");
    try {
      const id = await createOrder();
      await api(`/api/orders/${id}/pay`, {
        method: "POST",
        body: JSON.stringify({ accountId: "wathanpay" }),
      });
      const txid = await payWithWathanPay({
        orderId: id,
        amountKs: plan.priceKs,
        title: "AirVPN",
        subtitle: `${server.name} · ${plan.title}`,
      });
      const paid = await api<{ order: { id: string } }>(`/api/orders/${id}/paid`, {
        method: "POST",
        body: JSON.stringify({ txid }),
      });
      router.push(`/orders/${paid.order.id}`);
    } catch (err) {
      walletLaunch.current = false;
      setError(err instanceof Error ? err.message : "Could not pay with WathanPay");
    } finally {
      setBusy(false);
    }
  };

  const startGatewayPay = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const id = await createOrder();
      const paid = await api<{
        order: { payeeName: string | null; payeePhone: string | null; paymentMethod: string };
      }>(`/api/orders/${id}/pay`, {
        method: "POST",
        body: JSON.stringify({ accountId: selected.id }),
      });
      setPayee({
        name: paid.order.payeeName,
        phone: paid.order.payeePhone,
        method: paid.order.paymentMethod || selected.method,
      });
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start payment");
    } finally {
      setBusy(false);
    }
  };

  const confirmPay = async () => {
    if (!orderId) return;
    setBusy(true);
    setError("");
    try {
      const paid = await api<{ order: { id: string } }>(`/api/orders/${orderId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ last5 }),
      });
      router.push(`/orders/${paid.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const titles = { plans: server?.name || "Plans", pay: "Payment", confirm: "Confirm" };
  const lastStep = miniApp ? 2 : 3;
  const stepNo = { plans: 1, pay: 2, confirm: 3 }[step];

  return (
    <ShopShell
      title={titles[step]}
      onBack={() => {
        setError("");
        if (step === "plans") router.push("/");
        else if (step === "pay") setStep("plans");
        else setStep("pay");
      }}
    >
      <div className="steps" aria-hidden>
        {Array.from({ length: lastStep }, (_, i) => i + 1).map((n) => (
          <span key={n} style={{ display: "contents" }}>
            <span className={n <= stepNo ? "step on" : "step"}>{n}</span>
            {n < lastStep ? <span className={n < stepNo ? "step-line on" : "step-line"} /> : null}
          </span>
        ))}
      </div>
      <div className="pad">
        {error ? <p className="err">{error}</p> : null}

        {step === "plans" ? (
          <>
            {!server && !error ? (
              <PlanListSkeleton count={4} />
            ) : (
              <>
                <p className="hint">
                  {server ? (
                    <span className="server-flag-row">
                      <FlagIcon
                        region={server.region}
                        name={server.name}
                        slug={server.slug}
                        id={server.id}
                        size={28}
                      />
                      <span>
                        <b>{server.name}</b>
                        {server.nameMy ? (
                          <>
                            <br />
                            <span className="font-my" style={{ color: "var(--text-2)", fontSize: 13 }}>
                              {server.nameMy}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </span>
                  ) : null}
                </p>
                <div className="pkg-list">
                  {plans.map((item) => {
                    const d = planDiscount(item);
                    return (
                      <button
                        key={item.id}
                        className={plan?.id === item.id ? "pkg on" : "pkg"}
                        type="button"
                        onClick={() => setPlan(item)}
                  >
                    <span className="name">
                      {item.title}
                      {d.hasDiscount ? (
                        <span className="pkg-deals">
                          <span className="deal-pct">{d.offPct}% OFF</span>
                          <span className="deal-amt">{d.offKs.toLocaleString("en-US")} off</span>
                        </span>
                      ) : null}
                    </span>
                    <span className="price">
                      {d.hasDiscount ? <span className="was">{formatKs(d.compareAtKs)}</span> : null}
                      <span className="now">
                        {formatKs(d.priceKs).replace(" Ks", "")}
                        <small>Ks</small>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="pkg-foot">
              <button
                className="btn"
                disabled={!plan}
                type="button"
                onClick={() => {
                  if (!me && !miniApp) {
                    router.push(`/login?next=/buy/${slug}`);
                    return;
                  }
                  orderIdRef.current = "";
                  setOrderId("");
                  setError("");
                  setStep("pay");
                  if (miniApp) void startWalletPay();
                }}
              >
                Continue
              </button>
            </div>
            </>
          )}
          </>
        ) : null}

        {step === "pay" && miniApp ? (
          <>
            <p className="hint">Paying with WathanPay. Confirm with your wallet PIN.</p>
            <div className="summary">
              <div className="muted">Amount</div>
              <div className="big">{formatKs(plan?.priceKs || 0)}</div>
              {plan && planDiscount(plan).hasDiscount ? (
                <div className="row">
                  <span>Discount</span>
                  <b className="pkg-off">
                    {formatOffBadge(planDiscount(plan).offKs, planDiscount(plan).offPct)}
                  </b>
                </div>
              ) : null}
              <div className="row">
                <span>Server</span>
                <b>{server?.name}</b>
              </div>
              <div className="row">
                <span>Plan</span>
                <b>{plan?.title}</b>
              </div>
              <div className="row">
                <span>Data</span>
                <b>{plan ? formatDataGb(plan.dataGb) : "—"}</b>
              </div>
            </div>
            <button className="btn" style={{ marginTop: 20 }} disabled={busy} type="button" onClick={() => void startWalletPay()}>
              {busy ? "Paying…" : "Pay with WathanPay"}
            </button>
          </>
        ) : null}

        {step === "pay" && !miniApp ? (
          <>
            <p className="hint">Choose how to pay. Transfer the exact amount, then confirm with TxID.</p>
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
            <button
              className="btn"
              style={{ marginTop: 20 }}
              disabled={!selected || busy}
              type="button"
              onClick={() => void startGatewayPay()}
            >
              {busy ? "Starting…" : "Continue"}
            </button>
          </>
        ) : null}

        {step === "confirm" ? (
          <>
            <div className="summary">
              <div className="muted">Amount</div>
              <div className="big">{formatKs(plan?.priceKs || 0)}</div>
              {plan && planDiscount(plan).hasDiscount ? (
                <div className="row">
                  <span>Was</span>
                  <b className="was-line">{formatKs(planDiscount(plan).compareAtKs)}</b>
                </div>
              ) : null}
              <div className="row">
                <span>Server</span>
                <b>{server?.name}</b>
              </div>
              <div className="row">
                <span>Plan</span>
                <b>{plan?.title}</b>
              </div>
              <div className="row">
                <span>Duration</span>
                <b>{plan ? formatDuration(plan.durationDays, plan.unlimitedDate) : "—"}</b>
              </div>
              <div className="row">
                <span>Method</span>
                <b>{payee?.method || selected?.method}</b>
              </div>
              {payee?.name ? (
                <div className="row">
                  <span>Name</span>
                  <b>{payee.name}</b>
                </div>
              ) : null}
              {payee?.phone ? (
                <div className="row">
                  <span>Number</span>
                  <b>{payee.phone}</b>
                </div>
              ) : null}
            </div>
            {payee?.phone ? (
              <button
                className="btn ghost"
                type="button"
                style={{ marginBottom: 14 }}
                onClick={() =>
                  void copyText(payee.phone || "").then((ok) => {
                    if (!ok) return;
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  })
                }
              >
                {copied ? "Copied" : "Copy number"}
              </button>
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
            <button className="btn" disabled={busy || last5.length !== 5} type="button" onClick={() => void confirmPay()}>
              {busy ? "Confirming…" : "Confirm order"}
            </button>
          </>
        ) : null}
      </div>
      {busy && step !== "plans" ? (
        <div className="busy">
          <div className="spinner" />
        </div>
      ) : null}
    </ShopShell>
  );
}
