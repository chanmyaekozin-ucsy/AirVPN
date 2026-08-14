"use client";

import { useEffect, useRef, useState } from "react";
import { FlagIcon } from "@/components/FlagIcon";
import { api } from "@/lib/api";
import { formatDataGb, formatDuration, formatKs, formatOffBadge, planDiscount } from "@/lib/format";
import type { Plan, Server } from "@/lib/types";

type PlanDraft = {
  title: string;
  dataGb: string;
  priceKs: string;
  compareAtKs: string;
  durationDays: string;
  unlimitedDate: boolean;
  isActive: boolean;
};

type FormMode = { kind: "edit"; id: string } | { kind: "create" };

function emptyDraft(): PlanDraft {
  return {
    title: "",
    dataGb: "50",
    priceKs: "2000",
    compareAtKs: "2500",
    durationDays: "30",
    unlimitedDate: false,
    isActive: true,
  };
}

function toDraft(plan: Plan): PlanDraft {
  return {
    title: plan.title,
    dataGb: String(plan.dataGb),
    priceKs: String(plan.priceKs),
    compareAtKs: String(plan.compareAtKs || 0),
    durationDays: String(plan.unlimitedDate ? 30 : plan.durationDays),
    unlimitedDate: plan.unlimitedDate,
    isActive: plan.isActive,
  };
}

