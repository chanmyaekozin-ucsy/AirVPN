"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatKs, formatWhen, orderStatusLabel } from "@/lib/format";
import type { Order } from "@/lib/types";

export default function AdminPurchasesPage() {
  const [rows, setRows] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [error, setError] = useState("");

  const load = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (paidBy) params.set("paidBy", paidBy);
    return api<{ orders: Order[] }>(`/api/admin/purchases?${params}`).then((r) => setRows(r.orders));
  };

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Purchases</h2>
          <p>VPN plan orders: server, plan, payment, and delivery status.</p>
        </div>
      </div>
      {error ? <p className="err">{error}</p> : null}
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          load().catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
        }}
      >
        <input className="box" placeholder="Search plan, txid" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="box" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All status</option>
          <option value="success">Active</option>
          <option value="awaiting_payment">Awaiting payment</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="box" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          <option value="">All paid by</option>
          <option value="wathanpay">WathanPay</option>
          <option value="kbzpay">KBZPay</option>
          <option value="wavepay">WavePay</option>
        </select>
        <button className="btn small" type="submit">
          Filter
        </button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Customer</th>
              <th>Server & Plan</th>
              <th>Amount</th>
              <th>Payment & Payer</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  No purchases yet.
                </td>
              </tr>
            ) : (
              rows.map((o) => {
                const method = (o.userLoginMethod || "").toLowerCase();
                const badgeStyle =
                  method === "wathanpay"
                    ? { bg: "#e3f2fd", text: "#0d47a1" }
                    : method === "google"
                    ? { bg: "#fce8e6", text: "#c5221f" }
                    : method === "email"
                    ? { bg: "#f1f8e9", text: "#33691e" }
                    : { bg: "#ede7f6", text: "#4a148c" };

                return (
                  <tr key={o.id}>
                    <td className="muted">{formatWhen(o.createdAt)}</td>
                    <td>
                      <div style={{ fontWeight: 650 }}>{o.userName || "Customer"}</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: 4,
                            background: badgeStyle.bg,
                            color: badgeStyle.text,
                            textTransform: "capitalize",
                          }}
                        >
                          {method || "Email"}
                        </span>
                        {o.userEmail ? (
                          <span style={{ fontSize: 11, color: "var(--text-2)" }}>{o.userEmail}</span>
                        ) : o.userPhone ? (
                          <span style={{ fontSize: 11, color: "var(--text-2)" }}>{o.userPhone}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{o.serverName}</div>
                      <div style={{ fontSize: 12, color: "var(--text-2)" }}>{o.planTitle}</div>
                    </td>
                    <td>{formatKs(o.amountKs)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{o.paymentMethod || "—"}</div>
                      {o.payeeName ? (
                        <div style={{ fontSize: 11, color: "var(--brand-dark)" }}>Payer: {o.payeeName}</div>
                      ) : null}
                      {o.txid ? (
                        <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>
                          Tx: {o.txid.slice(0, 16)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={`pill ${o.status === "success" ? "on" : o.status === "failed" || o.status === "cancelled" ? "fail" : ""}`}>
                        {orderStatusLabel(o.status)}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
