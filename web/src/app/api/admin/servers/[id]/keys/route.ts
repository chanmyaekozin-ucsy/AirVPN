import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { PanelClient, PanelError } from "@/lib/panel";
import { readStore } from "@/lib/store";

export const runtime = "nodejs";

/** GET /api/admin/servers/[id]/keys
 * Returns all subscriptions for this server enriched with live panel usage.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const store = await readStore();
    const server = store.servers.find((s) => s.id === id);
    if (!server) return Response.json({ error: "Server not found." }, { status: 404 });

    const subs = store.subscriptions.filter((s) => s.serverId === id);

    // Fetch live client stats from panel (best-effort — don't fail if panel is down)
    const statsMap = new Map<string, { up: number; down: number; total: number; enable: boolean; expiryTime: number }>();
    try {
      const client = new PanelClient(server);
      await client.login();
      const stats = await client.getClientStats();
      for (const s of stats) statsMap.set(s.email, s);
    } catch {
      // panel offline — still return store data without live stats
    }

    // Enrich subscriptions with live data
    const keys = subs.map((sub) => {
      const live = statsMap.get(sub.panelEmail);
      const usedBytes = live ? live.up + live.down : null;
      const quotaBytes = sub.dataGb > 0 ? sub.dataGb * 1024 ** 3 : null;
      return {
        id: sub.id,
        orderId: sub.orderId,
        userId: sub.userId,
        panelEmail: sub.panelEmail,
        clientUuid: sub.clientUuid,
        planTitle: sub.planTitle,
        dataGb: sub.dataGb,
        durationDays: sub.durationDays,
        status: sub.status,
        createdAt: sub.createdAt,
        expiresAt: sub.expiresAt,
        vlessKey: sub.vlessKey,
        subUrl: sub.subUrl,
        // Live panel data
        liveEnabled: live?.enable ?? null,
        usedBytes,
        quotaBytes,
        usedGb: usedBytes !== null ? +(usedBytes / 1024 ** 3).toFixed(2) : null,
        remainingGb: quotaBytes !== null && usedBytes !== null
          ? +((quotaBytes - usedBytes) / 1024 ** 3).toFixed(2)
          : null,
        liveExpiry: live?.expiryTime ?? null,
      };
    });

    // Sort: active first, then by createdAt desc
    keys.sort((a, b) => {
      if (a.status === b.status) return b.createdAt.localeCompare(a.createdAt);
      return a.status === "active" ? -1 : 1;
    });

    return Response.json({ keys, panelOnline: statsMap.size > 0 });
  } catch (err) {
    if (err instanceof PanelError)
      return Response.json({ ok: false, error: err.message }, { status: 502 });
    return jsonError(err);
  }
}