function moveItem<T>(list: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function AdminPlansPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [mode, setMode] = useState<FormMode | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const dragFrom = useRef<number | null>(null);
  const orderDirty = useRef(false);
  const plansRef = useRef(plans);
  plansRef.current = plans;

  const loadServers = () =>
    api<{ servers: Server[] }>("/api/admin/servers").then((r) => {
      setServers(r.servers);
      setServerId((id) => id || r.servers[0]?.id || "");
    });

  const loadPlans = (id: string) => {
    if (!id) return Promise.resolve();
    return api<{ plans: Plan[] }>(`/api/admin/plans?serverId=${id}`).then((r) => setPlans(r.plans));
  };

  useEffect(() => {
    loadServers().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  useEffect(() => {
    if (!serverId) return;
    setMode(null);
    setDraft(null);
    setDragId(null);
    orderDirty.current = false;
    loadPlans(serverId).catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [serverId]);

  const startCreate = () => {
    setError("");
    setMode({ kind: "create" });
    setDraft(emptyDraft());
  };

  const startEdit = (plan: Plan) => {
    setError("");
    setMode({ kind: "edit", id: plan.id });
    setDraft(toDraft(plan));
  };

  const cancelForm = () => {
    setMode(null);
    setDraft(null);
  };

  const saveForm = async () => {
    if (!mode || !draft) return;
    setError("");
    setSaving(true);
    try {
      const payload = {
        title: draft.title.trim(),
        dataGb: Number(draft.dataGb) || 1,
        priceKs: Number(draft.priceKs) || 0,
        compareAtKs: Number(draft.compareAtKs) || 0,
        durationDays: draft.unlimitedDate ? undefined : Number(draft.durationDays) || 1,
        unlimitedDate: draft.unlimitedDate,
        isActive: draft.isActive,
      };
      if (mode.kind === "create") {
        await api("/api/admin/plans", {
          method: "POST",
          body: JSON.stringify({ serverId, ...payload }),
        });
      } else {
        await api("/api/admin/plans", {
          method: "PATCH",
          body: JSON.stringify({ id: mode.id, ...payload }),
        });
      }
      await loadPlans(serverId);
      cancelForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (plan: Plan) => {
    setError("");
    try {
      await api("/api/admin/plans", {
        method: "PATCH",
        body: JSON.stringify({ id: plan.id, isActive: !plan.isActive }),
      });
      await loadPlans(serverId);
      if (mode?.kind === "edit" && mode.id === plan.id && draft) {
        setDraft({ ...draft, isActive: !plan.isActive });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const removePlan = async (plan: Plan) => {
    if (!window.confirm(`Delete “${plan.title}”? This cannot be undone.`)) return;
    setError("");
    try {
      await api(`/api/admin/plans?id=${encodeURIComponent(plan.id)}`, { method: "DELETE" });
      if (mode?.kind === "edit" && mode.id === plan.id) cancelForm();
      await loadPlans(serverId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const persistOrder = async (ordered: Plan[]) => {
    setError("");
    try {
      const res = await api<{ plans: Plan[] }>("/api/admin/plans", {
        method: "PATCH",
        body: JSON.stringify({ orderedIds: ordered.map((p) => p.id) }),
      });
      setPlans(res.plans);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed");
      await loadPlans(serverId);
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
    setPlans((prev) => {
      const next = moveItem(prev, from, index);
      dragFrom.current = index;
      orderDirty.current = true;
      return next;
    });
  };

  const onDragEnd = () => {
    const dirty = orderDirty.current;
    const ordered = dirty ? plansRef.current : null;
    dragFrom.current = null;
    orderDirty.current = false;
    setDragId(null);
    if (ordered) void persistOrder(ordered);
  };

  const selectedServer = servers.find((s) => s.id === serverId);

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Plans</h2>
          <p>Data quota and price per server. Drag rows to reorder.</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0, alignItems: "center" }}>
          {selectedServer ? (
            <FlagIcon
              region={selectedServer.region}
              name={selectedServer.name}
              slug={selectedServer.slug}
              id={selectedServer.id}
              size={28}
            />
          ) : null}
          <select className="box" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="btn small" type="button" disabled={!serverId} onClick={startCreate}>
            Add plan
          </button>
        </div>
      </div>
      {error ? <p className="err">{error}</p> : null}

      {draft && mode ? (
        <div className="account-card" style={{ marginBottom: 16 }}>
          <div className="page-h" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 16 }}>{mode.kind === "create" ? "New plan" : "Edit plan"}</h2>
              <p>
                {mode.kind === "create"
                  ? "Create a plan for the selected server."
                  : "Update title, quota, duration, and price."}
              </p>
            </div>
          </div>
          <label className="field">
            Title
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <label className="field" style={{ flex: 1, marginBottom: 12 }}>
              Data (GB)
              <input
                type="number"
                min={1}
                value={draft.dataGb}
                onChange={(e) => setDraft({ ...draft, dataGb: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: 1, marginBottom: 12 }}>
              Sale price (Ks)
              <input
                type="number"
                min={0}
                value={draft.priceKs}
                onChange={(e) => setDraft({ ...draft, priceKs: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: 1, marginBottom: 12 }}>
              Compare-at (Ks)
              <input
                type="number"
                min={0}
                value={draft.compareAtKs}
                onChange={(e) => setDraft({ ...draft, compareAtKs: e.target.value })}
                placeholder="0 = no discount"
              />
            </label>
          </div>
          {(() => {
            const d = planDiscount({
              priceKs: Number(draft.priceKs) || 0,
              compareAtKs: Number(draft.compareAtKs) || 0,
            });
            if (!d.hasDiscount) {
              return (
                <p className="muted" style={{ marginTop: -4, marginBottom: 12, fontSize: 12 }}>
                  Set compare-at higher than sale price to show % off and amount off in the shop.
                </p>
              );
            }
            return (
              <p style={{ marginTop: -4, marginBottom: 12, fontSize: 13, fontWeight: 650 }}>
                Shop badge: <span className="pkg-off">{formatOffBadge(d.offKs, d.offPct)}</span>
                {" · "}
                <span className="was-line">{formatKs(d.compareAtKs)}</span>
                {" → "}
                {formatKs(d.priceKs)}
              </p>
            );
          })()}
          <div className="toolbar" style={{ marginBottom: 12, alignItems: "flex-end" }}>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}>
              Duration (days)
              <input
                type="number"
                min={1}
                disabled={draft.unlimitedDate}
                value={draft.durationDays}
                onChange={(e) => setDraft({ ...draft, durationDays: e.target.value })}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 12, fontWeight: 650, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={draft.unlimitedDate}
                onChange={(e) => setDraft({ ...draft, unlimitedDate: e.target.checked })}
              />
              Unlimited date
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 12, fontWeight: 650, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              />
              Active
            </label>
          </div>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button
              className="btn small"
              type="button"
              disabled={saving || !draft.title.trim()}
              onClick={() => void saveForm()}
            >
              {saving ? "Saving…" : mode.kind === "create" ? "Create" : "Save"}
            </button>
            <button className="btn small ghost" type="button" disabled={saving} onClick={cancelForm}>
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
              <th>Plan</th>
              <th>Data</th>
              <th>Duration</th>
              <th>Price</th>
              <th>Discount</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((plan, index) => (
              <tr
                key={plan.id}
                className={dragId === plan.id ? "dragging" : undefined}
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
                    aria-label={`Reorder ${plan.title}`}
                    draggable
                    onDragStart={() => onDragStart(index, plan.id)}
                    onDragEnd={onDragEnd}
                  >
                    ⋮⋮
                  </button>
                </td>
                <td>{plan.title}</td>
                <td>{formatDataGb(plan.dataGb)}</td>
                <td>{formatDuration(plan.durationDays, plan.unlimitedDate)}</td>
                <td>
                  {(() => {
                    const d = planDiscount(plan);
                    if (!d.hasDiscount) return formatKs(plan.priceKs);
                    return (
                      <span>
                        <span className="was-line" style={{ marginRight: 6 }}>
                          {formatKs(d.compareAtKs)}
                        </span>
                        {formatKs(d.priceKs)}
                      </span>
                    );
                  })()}
                </td>
                <td>
                  {(() => {
                    const d = planDiscount(plan);
                    return d.hasDiscount ? (
                      <span className="pkg-off">{formatOffBadge(d.offKs, d.offPct)}</span>
                    ) : (
                      <span className="muted">—</span>
                    );
                  })()}
                </td>
                <td>
                  <button
                    className={`pill ${plan.isActive ? "on" : "off"}`}
                    type="button"
                    onClick={() => void toggleActive(plan)}
                  >
                    {plan.isActive ? "On" : "Off"}
                  </button>
                </td>
                <td>
                  <div className="toolbar" style={{ marginBottom: 0, gap: 6 }}>
                    <button className="btn small ghost" type="button" onClick={() => startEdit(plan)}>
                      Edit
                    </button>
                    <button className="btn small danger" type="button" onClick={() => void removePlan(plan)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
