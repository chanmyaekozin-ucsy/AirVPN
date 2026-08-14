"use client";

import { useEffect, useRef, useState } from "react";
import { FlagIcon } from "@/components/FlagIcon";
import { api } from "@/lib/api";
import { countryCodeFor, countryLabel } from "@/lib/flags";
import { formatKs } from "@/lib/format";
import { isServerProvisionReady } from "@/lib/server-config";
import type { AdminStats, ServerStats } from "@/lib/stats";
import type { Server, ShopSettings } from "@/lib/types";

type AdminServer = Server & { configured?: boolean };

type Draft = {
  name: string;
  nameMy: string;
  region: string;
  panelUrl: string;
  panelUsername: string;
  panelPassword: string;
  panelSecret: string;
  panelInboundId: string;
  panelVerifySsl: boolean;
  host: string;
  port: string;
  vlessPbk: string;
  vlessSid: string;
  vlessSni: string;
  vlessFp: string;
  vlessFlow: string;
  vlessSecurity: string;
  vlessSpx: string;
};

function toDraft(server: Server): Draft {
  return {
    name: server.name,
    nameMy: server.nameMy,
    region: server.region,
    panelUrl: server.panelUrl,
    panelUsername: server.panelUsername,
    panelPassword: server.panelPassword,
    panelSecret: server.panelSecret,
    panelInboundId: String(server.panelInboundId),
    panelVerifySsl: server.panelVerifySsl,
    host: server.host,
    port: String(server.port),
    vlessPbk: server.vlessPbk,
    vlessSid: server.vlessSid,
    vlessSni: server.vlessSni,
    vlessFp: server.vlessFp,
    vlessFlow: server.vlessFlow,
    vlessSecurity: server.vlessSecurity,
    vlessSpx: server.vlessSpx,
  };
}

