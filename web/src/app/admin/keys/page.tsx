"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { formatDataGb, formatDuration, formatWhen } from "@/lib/format";

export type AdminKeyItem = {
  id: string;
  orderId: string;
  userId: string;
  serverId: string;
  serverName: string;
  planTitle: string;
  dataGb: number;
  durationDays: number;
  subToken: string;
  subUrl: string;
  vlessKey: string;
  panelEmail: string;
  clientUuid: string;
  status: "active" | "expired" | "pending";
  userLoginMethod: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  telegramId: string;
  orderPaymentMethod: string;
  orderPayeeName: string | null;
  orderTxid: string | null;
  orderAmountKs: number;
  replacementCount?: number;
  lastReplacedAt?: string;
  replacementRequested?: boolean;
  replacementReason?: string | null;
  replacementRequestedAt?: string | null;
  notes?: string;
  createdAt: string;
  expiresAt: string | null;
};

export type ServerOption = {
  id: string;
  name: string;
  region: string;
  isActive: boolean;
};

export type PlanOption = {
  id: string;
  serverId: string;
  title: string;
  dataGb: number;
  durationDays: number;
  priceKs: number;
  isActive: boolean;
};

export default function AdminKeysPage() {
  const [rows, setRows] = useState<AdminKeyItem[]>([]);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [loginMethod, setLoginMethod] = useState("");
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Replace Key Modal state
  const [replaceTarget, setReplaceTarget] = useState<AdminKeyItem | null>(null);
  const [replaceServerId, setReplaceServerId] = useState("");
  const [replacePlanId, setReplacePlanId] = useState("");
  const [replaceResetDuration, setReplaceResetDuration] = useState(false);
  const [replaceReason, setReplaceReason] = useState("Connection / Blocked Key issue");
  const [replaceNote, setReplaceNote] = useState("");
  const [replacing, setReplacing] = useState(false);

  // Edit Customer Notes Modal state
  const [editTarget, setEditTarget] = useState<AdminKeyItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTelegram, setEditTelegram] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (loginMethod) params.set("loginMethod", loginMethod);
    return api<{ keys: AdminKeyItem[]; servers?: ServerOption[]; plans?: PlanOption[] }>(`/api/admin/keys?${params}`)
      .then((r) => {
        setRows(r.keys || []);
        if (r.servers) setServers(r.servers);
        if (r.plans) setPlans(r.plans);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = (text: string, id: string) => {
    void copyText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openReplaceModal = (item: AdminKeyItem) => {
    setReplaceTarget(item);
    setReplaceServerId(item.serverId);
    setReplacePlanId("");
    setReplaceResetDuration(false);
    setReplaceReason(
      item.replacementReason
        ? `Customer request: ${item.replacementReason}`
        : "Connection / Blocked Key issue",
    );
    setReplaceNote("");
  };

  const confirmReplace = async () => {
    if (!replaceTarget) return;
    setReplacing(true);
    setError("");
    try {
      await api(`/api/admin/keys/${replaceTarget.id}/replace`, {
        method: "POST",
        body: JSON.stringify({
          targetServerId: replaceServerId,
          targetPlanId: replacePlanId || undefined,
          resetDuration: replaceResetDuration,
          reason: replaceReason,
          adminNote: replaceNote,
        }),
      });
      setReplaceTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Key replacement failed");
    } finally {
      setReplacing(false);
    }
  };

  const openEditModal = (item: AdminKeyItem) => {
    setEditTarget(item);
    setEditName(item.userName || "");
    setEditPhone(item.userPhone || "");
    setEditEmail(item.userEmail || "");
    setEditTelegram(item.telegramId || "");
    setEditNotes(item.notes || "");
  };

  const confirmSaveNotes = async () => {
    if (!editTarget) return;
    setSavingNote(true);
    setError("");
    try {
      await api(`/api/admin/keys/${editTarget.id}/notes`, {
        method: "POST",
        body: JSON.stringify({
          userName: editName,
          userPhone: editPhone,
          userEmail: editEmail,
          telegramId: editTelegram,
          notes: editNotes,
        }),
      });
      setEditTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingNote(false);
    }
  };

  const stats = {
    total: rows.length,
    active: rows.filter((r) => r.status === "active").length,
    replaced: rows.filter((r) => (r.replacementCount || 0) > 0).length,
    wathanpay: rows.filter((r) => r.userLoginMethod === "wathanpay" || r.orderPaymentMethod?.toLowerCase() === "wathanpay").length,
    google: rows.filter((r) => r.userLoginMethod === "google").length,
    email: rows.filter((r) => r.userLoginMethod === "email").length,
  };

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Keys & Customer Management</h2>
          <p>Track customer login methods, WathanPay payer details, and replace VPN keys for after-sale support.</p>
        </div>
      </div>

      {error ? <p className="err" style={{ marginBottom: 14 }}>{error}</p> : null}

      {/* Summary KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600, textTransform: "uppercase" }}>Total Keys</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", marginTop: 2 }}>{stats.total}</div>
        </div>
        <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "var(--brand-dark)", fontWeight: 600, textTransform: "uppercase" }}>Active Keys</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--brand-dark)", marginTop: 2 }}>{stats.active}</div>
        </div>
        <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600, textTransform: "uppercase" }}>Replaced Keys</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--warning)", marginTop: 2 }}>{stats.replaced}</div>
        </div>
        <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "#1976d2", fontWeight: 600, textTransform: "uppercase" }}>WathanPay Users</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1976d2", marginTop: 2 }}>{stats.wathanpay}</div>
        </div>
        <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "#ea4335", fontWeight: 600, textTransform: "uppercase" }}>Google Users</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#ea4335", marginTop: 2 }}>{stats.google}</div>
        </div>
        <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600, textTransform: "uppercase" }}>Email Users</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", marginTop: 2 }}>{stats.email}</div>
        </div>
      </div>

      {/* Filter toolbar */}
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <input
          className="box"
          placeholder="Search customer name, email, phone, txid, UUID..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <select className="box" value={loginMethod} onChange={(e) => setLoginMethod(e.target.value)}>
          <option value="">All Login Methods</option>
          <option value="wathanpay">WathanPay</option>
          <option value="google">Google</option>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
        </select>
        <select className="box" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="pending">Pending</option>
        </select>
        <button className="btn small" type="submit" disabled={loading}>
          {loading ? "Searching…" : "Filter"}
        </button>
      </form>

      {/* Keys Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer & Login</th>
              <th>Server & Plan</th>
              <th>VLESS Key & Sub URL</th>
              <th>Payment & TxID</th>
              <th>Expiry & Replacements</th>
              <th>Support Notes</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  {loading ? "Loading customer keys…" : "No keys found matching your criteria."}
                </td>
              </tr>
            ) : (
              rows.map((k) => {
                const method = (k.userLoginMethod || "").toLowerCase();
                const badgeColor =
                  method === "wathanpay"
                    ? { bg: "#e3f2fd", text: "#0d47a1", border: "#bbdefb" }
                    : method === "google"
                    ? { bg: "#fce8e6", text: "#c5221f", border: "#fad2cf" }
                    : method === "email"
                    ? { bg: "#f1f8e9", text: "#33691e", border: "#dcedc8" }
                    : { bg: "#ede7f6", text: "#4a148c", border: "#d1c4e9" };

                return (
                  <tr key={k.id}>
                    {/* Customer & Login Method */}
                    <td>
                      <div style={{ fontWeight: 700, color: "var(--navy)", fontSize: 14 }}>
                        {k.userName || "Customer"}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: 6,
                            background: badgeColor.bg,
                            color: badgeColor.text,
                            border: `1px solid ${badgeColor.border}`,
                            textTransform: "capitalize",
                          }}
                        >
                          {method || "Email"}
                        </span>
                        {k.userEmail ? (
                          <span style={{ fontSize: 12, color: "var(--text-2)" }}>{k.userEmail}</span>
                        ) : null}
                      </div>
                      {k.userPhone ? (
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Phone: {k.userPhone}</div>
                      ) : null}
                      {k.telegramId ? (
                        <div style={{ fontSize: 12, color: "#0088cc", marginTop: 2 }}>Telegram: @{k.telegramId}</div>
                      ) : null}
                    </td>

                    {/* Server & Plan */}
                    <td>
                      <div style={{ fontWeight: 650 }}>{k.serverName}</div>
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>
                        {k.planTitle} · {formatDataGb(k.dataGb)}
                      </div>
                    </td>

                    {/* VLESS Key & Sub URL */}
                    <td>
                      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
                        <button
                          type="button"
                          className="btn small"
                          style={{ fontSize: 11, padding: "4px 8px" }}
                          onClick={() => handleCopy(k.vlessKey, `vless-${k.id}`)}
                        >
                          {copiedId === `vless-${k.id}` ? "Copied VLESS" : "Copy VLESS Key"}
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          style={{ fontSize: 11, padding: "4px 8px", background: "var(--bg-soft)", color: "var(--text)" }}
                          onClick={() => handleCopy(k.subUrl, `sub-${k.id}`)}
                        >
                          {copiedId === `sub-${k.id}` ? "Copied Link" : "Sub URL"}
                        </button>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          fontFamily: "monospace",
                          color: "var(--text-2)",
                          maxWidth: 180,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={k.clientUuid}
                      >
                        UUID: {k.clientUuid.slice(0, 13)}…
                      </div>
                    </td>

                    {/* Payment & TxID */}
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {k.orderPaymentMethod}
                      </div>
                      {k.orderPayeeName ? (
                        <div style={{ fontSize: 12, color: "var(--brand-dark)", fontWeight: 550, marginTop: 2 }}>
                          Payer: {k.orderPayeeName}
                        </div>
                      ) : null}
                      {k.orderTxid ? (
                        <div
                          style={{
                            fontSize: 11,
                            fontFamily: "monospace",
                            color: "var(--muted)",
                            maxWidth: 140,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginTop: 2,
                          }}
                          title={k.orderTxid}
                        >
                          Tx: {k.orderTxid}
                        </div>
                      ) : null}
                    </td>

                    {/* Expiry & Replacements */}
                    <td>
                      <span className={`pill ${k.status === "active" ? "on" : "fail"}`}>
                        {k.status}
                      </span>
                      {k.replacementRequested ? (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#0d47a1",
                            background: "#e3f2fd",
                            border: "1px solid #90caf9",
                            borderRadius: 4,
                            padding: "2px 5px",
                            marginTop: 4,
                            display: "inline-block",
                          }}
                          title={`Replacement Reason: ${k.replacementReason || "Requested by customer"}`}
                        >
                          Replacement Requested
                        </div>
                      ) : null}
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>
                        {k.expiresAt ? formatWhen(k.expiresAt) : formatDuration(k.durationDays)}
                      </div>
                      {(k.replacementCount || 0) > 0 ? (
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "var(--warning)",
                            marginTop: 4,
                            display: "inline-block",
                            background: "#fff8e1",
                            padding: "1px 6px",
                            borderRadius: 4,
                            border: "1px solid #ffe082",
                          }}
                          title={`Last replaced: ${k.lastReplacedAt ? formatWhen(k.lastReplacedAt) : ""}`}
                        >
                          Replaced {k.replacementCount}x
                        </div>
                      ) : null}
                    </td>

                    {/* Support Notes */}
                    <td style={{ maxWidth: 160 }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: k.notes ? "var(--text)" : "var(--muted)",
                          whiteSpace: "pre-wrap",
                          maxHeight: 48,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {k.notes || "No notes"}
                      </div>
                    </td>

                    {/* Action buttons */}
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="btn small"
                          style={{ background: "#fff3e0", color: "#e65100", border: "1px solid #ffcc80" }}
                          onClick={() => openReplaceModal(k)}
                          title="Re-issue a fresh key on the 3x-ui server"
                        >
                          Replace Key
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          style={{ background: "var(--bg-soft)", color: "var(--text)" }}
                          onClick={() => openEditModal(k)}
                          title="Edit customer contact and support notes"
                        >
                          Notes
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Replace Key Modal */}
      {replaceTarget ? (
        <div className="busy" style={{ background: "rgba(16, 42, 67, 0.45)" }}>
          <div
            style={{
              background: "var(--white)",
              borderRadius: 16,
              padding: 24,
              width: "min(520px, 92vw)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <h3 style={{ fontSize: 18, marginBottom: 8, color: "var(--navy)" }}>
              Replace Key for {replaceTarget.userName || "Customer"}
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 16, lineHeight: 1.45 }}>
              Re-issue a fresh VLESS key. You can keep the current server &amp; plan or switch to another node and package.
            </p>

            {/* Current Key Summary */}
            <div
              style={{
                background: "var(--bg-soft)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 12,
                color: "var(--text)",
                marginBottom: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong>Current:</strong> {replaceTarget.serverName} · {replaceTarget.planTitle} ({formatDataGb(replaceTarget.dataGb)})
              </div>
              <span className="pill on" style={{ fontSize: 10 }}>
                {replaceTarget.status}
              </span>
            </div>

            {/* Select Target Server / Node */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Target Node / Server
              </label>
              <select
                className="box"
                value={replaceServerId}
                onChange={(e) => {
                  setReplaceServerId(e.target.value);
                  setReplacePlanId("");
                }}
                style={{ width: "100%" }}
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.region}) {!s.isActive ? "[Inactive]" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Select Target Plan / Package */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Package / Plan Selection
              </label>
              <select
                className="box"
                value={replacePlanId}
                onChange={(e) => setReplacePlanId(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">
                  Keep Current Package Limit ({formatDataGb(replaceTarget.dataGb)})
                </option>
                {plans
                  .filter((p) => p.serverId === replaceServerId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} · {formatDataGb(p.dataGb)} ({formatDuration(p.durationDays)})
                    </option>
                  ))}
              </select>
            </div>

            {/* Duration Option */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={replaceResetDuration}
                  onChange={(e) => setReplaceResetDuration(e.target.checked)}
                />
                Reset package duration from today (instead of keeping remaining days)
              </label>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Reason for replacement
              </label>
              <select
                className="box"
                value={replaceReason}
                onChange={(e) => setReplaceReason(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="Connection / Blocked Key issue">Connection / Blocked Key issue</option>
                <option value="Node / Server change requested">Node / Server change requested</option>
                <option value="Package upgrade / Plan adjustment">Package upgrade / Plan adjustment</option>
                <option value="Customer reported speed drop / IP issue">Speed drop / IP issue</option>
                <option value="Key compromised / Device limit reset">Key compromised / Device reset</option>
                <option value="Customer requested replacement">Customer requested replacement</option>
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Admin Note (Optional)
              </label>
              <input
                className="box"
                placeholder="e.g. switched to Japan SG-1 via Telegram support"
                value={replaceNote}
                onChange={(e) => setReplaceNote(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn small"
                style={{ background: "var(--bg-soft)", color: "var(--text)" }}
                onClick={() => setReplaceTarget(null)}
                disabled={replacing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn small"
                onClick={confirmReplace}
                disabled={replacing}
              >
                {replacing ? "Generating Key…" : "Confirm & Replace Key"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Edit Customer Notes Modal */}
      {editTarget ? (
        <div className="busy" style={{ background: "rgba(16, 42, 67, 0.45)" }}>
          <div
            style={{
              background: "var(--white)",
              borderRadius: 16,
              padding: 24,
              width: "min(480px, 92vw)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <h3 style={{ fontSize: 18, marginBottom: 8, color: "var(--navy)" }}>
              Customer Details & Support Notes
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Name</label>
                <input
                  className="box"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Phone</label>
                <input
                  className="box"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Email</label>
                <input
                  className="box"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Telegram ID</label>
                <input
                  className="box"
                  placeholder="@username"
                  value={editTelegram}
                  onChange={(e) => setEditTelegram(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Support Notes / Issue History
              </label>
              <textarea
                className="box"
                rows={4}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Log customer complaints, replacement history, or special preferences..."
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn small"
                style={{ background: "var(--bg-soft)", color: "var(--text)" }}
                onClick={() => setEditTarget(null)}
                disabled={savingNote}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn small"
                onClick={confirmSaveNotes}
                disabled={savingNote}
              >
                {savingNote ? "Saving…" : "Save Details"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
