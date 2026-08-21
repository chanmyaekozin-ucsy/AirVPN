"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FlagIcon } from "@/components/FlagIcon";
import { KpiGridSkeleton } from "@/components/LoadingSkeleton";
import { api } from "@/lib/api";
import { countryCodeFor, countryLabel } from "@/lib/flags";
import { formatDataGb, formatKs, formatWhen } from "@/lib/format";
import type { AdminStats, ChartPoint } from "@/lib/stats";

type Timeframe = "daily" | "weekly" | "monthly" | "allTime";

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>("monthly");
  const [hoveredPoint, setHoveredPoint] = useState<ChartPoint | null>(null);

  const load = () => {
    setBusy(true);
    setError("");
    api<{ stats: AdminStats }>("/api/admin/stats")
      .then((r) => setStats(r.stats))
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    load();
  }, []);

  const activePeriod = stats?.periods[timeframe] || {
    revenueKs: stats?.revenueKs || 0,
    ordersCount: 0,
    keysSold: stats?.keysSold || 0,
    avgOrderValueKs: 0,
  };

  const maxChartRevenue = Math.max(
    ...(stats?.dailyTrend?.map((p) => p.revenueKs) || [1]),
    10000,
  );

  return (
    <>
      {/* ── Top Header & Timeframe Switcher ─────────────────────────────────── */}
      <div className="page-h" style={{ alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2>Sales Tracker & Analytics</h2>
            <span
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 99,
                background: "rgba(14, 165, 233, 0.15)",
                color: "#38bdf8",
                fontWeight: 600,
              }}
            >
              Live
            </span>
          </div>
          <p>Real-time revenue, conversion rates, and payment methods performance.</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Timeframe Selector */}
          <div
            style={{
              display: "inline-flex",
              background: "var(--bg-card)",
              padding: 3,
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            {(
              [
                ["daily", "Today (24h)"],
                ["weekly", "This Week"],
                ["monthly", "This Month"],
                ["allTime", "All Time"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTimeframe(key)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  transition: "all 0.15s ease",
                  background: timeframe === key ? "var(--primary)" : "transparent",
                  color: timeframe === key ? "#ffffff" : "var(--muted)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            className="btn small ghost"
            type="button"
            disabled={busy}
            onClick={load}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ transform: busy ? "rotate(360deg)" : "none", transition: "transform 0.5s linear" }}>
              ↻
            </span>
            {busy ? "Syncing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="err">{error}</p> : null}

      {!stats && !error ? (
        <KpiGridSkeleton />
      ) : stats ? (
        <>
          {/* ── 1. Dynamic Period Sales Tracker KPIs ─────────────────────────── */}
          <div className="kpi-grid">
            <div className="kpi" style={{ borderLeft: "3px solid #0ea5e9" }}>
              <span className="kpi-label">
                {timeframe === "daily"
                  ? "Today's Revenue"
                  : timeframe === "weekly"
                    ? "7-Day Revenue"
                    : timeframe === "monthly"
                      ? "30-Day Revenue"
                      : "Total Revenue"}
              </span>
              <span className="kpi-value" style={{ color: "#38bdf8" }}>
                {formatKs(activePeriod.revenueKs)}
              </span>
              <span className="kpi-sub">
                {activePeriod.ordersCount} paid orders {timeframe === "daily" ? "today" : "in period"}
              </span>
            </div>

            <div className="kpi" style={{ borderLeft: "3px solid #22c55e" }}>
              <span className="kpi-label">Keys Fulfilled</span>
              <span className="kpi-value" style={{ color: "#4ade80" }}>
                {activePeriod.keysSold.toLocaleString("en-US")}
              </span>
              <span className="kpi-sub">
                {stats.activeKeys} active live connections
              </span>
            </div>

            <div className="kpi" style={{ borderLeft: "3px solid #a855f7" }}>
              <span className="kpi-label">Average Order Value</span>
              <span className="kpi-value">
                {formatKs(activePeriod.avgOrderValueKs)}
              </span>
              <span className="kpi-sub">Revenue per completed sale</span>
            </div>

            <div className="kpi" style={{ borderLeft: "3px solid #eab308" }}>
              <span className="kpi-label">Order Success Rate</span>
              <span className="kpi-value" style={{ color: stats.outcomes.successPercentage > 75 ? "#4ade80" : "#facc15" }}>
                {stats.outcomes.successPercentage}%
              </span>
              <span className="kpi-sub">
                {stats.outcomes.successCount} of {stats.outcomes.total} orders completed
              </span>
            </div>
          </div>

          {/* ── 2. Interactive 14-Day Sales Revenue Chart ───────────────────── */}
          <div className="panel" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, marginBottom: 2 }}>14-Day Revenue & Volume Trend</h3>
                <p className="muted" style={{ fontSize: 12 }}>
                  Hover over bars to inspect daily revenue and order metrics.
                </p>
              </div>

              {hoveredPoint ? (
                <div
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    padding: "6px 14px",
                    borderRadius: 8,
                    textAlign: "right",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {hoveredPoint.shortDay}, {hoveredPoint.label}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#38bdf8" }}>
                    {formatKs(hoveredPoint.revenueKs)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    <span style={{ color: "#4ade80" }}>✓ {hoveredPoint.successOrders} success</span>
                    {hoveredPoint.pendingOrders > 0 ? ` · ⏳ ${hoveredPoint.pendingOrders} pending` : ""}
                    {hoveredPoint.failedOrders > 0 ? ` · ✗ ${hoveredPoint.failedOrders} failed` : ""}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
                  Peak: {formatKs(maxChartRevenue)}
                </div>
              )}
            </div>

            {/* Custom SVG/CSS Bar Chart */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${stats.dailyTrend.length}, 1fr)`,
                gap: 8,
                alignItems: "flex-end",
                height: 180,
                padding: "16px 8px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {stats.dailyTrend.map((point) => {
                const heightPercent = Math.max(
                  6,
                  Math.round((point.revenueKs / maxChartRevenue) * 100),
                );
                const isHovered = hoveredPoint?.date === point.date;

                return (
                  <div
                    key={point.date}
                    onMouseEnter={() => setHoveredPoint(point)}
                    onMouseLeave={() => setHoveredPoint(null)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      height: "100%",
                      justifyContent: "flex-end",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 32,
                        height: `${heightPercent}%`,
                        background:
                          point.revenueKs > 0
                            ? isHovered
                              ? "linear-gradient(180deg, #38bdf8, #0284c7)"
                              : "linear-gradient(180deg, rgba(56, 189, 248, 0.8), rgba(14, 165, 233, 0.4))"
                            : "rgba(255, 255, 255, 0.05)",
                        borderRadius: "4px 4px 1px 1px",
                        boxShadow: isHovered ? "0 0 16px rgba(56, 189, 248, 0.5)" : "none",
                        transition: "all 0.2s ease",
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Date Labels */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${stats.dailyTrend.length}, 1fr)`,
                gap: 8,
                marginTop: 8,
              }}
            >
              {stats.dailyTrend.map((point) => (
                <div
                  key={point.date}
                  style={{
                    textAlign: "center",
                    fontSize: 10,
                    color: hoveredPoint?.date === point.date ? "#38bdf8" : "var(--muted)",
                    fontWeight: hoveredPoint?.date === point.date ? 700 : 400,
                  }}
                >
                  <div>{point.label.split(" ")[1]}</div>
                  <div style={{ opacity: 0.6, fontSize: 9 }}>{point.shortDay}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 3. Payment Methods Distribution & Order Health Grid ─────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            {/* Payment Methods Breakdown */}
            <div className="panel">
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Payment Methods Breakdown</h3>
              <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
                Distribution across KBZPay, WavePay, and WathanPay.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {stats.paymentMethods.map((pm) => (
                  <div key={pm.method} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: pm.color,
                          }}
                        />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{pm.displayName}</span>
                        <span className="muted" style={{ fontSize: 11 }}>
                          ({pm.count} orders)
                        </span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{formatKs(pm.revenueKs)}</span>
                        <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                          {pm.percentage}%
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        height: 6,
                        background: "rgba(255, 255, 255, 0.08)",
                        borderRadius: 99,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${pm.percentage}%`,
                          background: pm.color,
                          borderRadius: 99,
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Order Health & Conversion Status */}
            <div className="panel">
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Order Outcome Health</h3>
              <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
                Successful fulfillment vs pending and expired payments.
              </p>

              {/* Multi-segment Progress Bar */}
              <div
                style={{
                  height: 12,
                  display: "flex",
                  borderRadius: 99,
                  overflow: "hidden",
                  marginBottom: 16,
                  background: "rgba(255, 255, 255, 0.08)",
                }}
              >
                <div
                  style={{
                    width: `${stats.outcomes.successPercentage}%`,
                    background: "#22c55e",
                    transition: "width 0.4s ease",
                  }}
                  title={`Success: ${stats.outcomes.successPercentage}%`}
                />
                <div
                  style={{
                    width: `${stats.outcomes.pendingPercentage}%`,
                    background: "#eab308",
                    transition: "width 0.4s ease",
                  }}
                  title={`Pending: ${stats.outcomes.pendingPercentage}%`}
                />
                <div
                  style={{
                    width: `${stats.outcomes.failedPercentage}%`,
                    background: "#ef4444",
                    transition: "width 0.4s ease",
                  }}
                  title={`Failed: ${stats.outcomes.failedPercentage}%`}
                />
              </div>

              {/* Legend Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div
                  style={{
                    background: "rgba(34, 197, 94, 0.1)",
                    border: "1px solid rgba(34, 197, 94, 0.2)",
                    borderRadius: 8,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>✓ Succeeded</div>
                  <div style={{ fontSize: 18, fontWeight: 800, margin: "2px 0" }}>
                    {stats.outcomes.successCount}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {stats.outcomes.successPercentage}% ({formatKs(stats.outcomes.successRevenueKs)})
                  </div>
                </div>

                <div
                  style={{
                    background: "rgba(234, 179, 8, 0.1)",
                    border: "1px solid rgba(234, 179, 8, 0.2)",
                    borderRadius: 8,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#facc15", fontWeight: 600 }}>⏳ Pending</div>
                  <div style={{ fontSize: 18, fontWeight: 800, margin: "2px 0" }}>
                    {stats.outcomes.pendingCount}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {stats.outcomes.pendingPercentage}% ({formatKs(stats.outcomes.pendingPotentialKs)})
                  </div>
                </div>

                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                    borderRadius: 8,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>✗ Failed</div>
                  <div style={{ fontSize: 18, fontWeight: 800, margin: "2px 0" }}>
                    {stats.outcomes.failedCount}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {stats.outcomes.failedPercentage}%
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── 4. Revenue by Node / Server ─────────────────────────────────── */}
          <div className="page-h" style={{ marginTop: 24, marginBottom: 8 }}>
            <div>
              <h2 style={{ fontSize: 16 }}>Server Node Revenue & Performance</h2>
              <p>Keys sold, active connections, and total revenue per VPN server node.</p>
            </div>
            <Link className="btn small ghost" href="/admin">
              Configure Nodes
            </Link>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Server Node</th>
                  <th>Keys Sold</th>
                  <th>Live Active</th>
                  <th>Revenue (Ks)</th>
                  <th>Pending</th>
                  <th>Failed</th>
                </tr>
              </thead>
              <tbody>
                {stats.byServer.map((row) => {
                  const code = countryCodeFor({
                    region: row.region,
                    name: row.serverName,
                    id: row.serverId,
                  });
                  return (
                    <tr key={row.serverId}>
                      <td>
                        <span className="server-flag-row">
                          <FlagIcon
                            region={row.region}
                            name={row.serverName}
                            id={row.serverId}
                            size={26}
                          />
                          <span>
                            <b>{row.serverName}</b>
                            <div className="muted">
                              {countryLabel(code) || row.region}
                              {!row.isActive ? " · inactive" : ""}
                            </div>
                          </span>
                        </span>
                      </td>
                      <td>{row.keysSold.toLocaleString("en-US")}</td>
                      <td>
                        <span
                          style={{
                            fontWeight: 600,
                            color: row.activeKeys > 0 ? "#4ade80" : "var(--muted)",
                          }}
                        >
                          {row.activeKeys.toLocaleString("en-US")}
                        </span>
                      </td>
                      <td>
                        <b>{formatKs(row.revenueKs)}</b>
                      </td>
                      <td>{row.ordersPending}</td>
                      <td>{row.ordersFailed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {stats.byServer.length === 0 ? <p className="empty">No servers configured yet.</p> : null}

          {/* ── 5. Live Recent Transaction Activity Feed ────────────────────── */}
          {stats.recentActivity?.length > 0 ? (
            <div style={{ marginTop: 24 }}>
              <div className="page-h" style={{ marginBottom: 8 }}>
                <div>
                  <h2 style={{ fontSize: 16 }}>Recent Purchase Activity</h2>
                  <p>Latest orders, customer contacts, and payment confirmation status.</p>
                </div>
                <Link className="btn small ghost" href="/admin/purchases">
                  View All Orders
                </Link>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Customer</th>
                      <th>Server / Plan</th>
                      <th>Amount</th>
                      <th>Payment Method</th>
                      <th>Status</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentActivity.map((act) => (
                      <tr key={act.id}>
                        <td>
                          <Link
                            href={`/orders/${act.orderId}`}
                            style={{ fontFamily: "monospace", fontSize: 12, color: "#38bdf8" }}
                          >
                            #{act.orderId.slice(-8)}
                          </Link>
                        </td>
                        <td>
                          <b>{act.customerName}</b>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {act.contact}
                          </div>
                        </td>
                        <td>
                          {act.serverName} · <span className="muted">{act.planTitle} ({formatDataGb(act.dataGb)})</span>
                        </td>
                        <td>
                          <b>{formatKs(act.amountKs)}</b>
                        </td>
                        <td>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 600,
                              background:
                                act.paymentMethod.toLowerCase().includes("kbz")
                                  ? "rgba(0, 71, 186, 0.15)"
                                  : act.paymentMethod.toLowerCase().includes("wave")
                                    ? "rgba(234, 179, 8, 0.15)"
                                    : act.paymentMethod.toLowerCase().includes("wathan")
                                      ? "rgba(13, 148, 136, 0.15)"
                                      : "rgba(255, 255, 255, 0.08)",
                              color:
                                act.paymentMethod.toLowerCase().includes("kbz")
                                  ? "#60a5fa"
                                  : act.paymentMethod.toLowerCase().includes("wave")
                                    ? "#facc15"
                                    : act.paymentMethod.toLowerCase().includes("wathan")
                                      ? "#2dd4bf"
                                      : "var(--muted)",
                            }}
                          >
                            {act.paymentMethod}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: 12,
                              color:
                                act.status === "success" || act.status === "paid"
                                  ? "#4ade80"
                                  : act.status === "awaiting_payment"
                                    ? "#facc15"
                                    : "#f87171",
                            }}
                          >
                            {act.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {formatWhen(act.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
