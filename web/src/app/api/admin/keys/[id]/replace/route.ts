import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { replaceSubscriptionKey } from "@/lib/fulfill";
import { updateStore } from "@/lib/store";
import { notifyKeyReplaced } from "@/lib/telegram";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      targetServerId?: string;
      targetPlanId?: string;
      dataGb?: number;
      durationDays?: number;
      resetDuration?: boolean;
      reason?: string;
      adminNote?: string;
    };

    const sub = await updateStore(async (store) => {
      const updated = await replaceSubscriptionKey(store, id, {
        targetServerId: body.targetServerId?.trim(),
        targetPlanId: body.targetPlanId?.trim(),
        dataGb: typeof body.dataGb === "number" ? body.dataGb : undefined,
        durationDays: typeof body.durationDays === "number" ? body.durationDays : undefined,
        resetDuration: Boolean(body.resetDuration),
        reason: body.reason?.trim(),
        adminNote: body.adminNote?.trim(),
      });
      const server = store.servers.find((s) => s.id === updated.serverId);
      void notifyKeyReplaced({
        subscription: updated,
        serverName: server?.name || updated.serverId,
        reason: body.reason,
        adminNote: body.adminNote,
      }).catch(() => false);
      return updated;
    });

    return Response.json({ ok: true, subscription: sub });
  } catch (err) {
    return jsonError(err);
  }
}
