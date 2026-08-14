"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FlagIcon } from "@/components/FlagIcon";
import { api } from "@/lib/api";
import { countryCodeFor, countryLabel } from "@/lib/flags";
import { formatKs } from "@/lib/format";
import type { AdminStats } from "@/lib/stats";

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState("");

  const load = () =>
    api<{ stats: AdminStats }>("/api/admin/stats")
      .then((r) => setStats(r.stats))
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Dashboard</h2>
          <p>Overall revenue, keys, and per-node sales.</p>
        </div>
        <button className="btn small ghost" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}

      {stats ? (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <span className="kpi-label">Total revenue</span>
              <span className="kpi-value">{formatKs(stats.revenueKs)}</span>
              <span className="kpi-sub">Paid + processing + success</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Keys sold</span>
              <span className="kpi-value">{stats.keysSold.toLocaleString("en-US")}</span>
              <span className="kpi-sub">Fulfilled orders</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Active keys</span>
              <span className="kpi-value">{stats.activeKeys.toLocaleString("en-US")}</span>
              <span className="kpi-sub">Live subscriptions</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Active servers</span>
              <span className="kpi-value">
                {stats.activeServers}
                <small>/{stats.totalServers}</small>
              </span>
              <span className="kpi-sub">Shop nodes online</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Pending orders</span>
              <span className="kpi-value">{stats.pendingOrders.toLocaleString("en-US")}</span>
              <span className="kpi-sub">Awaiting payment</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Customers</span>
              <span className="kpi-value">{stats.users.toLocaleString("en-US")}</span>
              <span className="kpi-sub">Registered users</span>
            </div>
          </div>

          <div className="page-h" style={{ marginTop: 8 }}>
            <div>
              <h2 style={{ fontSize: 16 }}>Revenue by node</h2>
              <p>Keys sold and total revenue per server.</p>
            </div>
            <Link className="btn small ghost" href="/admin">
              Manage servers
            </Link>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Keys sold</th>
                  <th>Active</th>
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
                      <td>{row.activeKeys.toLocaleString("en-US")}</td>
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
          {stats.byServer.length === 0 ? <p className="empty">No servers yet.</p> : null}
        </>
      ) : !error ? (
        <p className="muted">Loading…</p>
      ) : null}
    </>
  );
}
