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
    // VLESS inbound config
    vlessPortMode: "443" as "443" | "random" | "custom",
    vlessPortCustom: "",
    panelPort: "",
    sni: "www.amazon.com",
  });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [serverStats, setServerStats] = useState<Record<string, ServerStats>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const orderDirty = useRef(false);
  const serversRef = useRef(servers);
  serversRef.current = servers;

  // Delete modal state
  const [deleteModal, setDeleteModal] = useState<{
    server: AdminServer;
    mode: "pick" | "uninstall";
    ip: string;
    password: string;
    running: boolean;
    logs: string[];
    phase: string;
  } | null>(null);

  // Deploy form visibility
  const [deployOpen, setDeployOpen] = useState(false);

  // Configure card tab ("settings" | "keys")
  const [configTab, setConfigTab] = useState<"settings" | "keys">("settings");

  // SSH modal (for restart / reinstall)
  const [sshModal, setSshModal] = useState<{
    action: "restart" | "status";
    ip: string;
    password: string;
    running: boolean;
    logs: string[];
    done: boolean;
  } | null>(null);

  // Keys tab data
  type KeyRow = {
    id: string; orderId: string; userId: string; panelEmail: string; clientUuid: string;
    planTitle: string; dataGb: number; durationDays: number; status: string;
    createdAt: string; expiresAt: string | null; vlessKey: string; subUrl: string;
    liveEnabled: boolean | null; usedGb: number | null; remainingGb: number | null;
    quotaBytes: number | null; usedBytes: number | null; liveExpiry: number | null;
  };
  const [keysList, setKeysList] = useState<KeyRow[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState("");
  const [keysServerId, setKeysServerId] = useState("");
  const [replacingKey, setReplacingKey] = useState<string | null>(null);
  const [revokingKey, setRevokingKey] = useState<string | null>(null);
  const [creatingTestKey, setCreatingTestKey] = useState(false);
  const [testKeyResult, setTestKeyResult] = useState<{ vlessKey: string; subUrl: string; expiresAt: string } | null>(null);

  // Panel push draft (port + SNI override)
  const [pushDraft, setPushDraft] = useState<{ port: string; sni: string } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [syncing, setSyncing] = useState(false);

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
      const resolvedVlessPort =
        prov.vlessPortMode === "443"
          ? "443"
          : prov.vlessPortMode === "random"
            ? ""
            : prov.vlessPortCustom.trim() || "";

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
          vlessPort: resolvedVlessPort || undefined,
          panelPort: prov.panelPort.trim() || undefined,
          sni: prov.sni.trim() || undefined,
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
            setDeployOpen(false);
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

  const openDeleteModal = (server: AdminServer) => {
    setDeleteModal({ server, mode: "pick", ip: server.host || "", password: "", running: false, logs: [], phase: "" });
  };

  const closeDeleteModal = () => setDeleteModal(null);

  const runDelete = async (mode: "record" | "uninstall") => {
    if (!deleteModal) return;
    const { server } = deleteModal;

    if (mode === "record") {
      setDeleteModal((d) => d && { ...d, running: true, logs: ["Removing record…"] });
      try {
        const res = await fetch(`/api/admin/servers/${server.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "record" }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        setOk(`Server "${server.name}" removed.`);
        setDeleteModal(null);
        await load();
      } catch (err) {
        setDeleteModal((d) => d && { ...d, running: false, logs: [...(d?.logs ?? []), `Error: ${err instanceof Error ? err.message : String(err)}`] });
      }
      return;
    }

    // uninstall mode
    if (!deleteModal.ip.trim() || !deleteModal.password) {
      setDeleteModal((d) => d && { ...d, logs: ["IP and password are required."] });
      return;
    }
    setDeleteModal((d) => d && { ...d, running: true, logs: [], phase: "connecting", mode: "uninstall" });
    try {
      const res = await fetch(`/api/admin/servers/${server.id}`, {
        method: "DELETE",
        headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "uninstall", ip: deleteModal.ip.trim(), password: deleteModal.password }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line) continue;
          const evt = JSON.parse(line) as { type: string; line?: string; phase?: string; message?: string };
          if (evt.type === "log") setDeleteModal((d) => d && { ...d, logs: [...d.logs.slice(-200), evt.line!] });
          else if (evt.type === "status") setDeleteModal((d) => d && { ...d, phase: evt.phase! });
          else if (evt.type === "done") {
            setOk(`Server "${server.name}" uninstalled and removed.`);
            setDeleteModal(null);
            await load();
            return;
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        }
      }
    } catch (err) {
      setDeleteModal((d) => d && { ...d, running: false, logs: [...(d?.logs ?? []), `Error: ${err instanceof Error ? err.message : String(err)}`] });
    }
  };

  const startEdit = (server: Server) => {
    setError("");
    setOk("");
    setEditingId(server.id);
    setDraft(toDraft(server));
    setConfigTab("settings");
    setPushDraft(null);
    setKeysList([]);
    setKeysError("");
    // Load keys in background — don't block UI
    void loadKeys(server.id);
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
    setConfigTab("settings");
    setPushDraft(null);
    setKeysList([]);
    setKeysError("");
  };

  /** Pull live inbound fields from the panel and pre-fill the Configure form. */
  const syncFromPanel = async () => {
    if (!editingId) return;
    setSyncing(true);
    setError("");
    try {
      const res = await api<{ ok: boolean; fields: Record<string, unknown>; error?: string }>(
        `/api/admin/servers/${editingId}/panel-sync`,
      );
      if (!res.ok) throw new Error(res.error ?? "Sync failed");
      const f = res.fields as {
        port: number; vlessPbk: string; vlessSid: string; vlessSni: string;
        vlessFp: string; vlessFlow: string; vlessSecurity: string; vlessSpx: string;
      };
      setDraft((d) => d && {
        ...d,
        port: String(f.port ?? d.port),
        vlessPbk: f.vlessPbk || d.vlessPbk,
        vlessSid: f.vlessSid || d.vlessSid,
        vlessSni: f.vlessSni || d.vlessSni,
        vlessFp: f.vlessFp || d.vlessFp,
        vlessFlow: f.vlessFlow || d.vlessFlow,
        vlessSecurity: f.vlessSecurity || d.vlessSecurity,
        vlessSpx: f.vlessSpx || d.vlessSpx,
      });
      setOk("Synced from panel ✓ — review and save.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  /** Push port + SNI changes to the live 3x-ui panel. */
  const pushPortSni = async () => {
    if (!editingId || !pushDraft) return;
    const newPort = Number(pushDraft.port);
    const newSni = pushDraft.sni.trim();
    if (!newPort || !newSni) { setError("Port and SNI are required."); return; }

    setPushing(true);
    setError("");
    try {
      const res = await api<{ ok: boolean; error?: string }>(
        `/api/admin/servers/${editingId}/panel-sync`,
        { method: "POST", body: JSON.stringify({ port: newPort, sni: newSni }) },
      );
      if (!res.ok) throw new Error(res.error ?? "Push failed");
      setDraft((d) => d && { ...d, port: String(newPort), vlessSni: newSni });
      setPushDraft(null);
      setOk(`Port ${newPort} and SNI ${newSni} pushed to panel ✓`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushing(false);
    }
  };

  /** Stream SSH command (restart / status) to the sshModal log. */
  const runSshAction = async () => {
    if (!sshModal || !editingId) return;
    const { action, ip, password } = sshModal;
    if (!ip || !password) { setSshModal((m) => m && { ...m, logs: ["IP and password required."] }); return; }

    setSshModal((m) => m && { ...m, running: true, logs: [], done: false });
    try {
      const res = await fetch(`/api/admin/servers/${editingId}/ssh-exec`, {
        method: "POST",
        headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
        body: JSON.stringify({ action, ip, password }),
      });
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n"); buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line) continue;
          const evt = JSON.parse(line) as { type: string; line?: string; exitCode?: number; message?: string };
          if (evt.type === "log") setSshModal((m) => m && { ...m, logs: [...m.logs.slice(-300), evt.line!] });
          else if (evt.type === "done") setSshModal((m) => m && { ...m, running: false, done: true });
          else if (evt.type === "error") setSshModal((m) => m && { ...m, running: false, logs: [...(m?.logs ?? []), `Error: ${evt.message}`] });
        }
      }
    } catch (err) {
      setSshModal((m) => m && { ...m, running: false, logs: [...(m?.logs ?? []), `Error: ${err instanceof Error ? err.message : String(err)}`] });
    }
  };

  /** Load keys for the current server (with live panel stats). */
  const loadKeys = async (serverId: string) => {
    setKeysLoading(true);
    setKeysError("");
    setKeysServerId(serverId);
    try {
      const res = await api<{ keys: KeyRow[]; panelOnline: boolean }>(
        `/api/admin/servers/${serverId}/keys`,
      );
      setKeysList(res.keys);
    } catch (err) {
      setKeysError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setKeysLoading(false);
    }
  };

  /** Replace a key — delete old client, provision new one. */
  const replaceKey = async (keyId: string) => {
    if (!editingId) return;
    if (!window.confirm("Replace this key? The old VLESS link will stop working immediately.")) return;
    setReplacingKey(keyId);
    try {
      const res = await api<{ ok: boolean; vlessKey: string; error?: string }>(
        `/api/admin/servers/${editingId}/keys/replace`,
        { method: "POST", body: JSON.stringify({ subscriptionId: keyId }) },
      );
      if (!res.ok) throw new Error(res.error ?? "Replace failed");
      setOk("Key replaced ✓");
      await loadKeys(editingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replace failed");
    } finally {
      setReplacingKey(null);
    }
  };

  /** Revoke a key — disable on panel + mark expired in store. */
  const revokeKey = async (keyId: string) => {
    if (!editingId) return;
    if (!window.confirm("Revoke this key? This will permanently disable the client on the panel.")) return;
    setRevokingKey(keyId);
    try {
      await api(`/api/admin/servers/${editingId}/keys/revoke`, {
        method: "POST", body: JSON.stringify({ subscriptionId: keyId }),
      });
      setOk("Key revoked ✓");
      await loadKeys(editingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setRevokingKey(null);
    }
  };

  /** Create a temporary test key on this server. */
  const createTestKey = async () => {
    if (!editingId) return;
    setCreatingTestKey(true);
    setTestKeyResult(null);
    setError("");
    try {
      const res = await api<{ ok: boolean; vlessKey: string; subUrl: string; expiresAt: string; error?: string }>(
        `/api/admin/servers/${editingId}/keys/test`,
        { method: "POST", body: JSON.stringify({ dataGb: 1, expiryHours: 24 }) },
      );
      if (!res.ok) throw new Error(res.error ?? "Failed");
      setTestKeyResult({ vlessKey: res.vlessKey, subUrl: res.subUrl, expiresAt: res.expiresAt });
      setOk("Test key created ✓ — copy the link below.");
      // Refresh keys tab
      void loadKeys(editingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test key creation failed");
    } finally {
      setCreatingTestKey(false);
    }
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
        <button
          className="btn small"
          type="button"
          style={{ whiteSpace: "nowrap" }}
          onClick={() => setDeployOpen((o) => !o)}
          disabled={provisioning}
        >
          {deployOpen ? "✕ Close" : "+ New Node"}
        </button>
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

      {deployOpen ? (
      <div className="deploy-card">
        <header>
          <div>
            <h2>Deploy node</h2>
            <p>Connect over SSH, set up 3x-ui, then register this shop server automatically.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
            {!provisioning && (
              <button
                type="button"
                className="btn small ghost"
                onClick={() => setDeployOpen(false)}
                aria-label="Collapse deploy form"
              >
                ✕ Close
              </button>
            )}
          </div>
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
                <option value="JP">Japan</option>
                <option value="EU">Europe</option>
                <option value="AU">Australia</option>
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

        {/* ── VLESS inbound config ── */}
        <div className="deploy-section">
          <h3>VLESS inbound</h3>
          <div className="form-grid">
            <label className="field span-2">
              VLESS port
              <div className="seg" role="group" aria-label="VLESS port mode" style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className={prov.vlessPortMode === "443" ? "on" : ""}
                  disabled={provisioning}
                  onClick={() => setProv({ ...prov, vlessPortMode: "443" })}
                >
                  <span className="seg-title">443</span>
                  <span className="seg-desc">Standard HTTPS port — best for bypassing firewalls.</span>
                </button>
                <button
                  type="button"
                  className={prov.vlessPortMode === "random" ? "on" : ""}
                  disabled={provisioning}
                  onClick={() => setProv({ ...prov, vlessPortMode: "random" })}
                >
                  <span className="seg-title">Random</span>
                  <span className="seg-desc">Auto-pick a high port (20 000–60 000).</span>
                </button>
                <button
                  type="button"
                  className={prov.vlessPortMode === "custom" ? "on" : ""}
                  disabled={provisioning}
                  onClick={() => setProv({ ...prov, vlessPortMode: "custom" })}
                >
                  <span className="seg-title">Custom</span>
                  <span className="seg-desc">Enter any port number you want.</span>
                </button>
              </div>
            </label>

            {prov.vlessPortMode === "custom" ? (
              <label className="field">
                Custom port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={prov.vlessPortCustom}
                  onChange={(e) => setProv({ ...prov, vlessPortCustom: e.target.value })}
                  placeholder="e.g. 8443"
                  disabled={provisioning}
                />
              </label>
            ) : null}

            <label className="field">
              SNI target
              <select
                value={prov.sni}
                onChange={(e) => setProv({ ...prov, sni: e.target.value })}
                disabled={provisioning}
              >
                <option value="www.amazon.com">www.amazon.com (recommended)</option>
                <option value="www.microsoft.com">www.microsoft.com</option>
                <option value="www.apple.com">www.apple.com</option>
                <option value="aws.amazon.com">aws.amazon.com</option>
                <option value="cloudflare.com">cloudflare.com</option>
                <option value="www.google.com">www.google.com</option>
              </select>
            </label>

            <label className="field">
              Panel port
              <input
                type="number"
                min={1}
                max={65535}
                value={prov.panelPort}
                onChange={(e) => setProv({ ...prov, panelPort: e.target.value })}
                placeholder="Auto (random)"
                disabled={provisioning}
              />
            </label>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Port 443 gives the best firewall bypass. Reality SNI is the camouflage domain — pick one that is reachable from your region.
          </p>
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
      ) : null}

      {draft && editingId ? (
        <div className="account-card" style={{ marginBottom: 16 }}>
          {/* Card header + tabs */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 16, margin: 0 }}>Configure — {servers.find(s => s.id === editingId)?.name ?? editingId}</h2>
              <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.6 }}>Panel settings and live key management.</p>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="btn small ghost"
                disabled={syncing || saving}
                onClick={() => void syncFromPanel()}
                title="Pull live inbound fields from 3x-ui into the form below"
              >{syncing ? "Syncing…" : "↓ Sync from panel"}</button>
              <button type="button" className="btn small ghost"
                onClick={() => setSshModal({ action: "status", ip: servers.find(s => s.id === editingId)?.host ?? "", password: "", running: false, logs: [], done: false })}
                title="Check x-ui service status via SSH"
              >Service status</button>
              <button type="button" className="btn small ghost"
                onClick={() => setSshModal({ action: "restart", ip: servers.find(s => s.id === editingId)?.host ?? "", password: "", running: false, logs: [], done: false })}
                title="Restart x-ui via SSH"
              >↺ Restart x-ui</button>
              <button type="button" className="btn small ghost"
                onClick={() => setPushDraft(d => d ? null : { port: draft.port, sni: draft.vlessSni })}
                title="Push port and SNI changes directly to the 3x-ui panel"
              >Push port / SNI</button>
              <button type="button" className="btn small"
                disabled={creatingTestKey}
                onClick={() => void createTestKey()}
                title="Create a 1 GB / 24h test key to verify the connection works"
              >{creatingTestKey ? "Creating…" : "🔑 Test key"}</button>
            </div>
          </div>

          {/* Push port/SNI panel */}
          {pushDraft ? (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="field" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
                New port
                <input type="number" min={1} max={65535} value={pushDraft.port}
                  onChange={e => setPushDraft(d => d && { ...d, port: e.target.value })} />
              </label>
              <label className="field" style={{ flex: 2, minWidth: 180, marginBottom: 0 }}>
                New SNI
                <input value={pushDraft.sni}
                  onChange={e => setPushDraft(d => d && { ...d, sni: e.target.value })}
                  placeholder="www.amazon.com" />
              </label>
              <button type="button" className="btn small"
                disabled={pushing || !pushDraft.port || !pushDraft.sni.trim()}
                onClick={() => void pushPortSni()}
                style={{ marginBottom: 0 }}
              >{pushing ? "Pushing…" : "Push to panel"}</button>
              <button type="button" className="btn small ghost" onClick={() => setPushDraft(null)} style={{ marginBottom: 0 }}>Cancel</button>
            </div>
          ) : null}

          {/* Test key result */}
          {testKeyResult ? (
            <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>🔑 Test key ready (1 GB · 24h)</strong>
                <button type="button" onClick={() => setTestKeyResult(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
              <label className="field" style={{ marginBottom: 8 }}>
                VLESS link
                <div style={{ display: "flex", gap: 6 }}>
                  <input readOnly value={testKeyResult.vlessKey} style={{ fontSize: 11, fontFamily: "monospace" }} onClick={e => (e.target as HTMLInputElement).select()} />
                  <button type="button" className="btn small" onClick={() => { void navigator.clipboard.writeText(testKeyResult.vlessKey); setOk("VLESS link copied ✓"); }} style={{ whiteSpace: "nowrap" }}>Copy</button>
                </div>
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                Subscription URL
                <div style={{ display: "flex", gap: 6 }}>
                  <input readOnly value={testKeyResult.subUrl} style={{ fontSize: 11, fontFamily: "monospace" }} onClick={e => (e.target as HTMLInputElement).select()} />
                  <button type="button" className="btn small" onClick={() => { void navigator.clipboard.writeText(testKeyResult.subUrl); setOk("Sub URL copied ✓"); }} style={{ whiteSpace: "nowrap" }}>Copy</button>
                </div>
              </label>
              <p className="muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>Expires {new Date(testKeyResult.expiresAt).toLocaleString()}. Visible in the Keys tab — revoke anytime.</p>
            </div>
          ) : null}

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
            {(["settings", "keys"] as const).map(tab => (
              <button key={tab} type="button"
                onClick={() => { setConfigTab(tab); if (tab === "keys" && editingId && keysServerId !== editingId) void loadKeys(editingId); }}
                style={{
                  background: "none", border: "none", borderBottom: configTab === tab ? "2px solid var(--brand)" : "2px solid transparent",
                  padding: "6px 14px", cursor: "pointer", fontWeight: configTab === tab ? 700 : 400,
                  fontSize: 13, color: configTab === tab ? "var(--brand)" : "inherit", marginBottom: -1,
                  textTransform: "capitalize",
                }}
              >{tab}{tab === "keys" ? ` (${keysList.length})` : ""}</button>
            ))}
          </div>
          {configTab === "settings" && (<>
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
          </>)}

          {configTab === "keys" && (
            <div>
              {keysLoading && <p className="muted" style={{ fontSize: 13 }}>Loading keys from panel…</p>}
              {keysError && <p className="err">{keysError}</p>}
              {!keysLoading && keysList.length === 0 && !keysError && (
                <p className="muted" style={{ fontSize: 13 }}>No subscriptions found for this server.</p>
              )}
              {keysList.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Plan</th>
                        <th>Usage</th>
                        <th>Expires</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {keysList.map(key => {
                        const pct = key.quotaBytes && key.usedBytes !== null
                          ? Math.min(100, Math.round((key.usedBytes / key.quotaBytes) * 100))
                          : null;
                        const isExpired = key.status !== "active";
                        return (
                          <tr key={key.id} style={{ opacity: isExpired ? 0.5 : 1 }}>
                            <td style={{ fontSize: 12 }}>
                              <code style={{ fontSize: 11 }}>{key.panelEmail}</code>
                              <div className="muted" style={{ fontSize: 11 }}>{key.userId.slice(0, 10)}…</div>
                            </td>
                            <td style={{ fontSize: 12 }}>{key.planTitle}</td>
                            <td style={{ minWidth: 130 }}>
                              {pct !== null ? (
                                <>
                                  <div style={{ fontSize: 11, marginBottom: 3 }}>
                                    {key.usedGb?.toFixed(2)} / {key.dataGb} GB ({pct}%)
                                  </div>
                                  <div style={{ height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                                    <div style={{ width: `${pct}%`, height: "100%", background: pct >= 90 ? "var(--danger)" : pct >= 70 ? "#f59e0b" : "var(--brand)", transition: "width .3s" }} />
                                  </div>
                                </>
                              ) : key.dataGb > 0 ? <span className="muted" style={{ fontSize: 11 }}>{key.dataGb} GB · offline</span> : <span className="muted" style={{ fontSize: 11 }}>Unlimited</span>}
                            </td>
                            <td style={{ fontSize: 12 }}>
                              {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : "∞"}
                            </td>
                            <td>
                              <span className={`pill ${key.status === "active" ? (key.liveEnabled === false ? "off" : "on") : "off"}`}>
                                {key.status === "active" ? (key.liveEnabled === false ? "Disabled" : "Active") : key.status}
                              </span>
                            </td>
                            <td>
                              <div className="toolbar" style={{ marginBottom: 0, gap: 5 }}>
                                <button type="button" className="btn small ghost"
                                  disabled={!!replacingKey || isExpired}
                                  onClick={() => void replaceKey(key.id)}
                                  title="Issue a new VLESS key for this subscription"
                                >{replacingKey === key.id ? "Replacing…" : "Replace"}</button>
                                <button type="button" className="btn small ghost danger"
                                  disabled={!!revokingKey || isExpired}
                                  onClick={() => void revokeKey(key.id)}
                                  title="Permanently revoke this key"
                                >{revokingKey === key.id ? "Revoking…" : "Revoke"}</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn small ghost"
                  disabled={keysLoading}
                  onClick={() => editingId && void loadKeys(editingId)}
                >↻ Refresh</button>
                <button type="button" className="btn small ghost" style={{ marginLeft: 6 }} onClick={cancelEdit}>Close</button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* SSH action modal */}
      {sshModal ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget && !sshModal.running) setSshModal(null); }}>
          <div style={{ background: "var(--card-bg,#1a1a2e)", border: "1px solid var(--border,#333)", borderRadius: 12, padding: 24, width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: 15, margin: 0 }}>{sshModal.action === "restart" ? "↺ Restart x-ui" : "Service status"}</h2>
              {!sshModal.running && <button type="button" onClick={() => setSshModal(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--muted,#888)" }}>✕</button>}
            </div>
            <label className="field">
              VPS IP
              <input value={sshModal.ip} onChange={e => setSshModal(m => m && { ...m, ip: e.target.value })} disabled={sshModal.running} placeholder="123.45.67.89" />
            </label>
            <label className="field">
              Root password
              <input type="password" value={sshModal.password} onChange={e => setSshModal(m => m && { ...m, password: e.target.value })} disabled={sshModal.running} autoComplete="new-password" />
            </label>
            {sshModal.logs.length > 0 && (
              <pre style={{ background: "#0d0d1a", border: "1px solid #333", borderRadius: 8, padding: "10px 12px", fontSize: 11, lineHeight: 1.6, maxHeight: 200, overflowY: "auto", margin: 0, whiteSpace: "pre-wrap" }}>{sshModal.logs.join("\n")}</pre>
            )}
            {sshModal.done && <p style={{ color: "var(--brand)", fontSize: 12, margin: 0 }}>✓ Done</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn small ghost" onClick={() => setSshModal(null)} disabled={sshModal.running}>Cancel</button>
              <button type="button" className="btn small" onClick={() => void runSshAction()} disabled={sshModal.running || !sshModal.ip || !sshModal.password}>
                {sshModal.running ? "Running…" : sshModal.action === "restart" ? "Restart" : "Check status"}
              </button>
            </div>
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
                      <button
                        className="btn small ghost danger"
                        type="button"
                        onClick={() => openDeleteModal(server)}
                        title="Delete this server"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Delete confirmation modal ── */}
      {deleteModal ? (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !deleteModal.running) closeDeleteModal(); }}
        >
          <div
            style={{
              background: "var(--card-bg,#1a1a2e)", border: "1px solid var(--border,#333)",
              borderRadius: 12, padding: 24, width: "100%", maxWidth: 480,
              display: "flex", flexDirection: "column", gap: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>Delete "{deleteModal.server.name}"</h2>
              {!deleteModal.running && (
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--muted,#888)" }}
                  aria-label="Close"
                >✕</button>
              )}
            </div>

            {deleteModal.mode === "pick" && (
              <>
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted,#aaa)" }}>
                  Choose how to delete this node:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setDeleteModal((d) => d && { ...d, mode: "uninstall" })}
                    style={{ textAlign: "left", padding: "12px 16px" }}
                  >
                    <div style={{ fontWeight: 700 }}>Uninstall 3x-ui &amp; delete record</div>
                    <div style={{ fontSize: 12, fontWeight: 400, marginTop: 3, opacity: 0.75 }}>
                      SSH into the VPS, stop and remove 3x-ui, then delete the server entry here.
                    </div>
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => void runDelete("record")}
                    style={{ textAlign: "left", padding: "12px 16px" }}
                  >
                    <div style={{ fontWeight: 700 }}>Delete record only</div>
                    <div style={{ fontSize: 12, fontWeight: 400, marginTop: 3, opacity: 0.75 }}>
                      Remove this server from the shop only. 3x-ui stays running on the VPS.
                    </div>
                  </button>
                </div>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={closeDeleteModal}
                  style={{ alignSelf: "flex-end" }}
                >Cancel</button>
              </>
            )}

            {deleteModal.mode === "uninstall" && (
              <>
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted,#aaa)" }}>
                  Enter root SSH credentials for <code>{deleteModal.server.host || deleteModal.ip}</code>.
                </p>
                <label className="field">
                  VPS IP address
                  <input
                    value={deleteModal.ip}
                    onChange={(e) => setDeleteModal((d) => d && { ...d, ip: e.target.value })}
                    placeholder="123.45.67.89"
                    disabled={deleteModal.running}
                    autoComplete="off"
                  />
                </label>
                <label className="field">
                  Root password
                  <input
                    type="password"
                    value={deleteModal.password}
                    onChange={(e) => setDeleteModal((d) => d && { ...d, password: e.target.value })}
                    disabled={deleteModal.running}
                    autoComplete="new-password"
                  />
                </label>

                {deleteModal.logs.length > 0 && (
                  <pre
                    style={{
                      background: "#0d0d1a", border: "1px solid #333", borderRadius: 8,
                      padding: "10px 12px", fontSize: 11, lineHeight: 1.6,
                      maxHeight: 160, overflowY: "auto", margin: 0, whiteSpace: "pre-wrap",
                    }}
                  >
                    {deleteModal.logs.join("\n")}
                  </pre>
                )}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={closeDeleteModal}
                    disabled={deleteModal.running}
                  >Cancel</button>
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={deleteModal.running || !deleteModal.ip.trim() || !deleteModal.password}
                    onClick={() => void runDelete("uninstall")}
                  >
                    {deleteModal.running
                      ? (deleteModal.phase === "uninstalling" ? "Uninstalling…" : deleteModal.phase === "removing" ? "Removing…" : "Connecting…")
                      : "Uninstall &amp; delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