function moveItem<T>(list: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function AdminServersPage() {
  const [servers, setServers] = useState<AdminServer[]>([]);
  const [settings, setSettings] = useState<ShopSettings>({
    subPublicBaseUrl: "",
    deletedPlanIds: [],
  });
  const [subBaseDraft, setSubBaseDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provLogs, setProvLogs] = useState<string[]>([]);
  const [provPhase, setProvPhase] = useState("");
  const logEndRef = useRef<HTMLPreElement | null>(null);
  const [prov, setProv] = useState({
    ip: "",
    password: "",
    mode: "fresh" as "fresh" | "reuse",
    serverId: "",
    name: "",
    region: "US",
    panelUrl: "",
    panelUser: "dominate",
    panelPass: "",
    reuseInboundId: "",
  });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [serverStats, setServerStats] = useState<Record<string, ServerStats>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const orderDirty = useRef(false);
  const serversRef = useRef(servers);
  serversRef.current = servers;

  const load = () =>
    Promise.all([
      api<{ servers: AdminServer[]; settings: ShopSettings }>("/api/admin/servers"),
      api<{ stats: AdminStats }>("/api/admin/stats").catch(() => null),
    ]).then(([r, statsRes]) => {
      setServers(r.servers);
      setSettings(r.settings);
      setSubBaseDraft(r.settings.subPublicBaseUrl || "");
      if (statsRes?.stats) {
        const map: Record<string, ServerStats> = {};
        for (const row of statsRes.stats.byServer) map[row.serverId] = row;
        setServerStats(map);
      }
    });

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  const persistOrder = async (ordered: AdminServer[]) => {
    setError("");
    try {
      const res = await api<{ servers: AdminServer[] }>("/api/admin/servers", {
        method: "PATCH",
        body: JSON.stringify({ orderedIds: ordered.map((s) => s.id) }),
      });
      setServers(res.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed");
      await load();
    }
  };

  const onDragStart = (index: number, id: string) => {
    dragFrom.current = index;
    orderDirty.current = false;
    setDragId(id);
  };

  const onDragOver = (index: number) => {
    const from = dragFrom.current;
    if (from === null || from === index) return;
    setServers((prev) => {
      const next = moveItem(prev, from, index);
      dragFrom.current = index;
      orderDirty.current = true;
      return next;
    });
  };

  const onDragEnd = () => {
    const dirty = orderDirty.current;
    const ordered = dirty ? serversRef.current : null;
    dragFrom.current = null;
    orderDirty.current = false;
    setDragId(null);
    if (ordered) void persistOrder(ordered);
  };

  const patchActive = async (id: string, isActive: boolean) => {
    setError("");
    try {
      await api("/api/admin/servers", { method: "PATCH", body: JSON.stringify({ id, isActive }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const saveSettings = async () => {
    setError("");
    setOk("");
    setSaving(true);
    try {
      const res = await api<{ settings: ShopSettings }>("/api/admin/servers", {
        method: "PATCH",
        body: JSON.stringify({ subPublicBaseUrl: subBaseDraft.trim() }),
      });
      setSettings(res.settings);
      setOk("Subscription base URL saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const el = logEndRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [provLogs]);

  const runProvision = async () => {
    setError("");
    setOk("");
    if (!prov.ip.trim() || !prov.password) {
      setError("IP and root password are required.");
      return;
    }
    setProvisioning(true);
    setProvLogs([]);
    setProvPhase("starting");
    try {
      const res = await fetch("/api/admin/servers/provision", {
        method: "POST",
        headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
        body: JSON.stringify({
          ip: prov.ip.trim(),
          password: prov.password,
          mode: prov.mode,
          serverId: prov.serverId.trim() || undefined,
          name: prov.name.trim() || undefined,
          region: prov.region,
          panelUrl: prov.panelUrl.trim() || undefined,
          panelUser: prov.panelUser.trim() || "dominate",
          panelPass: prov.panelPass,
          reuseInboundId: prov.reuseInboundId.trim() || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line) continue;
          const event = JSON.parse(line) as
            | { type: "log"; line: string }
            | { type: "status"; phase: string }
            | { type: "done"; server: AdminServer }
            | { type: "error"; message: string };

          if (event.type === "log") {
            setProvLogs((prev) => [...prev.slice(-400), event.line]);
          } else if (event.type === "status") {
            setProvPhase(event.phase);
          } else if (event.type === "done") {
            finished = true;
            setOk(
              `Provisioned ${event.server.name} (${event.server.id}) — panel ready. Run Test to verify.`,
            );
            setProv((p) => ({ ...p, password: "", panelPass: "" }));
            setProvPhase("done");
            await load();
          } else if (event.type === "error") {
            finished = true;
            setProvPhase("failed");
            throw new Error(event.message);
          }
        }
      }

      if (buffer.trim()) {
        const event = JSON.parse(buffer.trim()) as { type: string; message?: string; server?: AdminServer };
        if (event.type === "error" && event.message) throw new Error(event.message);
        if (event.type === "done" && event.server) {
          setOk(
            `Provisioned ${event.server.name} (${event.server.id}) — panel ready. Run Test to verify.`,
          );
          setProv((p) => ({ ...p, password: "", panelPass: "" }));
          setProvPhase("done");
          await load();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provisioning failed");
      setProvPhase((p) => (p === "done" ? p : "failed"));
    } finally {
      setProvisioning(false);
    }
  };

  const startEdit = (server: Server) => {
    setError("");
    setOk("");
    setEditingId(server.id);
    setDraft(toDraft(server));
  };

  const testServer = async (server: Server) => {
    setError("");
    setOk("");
    setTestingId(server.id);
    try {
      const res = await api<{
        ok: true;
        inboundId: number;
        protocol: string;
        port: number;
        remark: string;
        clientCount: number;
        ms: number;
      }>("/api/admin/servers/test", {
        method: "POST",
        body: JSON.stringify({ id: server.id }),
      });
      setOk(
        `Panel OK for ${server.name}: inbound #${res.inboundId} (${res.protocol || "vless"}) port ${res.port}, ${res.clientCount} clients · ${res.ms}ms`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Panel test failed");
    } finally {
      setTestingId(null);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async () => {
    if (!editingId || !draft) return;
    setError("");
    setOk("");
    setSaving(true);
    try {
      await api("/api/admin/servers", {
        method: "PATCH",
        body: JSON.stringify({
          id: editingId,
          name: draft.name.trim(),
          nameMy: draft.nameMy.trim(),
          region: draft.region.trim().toUpperCase(),
          panelUrl: draft.panelUrl.trim(),
          panelUsername: draft.panelUsername.trim(),
          panelPassword: draft.panelPassword,
          panelSecret: draft.panelSecret.trim(),
          panelInboundId: Number(draft.panelInboundId) || 1,
          panelVerifySsl: draft.panelVerifySsl,
          host: draft.host.trim(),
          port: Number(draft.port) || 443,
          vlessPbk: draft.vlessPbk.trim(),
          vlessSid: draft.vlessSid.trim(),
          vlessSni: draft.vlessSni.trim(),
          vlessFp: draft.vlessFp.trim() || "chrome",
          vlessFlow: draft.vlessFlow.trim(),
          vlessSecurity: draft.vlessSecurity.trim() || "reality",
          vlessSpx: draft.vlessSpx.trim() || "/",
        }),
      });
      await load();
      setOk("Server panel settings saved.");
      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Servers</h2>
          <p>Shop regions and 3x-ui VLESS provisioning per server. Drag rows to reorder.</p>
        </div>
      </div>
      {error ? <p className="err">{error}</p> : null}
      {ok ? <p className="ok">{ok}</p> : null}

      <div className="account-card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>Subscription base URL</h2>
        <p className="hint">
          Public shop origin used in delivered sub links (e.g. https://shop.example.com). Links become{" "}
          <code>/sub/&lt;token&gt;</code> on this host.
        </p>
        <label className="field">
          subPublicBaseUrl
          <input
            value={subBaseDraft}
            onChange={(e) => setSubBaseDraft(e.target.value)}
            placeholder="https://your-shop-domain"
          />
        </label>
        <button className="btn small" type="button" disabled={saving} onClick={() => void saveSettings()}>
          Save base URL
        </button>
        {settings.subPublicBaseUrl ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Current: {settings.subPublicBaseUrl}
          </p>
        ) : null}
      </div>

      <div className="deploy-card">
        <header>
          <div>
            <h2>Deploy node</h2>
            <p>Connect over SSH, set up 3x-ui, then register this shop server automatically.</p>
          </div>
          {provisioning ? (
            <span className="pill on">
              {provPhase === "connecting"
                ? "Connecting…"
                : provPhase === "registering"
                  ? "Registering…"
                  : "Installing…"}
            </span>
          ) : provPhase === "done" ? (
            <span className="pill on">Done</span>
          ) : provPhase === "failed" ? (
            <span className="pill">Failed</span>
          ) : null}
        </header>

        <div className="deploy-section" style={{ borderTop: 0, marginTop: 0, paddingTop: 8 }}>
          <h3>Install mode</h3>
          <div className="seg" role="group" aria-label="Install mode">
            <button
              type="button"
              className={prov.mode === "fresh" ? "on" : ""}
              disabled={provisioning}
              onClick={() => setProv({ ...prov, mode: "fresh" })}
            >
              <span className="seg-title">Force</span>
              <span className="seg-desc">Fresh 3x-ui install. Resets panel login on the VPS.</span>
            </button>
            <button
              type="button"
              className={prov.mode === "reuse" ? "on" : ""}
              disabled={provisioning}
              onClick={() => setProv({ ...prov, mode: "reuse" })}
            >
              <span className="seg-title">Reuse</span>
              <span className="seg-desc">Keep existing panel. Add inbound and register here.</span>
            </button>
          </div>
        </div>

        <div className="deploy-section">
          <h3>VPS access</h3>
          <div className="form-grid">
            <label className="field">
              IP address
              <input
                value={prov.ip}
                onChange={(e) => setProv({ ...prov, ip: e.target.value })}
                placeholder="23.94.229.118"
                autoComplete="off"
                disabled={provisioning}
              />
            </label>
            <label className="field">
              Root password
              <input
                type="password"
                value={prov.password}
                onChange={(e) => setProv({ ...prov, password: e.target.value })}
                autoComplete="new-password"
                disabled={provisioning}
              />
            </label>
          </div>
        </div>

        <div className="deploy-section">
          <h3>Shop server</h3>
          <div className="form-grid">
            <label className="field">
              Server id
              <input
                value={prov.serverId}
                onChange={(e) => setProv({ ...prov, serverId: e.target.value })}
                placeholder="us2"
                disabled={provisioning}
              />
            </label>
            <label className="field">
              Region
              <select
                value={prov.region}
                onChange={(e) => setProv({ ...prov, region: e.target.value })}
                disabled={provisioning}
              >
                <option value="US">United States</option>
                <option value="SG">Singapore</option>
              </select>
            </label>
            <label className="field span-2">
              Display name
              <input
                value={prov.name}
                onChange={(e) => setProv({ ...prov, name: e.target.value })}
                placeholder="United States - 2"
                disabled={provisioning}
              />
            </label>
          </div>
        </div>

        {prov.mode === "reuse" ? (
          <div className="deploy-section">
            <h3>Existing panel</h3>
            <div className="deploy-panel">
              <div className="form-grid">
                <label className="field span-2">
                  Panel URL
                  <input
                    value={prov.panelUrl}
                    onChange={(e) => setProv({ ...prov, panelUrl: e.target.value })}
                    placeholder="http://IP:PORT/secret"
                    disabled={provisioning}
                  />
                </label>
                <label className="field">
                  Panel user
                  <input
                    value={prov.panelUser}
                    onChange={(e) => setProv({ ...prov, panelUser: e.target.value })}
                    disabled={provisioning}
                  />
                </label>
                <label className="field">
                  Panel password
                  <input
                    type="password"
                    value={prov.panelPass}
                    onChange={(e) => setProv({ ...prov, panelPass: e.target.value })}
                    disabled={provisioning}
                  />
                </label>
                <label className="field">
                  Reuse inbound ID
                  <input
                    value={prov.reuseInboundId}
                    onChange={(e) => setProv({ ...prov, reuseInboundId: e.target.value })}
                    placeholder="Leave empty to create new"
                    disabled={provisioning}
                  />
                </label>
              </div>
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                URL and password are optional when `/etc/x-ui/install-result.env` exists on the VPS.
              </p>
            </div>
          </div>
        ) : null}

        <div className="deploy-foot">
          <p className="muted">
            {provisioning
              ? "Live install log below. Keep this tab open until it finishes."
              : "Usually 2–5 minutes. The node appears in the table when done."}
          </p>
          <button
            className="btn"
            type="button"
            disabled={provisioning || !prov.ip.trim() || !prov.password}
            onClick={() => void runProvision()}
          >
            {provisioning
              ? "Deploying…"
              : prov.mode === "fresh"
                ? "Force deploy"
                : "Reuse & register"}
          </button>
        </div>

        {provLogs.length > 0 || provisioning ? (
          <div className="deploy-log" aria-live="polite">
            <div className="deploy-log-head">
              <span>Live status</span>
              {provisioning ? <span className="deploy-log-pulse" /> : null}
            </div>
            <pre className="deploy-log-body" ref={logEndRef}>
              {provLogs.length ? provLogs.join("\n") : "Waiting for output…"}
            </pre>
          </div>
        ) : null}
      </div>

      {draft && editingId ? (
        <div className="account-card" style={{ marginBottom: 16 }}>
          <div className="page-h" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 16 }}>Configure VLESS / panel</h2>
              <p>Used when a paid order is fulfilled — not read from .env.</p>
            </div>
          </div>

          <div className="toolbar" style={{ marginBottom: 0, alignItems: "flex-end" }}>
            <span style={{ paddingBottom: 18 }}>
              <FlagIcon
                region={draft.region}
                name={draft.name}
                slug={editingId || ""}
                id={editingId || ""}
                size={36}
              />
            </span>
            <label className="field" style={{ flex: 1 }}>
              Name
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Name (MY)
              <input value={draft.nameMy} onChange={(e) => setDraft({ ...draft, nameMy: e.target.value })} />
            </label>
            <label className="field" style={{ width: 100 }}>
              Region
              <input value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} />
            </label>
          </div>

          <label className="field">
            Panel URL
            <input
              value={draft.panelUrl}
              onChange={(e) => setDraft({ ...draft, panelUrl: e.target.value })}
              placeholder="https://panel.example.com:2053"
            />
          </label>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <label className="field" style={{ flex: 1 }}>
              Username
              <input
                value={draft.panelUsername}
                onChange={(e) => setDraft({ ...draft, panelUsername: e.target.value })}
                autoComplete="off"
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Password
              <input
                type="password"
                value={draft.panelPassword}
                onChange={(e) => setDraft({ ...draft, panelPassword: e.target.value })}
                autoComplete="new-password"
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Secret (API token)
              <input
                value={draft.panelSecret}
                onChange={(e) => setDraft({ ...draft, panelSecret: e.target.value })}
                placeholder="Optional Bearer token"
                autoComplete="off"
              />
            </label>
          </div>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <label className="field" style={{ flex: 1 }}>
              Inbound ID
              <input
                type="number"
                min={1}
                value={draft.panelInboundId}
                onChange={(e) => setDraft({ ...draft, panelInboundId: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: 2 }}>
              Host (VLESS)
              <input
                value={draft.host}
                onChange={(e) => setDraft({ ...draft, host: e.target.value })}
                placeholder="vpn.example.com"
              />
            </label>
            <label className="field" style={{ width: 110 }}>
              Port
              <input
                type="number"
                min={1}
                value={draft.port}
                onChange={(e) => setDraft({ ...draft, port: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            VLESS public key (pbk)
            <input
              value={draft.vlessPbk}
              onChange={(e) => setDraft({ ...draft, vlessPbk: e.target.value })}
            />
          </label>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <label className="field" style={{ flex: 1 }}>
              Short ID (sid)
              <input value={draft.vlessSid} onChange={(e) => setDraft({ ...draft, vlessSid: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              SNI
              <input value={draft.vlessSni} onChange={(e) => setDraft({ ...draft, vlessSni: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Fingerprint
              <input value={draft.vlessFp} onChange={(e) => setDraft({ ...draft, vlessFp: e.target.value })} />
            </label>
          </div>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}>
              Flow
              <input value={draft.vlessFlow} onChange={(e) => setDraft({ ...draft, vlessFlow: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}>
              Security
              <input
                value={draft.vlessSecurity}
                onChange={(e) => setDraft({ ...draft, vlessSecurity: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}>
              Spider X
              <input value={draft.vlessSpx} onChange={(e) => setDraft({ ...draft, vlessSpx: e.target.value })} />
            </label>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontWeight: 650, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={draft.panelVerifySsl}
              onChange={(e) => setDraft({ ...draft, panelVerifySsl: e.target.checked })}
            />
            Verify panel SSL
          </label>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button
              className="btn small"
              type="button"
              disabled={saving || !draft.name.trim()}
              onClick={() => void saveEdit()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              className="btn small ghost"
              type="button"
              disabled={saving || testingId === editingId}
              onClick={() =>
                void testServer({
                  ...servers.find((s) => s.id === editingId)!,
                  ...draft,
                  panelInboundId: Number(draft.panelInboundId) || 1,
                  port: Number(draft.port) || 443,
                  panelVerifySsl: draft.panelVerifySsl,
                })
              }
            >
              {testingId === editingId ? "Testing…" : "Test connection"}
            </button>
            <button className="btn small ghost" type="button" disabled={saving} onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="drag-cell" aria-label="Reorder" />
              <th>Server</th>
              <th>Region</th>
              <th>Keys sold</th>
              <th>Revenue</th>
              <th>Panel</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {servers.map((server, index) => {
              const code = countryCodeFor({
                region: server.region,
                name: server.name,
                slug: server.slug,
                id: server.id,
              });
              const ready = server.configured ?? isServerProvisionReady(server);
              const st = serverStats[server.id];
              return (
                <tr
                  key={server.id}
                  className={dragId === server.id ? "dragging" : undefined}
                  onDragOver={(e) => {
                    e.preventDefault();
                    onDragOver(index);
                  }}
                  onDrop={(e) => e.preventDefault()}
                >
                  <td className="drag-cell">
                    <button
                      type="button"
                      className="drag-handle"
                      title="Drag to reorder"
                      aria-label={`Reorder ${server.name}`}
                      draggable
                      onDragStart={() => onDragStart(index, server.id)}
                      onDragEnd={onDragEnd}
                    >
                      ⋮⋮
                    </button>
                  </td>
                  <td>
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
                        <div className="muted">{server.slug}</div>
                      </span>
                    </span>
                  </td>
                  <td>{countryLabel(code) || server.region}</td>
                  <td>
                    {st ? (
                      <>
                        <b>{st.keysSold}</b>
                        <div className="muted">{st.activeKeys} active</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{st ? formatKs(st.revenueKs) : "—"}</td>
                  <td>
                    <span className={`pill ${ready ? "on" : "off"}`}>{ready ? "Ready" : "Setup"}</span>
                  </td>
                  <td>
                    <button
                      className={`pill ${server.isActive ? "on" : "off"}`}
                      type="button"
                      onClick={() => void patchActive(server.id, !server.isActive)}
                    >
                      {server.isActive ? "On" : "Off"}
                    </button>
                  </td>
                  <td>
                    <div className="toolbar" style={{ marginBottom: 0, gap: 6 }}>
                      <button
                        className="btn small ghost"
                        type="button"
                        disabled={testingId === server.id || !ready}
                        onClick={() => void testServer(server)}
                      >
                        {testingId === server.id ? "Testing…" : "Test"}
                      </button>
                      <button className="btn small ghost" type="button" onClick={() => startEdit(server)}>
                        Configure
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
