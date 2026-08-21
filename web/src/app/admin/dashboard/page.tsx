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
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dashboard data"))
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
      {/* ── Dashboard Header & Timeframe Tabs ───────────────────────────────── */}
      <div className="page-h" style={{ alignItems: "center" }}>
        <div>
          <h2>Dashboard</h2>
          <p>Sales overview, payment channels, and server traffic metrics.</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Classical Period Selector */}
          <div
            style={{
              display: "inline-flex",
              background: "var(--white)",
              padding: 2,
              borderRadius: 10,
              border: "1px solid var(--border)",
            }}
          >
            {(
              [
                ["daily", "Today"],
                ["weekly", "7 Days"],
                ["monthly", "30 Days"],
                ["allTime", "All Time"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTimeframe(key)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: timeframe === key ? 700 : 500,
                  transition: "all 0.1s ease",
                  background: timeframe === key ? "var(--navy)" : "transparent",
                  color: timeframe === key ? "#ffffff" : "var(--text-2)",
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
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {busy ? "Updating…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="err">{error}</p> : null}

      {!stats && !error ? (
        <KpiGridSkeleton />
      ) : stats ? (
        <>
          {/* ── 1. Core KPI Metrics Grid ────────────────────────────────────── */}
          <div className="kpi-grid">
            <div className="kpi">
              <span className="kpi-label">
                {timeframe === "daily"
                  ? "Revenue (Today)"
                  : timeframe === "weekly"
                    ? "Revenue (7 Days)"
                    : timeframe === "monthly"
                      ? "Revenue (30 Days)"
                      : "Revenue (All Time)"}
              </span>
              <span className="kpi-value">{formatKs(activePeriod.revenueKs)}</span>
              <span className="kpi-sub">{activePeriod.ordersCount} paid orders</span>
            </div>

            <div className="kpi">
              <span className="kpi-label">Keys Fulfilled</span>
              <span className="kpi-value">{activePeriod.keysSold.toLocaleString("en-US")}</span>
              <span className="kpi-sub">{stats.activeKeys} active subscriptions</span>
            </div>

            <div className="kpi">
              <span className="kpi-label">Avg Order Value</span>
              <span className="kpi-value">{formatKs(activePeriod.avgOrderValueKs)}</span>
              <span className="kpi-sub">Per completed transaction</span>
            </div>

            <div className="kpi">
              <span className="kpi-label">Fulfillment Rate</span>
              <span className="kpi-value">{stats.outcomes.successPercentage}%</span>
              <span className="kpi-sub">
                {stats.outcomes.successCount} of {stats.outcomes.total} total orders
              </span>
            </div>
          </div>

          {/* ── 2. Classical Daily Sales Volume Chart ────────────────────────── */}
          <div
            style={{
              background: "var(--white)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "18px 20px",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 16,
              }}
            >
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)" }}>
                  Daily Revenue (Last 14 Days)
                </h3>
                <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>
                  Daily sales volume and order completions.
                </p>
              </div>

              {hoveredPoint ? (
                <div
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    padding: "4px 10px",
                    borderRadius: 8,
                    textAlign: "right",
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "var(--text-2)" }}>
                    {hoveredPoint.shortDay}, {hoveredPoint.label}:
                  </span>{" "}
                  <b style={{ color: "var(--navy)" }}>{formatKs(hoveredPoint.revenueKs)}</b>
                  <span style={{ color: "var(--text-2)", marginLeft: 6 }}>
                    ({hoveredPoint.successOrders} success
                    {hoveredPoint.pendingOrders > 0 ? `, ${hoveredPoint.pendingOrders} pending` : ""}
                    {hoveredPoint.failedOrders > 0 ? `, ${hoveredPoint.failedOrders} failed` : ""})
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Peak: {formatKs(maxChartRevenue)}
                </div>
              )}
            </div>

            {/* Classical Clean Bar Chart */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${stats.dailyTrend.length}, 1fr)`,
                gap: 6,
                alignItems: "flex-end",
                height: 140,
                padding: "8px 0 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {stats.dailyTrend.map((point) => {
                const heightPercent = Math.max(
                  4,
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
                        maxWidth: 28,
                        height: `${heightPercent}%`,
                        background:
                          point.revenueKs > 0
                            ? isHovered
                              ? "var(--navy)"
                              : "var(--navy-soft)"
                            : "var(--border)",
                        borderRadius: "3px 3px 0 0",
                        transition: "background 0.15s ease",
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
                gap: 6,
                marginTop: 6,
              }}
            >
              {stats.dailyTrend.map((point) => (
                <div
                  key={point.date}
                  style={{
                    textAlign: "center",
                    fontSize: 10,
                    color: hoveredPoint?.date === point.date ? "var(--navy)" : "var(--muted)",
                    fontWeight: hoveredPoint?.date === point.date ? 700 : 500,
                  }}
                >
                  {point.label.split(" ")[1]}
                </div>
              ))}
            </div>
          </div>

          {/* ── 3. Payment Methods & Order Outcomes Grid ─────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            {/* Payment Methods Breakdown */}
            <div
              style={{
                background: "var(--white)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "18px 20px",
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>
                Payment Methods
              </h3>
              <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 14 }}>
                Revenue distribution across payment providers.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {stats.paymentMethods.map((pm) => (
                  <div key={pm.method} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ fontWeight: 600, color: "var(--navy)" }}>
                        {pm.displayName}
                        <span style={{ fontWeight: 400, color: "var(--text-2)", marginLeft: 6 }}>
                          ({pm.count} orders)
                        </span>
                      </span>
                      <span>
                        <b style={{ color: "var(--navy)" }}>{formatKs(pm.revenueKs)}</b>
                        <span style={{ color: "var(--text-2)", marginLeft: 6, fontSize: 12 }}>
                          {pm.percentage}%
                        </span>
                      </span>
                    </div>

                    <div
                      style={{
                        height: 5,
                        background: "var(--bg-soft)",
                        borderRadius: 4,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${pm.percentage}%`,
                          background:
                            pm.method === "KBZPay"
                              ? "#0047ba"
                              : pm.method === "WavePay"
                                ? "#d97706"
                                : pm.method === "WathanPay"
                                  ? "#0d9488"
                                  : "var(--text-2)",
                          borderRadius: 4,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Order Status Outcomes */}
            <div
              style={{
                background: "var(--white)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "18px 20px",
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>
                Order Status Outcomes
              </h3>
              <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 14 }}>
                Total lifecycle of placed customer orders.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--brand-dark)" }}>
                    Succeeded
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 750, color: "var(--navy)", margin: "2px 0" }}>
                    {stats.outcomes.successCount}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-2)" }}>
                    {stats.outcomes.successPercentage}% · {formatKs(stats.outcomes.successRevenueKs)}
                  </div>
                </div>

                <div
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--warning)" }}>
                    Pending
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 750, color: "var(--navy)", margin: "2px 0" }}>
                    {stats.outcomes.pendingCount}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-2)" }}>
                    {stats.outcomes.pendingPercentage}% · {formatKs(stats.outcomes.pendingPotentialKs)}
                  </div>
                </div>

                <div
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--danger)" }}>
                    Failed
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 750, color: "var(--navy)", margin: "2px 0" }}>
                    {stats.outcomes.failedCount}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-2)" }}>
                    {stats.outcomes.failedPercentage}% of orders
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── 4. Server Node Traffic & Revenue ─────────────────────────────── */}
          <div className="page-h" style={{ marginTop: 20, marginBottom: 8 }}>
            <div>
              <h2>Server Node Performance</h2>
              <p>Active connections and revenue across provisioned nodes.</p>
            </div>
            <Link className="btn small ghost" href="/admin">
              Manage Servers
            </Link>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Keys Sold</th>
                  <th>Active Keys</th>
                  <th>Revenue</th>
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
                            size={24}
                          />
                          <span>
                            <b>{row.serverName}</b>
                            <div className="muted">
                              {countryLabel(code) || row.region}
                              {!row.isActive ? " (inactive)" : ""}
                            </div>
                          </span>
                        </span>
                      </td>
                      <td>{row.keysSold.toLocaleString("en-US")}</td>
                      <td>
                        <b style={{ color: row.activeKeys > 0 ? "var(--brand-dark)" : "var(--muted)" }}>
                          {row.activeKeys.toLocaleString("en-US")}
                        </b>
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
          {stats.byServer.length === 0 ? <p className="empty">No servers configured.</p> : null}

          {/* ── 5. Recent Purchase Activity ──────────────────────────────────── */}
          {stats.recentActivity?.length > 0 ? (
            <div style={{ marginTop: 24 }}>
              <div className="page-h" style={{ marginBottom: 8 }}>
                <div>
                  <h2>Recent Orders</h2>
                  <p>Latest customer transactions and payment confirmations.</p>
                </div>
                <Link className="btn small ghost" href="/admin/purchases">
                  All Orders
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
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentActivity.map((act) => (
                      <tr key={act.id}>
                        <td>
                          <Link
                            href={`/orders/${act.orderId}`}
                            style={{ fontFamily: "monospace", fontSize: 12, color: "var(--navy)", fontWeight: 600 }}
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
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                              background: "var(--bg-soft)",
                              color: "var(--navy)",
                            }}
                          >
                            {act.paymentMethod}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`pill ${
                              act.status === "success" || act.status === "paid"
                                ? "on"
                                : act.status === "awaiting_payment"
                                  ? "promo"
                                  : "fail"
                            }`}
                          >
                            {act.status === "awaiting_payment" ? "Pending" : act.status.toUpperCase()}
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
