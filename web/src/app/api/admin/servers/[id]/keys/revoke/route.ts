import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { PanelClient, PanelError } from "@/lib/panel";
import { updateStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * POST /api/admin/servers/[id]/keys/revoke
 * Body: { subscriptionId: string }
 *
 * 1. Delete the client from the panel
 * 2. Mark subscription as expired in store
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

    let sub: { clientUuid: string; panelEmail: string; serverId: string } | undefined;

    await updateStore((store) => {
      const server = store.servers.find((s) => s.id === id);
      if (!server) throw Object.assign(new Error("Server not found."), { status: 404 });

      const record = store.subscriptions.find((s) => s.id === subId && s.serverId === id);
      if (!record) throw Object.assign(new Error("Subscription not found."), { status: 404 });

      sub = { clientUuid: record.clientUuid, panelEmail: record.panelEmail, serverId: id };
      record.status = "expired";
    });

    if (!sub) return Response.json({ error: "Subscription not found." }, { status: 404 });

    // Try to delete from panel (best-effort — don't fail if panel is down)
    try {
      const store = await import("@/lib/store").then((m) => m.readStore());
      const server = store.servers.find((s) => s.id === id);
      if (server) {
        const client = new PanelClient(server);
        await client.login();
        await client.deleteClientByUuid(sub.clientUuid);
      }
    } catch {
      // panel offline — subscription is already marked expired in store
    }

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof PanelError)
      return Response.json({ ok: false, error: err.message }, { status: 502 });
    return jsonError(err);
  }
}
