import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { PanelClient, PanelError } from "@/lib/panel";
import { readStore, updateStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * POST /api/admin/servers/[id]/keys/replace
 * Body: { subscriptionId: string }
 *
 * 1. Delete the old client from the panel
 * 2. Provision a new client (same plan/quota)
 * 3. Update subscription in store (new vlessKey, panelEmail, clientUuid)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as { subscriptionId?: string };
    const subId = String(body.subscriptionId ?? "").trim();
    if (!subId) return Response.json({ error: "subscriptionId is required." }, { status: 400 });

    const store = await readStore();
    const server = store.servers.find((s) => s.id === id);
    if (!server) return Response.json({ error: "Server not found." }, { status: 404 });

    const sub = store.subscriptions.find((s) => s.id === subId && s.serverId === id);
    if (!sub) return Response.json({ error: "Subscription not found." }, { status: 404 });
    const order = store.orders.find((o) => o.id === sub.orderId);
    if (!order) return Response.json({ error: "Original order not found." }, { status: 404 });

    const client = new PanelClient(server);
    await client.login();

    // 1. Delete the old client (best-effort)
    try {
      await client.deleteClientByUuid(sub.clientUuid);
    } catch {
      // ignore — old client may already be gone
    }

    // 2. Provision a new client
    const provisioned = await client.addClient({
      emailPrefix: `web_${sub.userId}`.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24) || "web",
      dataLimitGb: sub.dataGb,
      expiryDays:
        sub.expiresAt
          ? Math.max(1, Math.ceil((new Date(sub.expiresAt).getTime() - Date.now()) / 86_400_000))
          : order.durationDays,
      remark: `AirVPN-${id}-${order.id.slice(-6)}-reissue`,
    });

    // 3. Update store record
    await updateStore((s) => {
      const record = s.subscriptions.find((x) => x.id === subId);
      if (record) {
        record.vlessKey = provisioned.vlessKey;
        record.panelEmail = provisioned.email;
        record.clientUuid = provisioned.uuid;
      }
    });

    return Response.json({
      ok: true,
      vlessKey: provisioned.vlessKey,
      panelEmail: provisioned.email,
      clientUuid: provisioned.uuid,
    });
  } catch (err) {
    if (err instanceof PanelError)
      return Response.json({ ok: false, error: err.message }, { status: 502 });
    return jsonError(err);
  }
}
