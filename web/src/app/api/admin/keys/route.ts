import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { readStore } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
    const status = req.nextUrl.searchParams.get("status") || "";
    const loginMethod = (req.nextUrl.searchParams.get("loginMethod") || "").trim().toLowerCase();
    const serverId = req.nextUrl.searchParams.get("serverId") || "";

    const store = await readStore();

    // Map subscriptions enriched with user, server, and order data
    let items = store.subscriptions.map((sub) => {
      const user = store.users.find((u) => u.id === sub.userId);
      const order = store.orders.find((o) => o.id === sub.orderId);
      const server = store.servers.find((s) => s.id === sub.serverId);

      const effectiveLoginMethod = sub.userLoginMethod || order?.userLoginMethod || user?.loginMethod || "unknown";
      const effectiveName = sub.userName || order?.userName || user?.name || order?.payeeName || "Anonymous";
      const effectiveEmail = sub.userEmail || order?.userEmail || user?.email || "";
      const effectivePhone = sub.userPhone || order?.userPhone || user?.phone || "";

      return {
        ...sub,
        userLoginMethod: effectiveLoginMethod,
        userName: effectiveName,
        userEmail: effectiveEmail,
        userPhone: effectivePhone,
        serverName: server?.name || sub.serverId,
        orderPaymentMethod: order?.paymentMethod || "—",
        orderPayeeName: order?.payeeName || null,
        orderTxid: order?.txid || null,
        orderAmountKs: order?.amountKs || 0,
        replacementRequested: Boolean(sub.replacementRequested || order?.replacementRequested),
        replacementReason: sub.replacementReason || order?.replacementReason || null,
        replacementRequestedAt: sub.replacementRequestedAt || order?.replacementRequestedAt || null,
        telegramId: user?.telegramId || "",
        userNotes: user?.notes || "",
      };
    });

    // Sort descending by creation date
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (status) {
      items = items.filter((s) => s.status === status);
    }

    if (loginMethod) {
      items = items.filter((s) => s.userLoginMethod.toLowerCase() === loginMethod);
    }

    if (serverId) {
      items = items.filter((s) => s.serverId === serverId);
    }

    if (q) {
      items = items.filter((s) =>
        [
          s.id,
          s.orderId,
          s.userId,
          s.userName,
          s.userEmail,
          s.userPhone,
          s.userLoginMethod,
          s.serverName,
          s.planTitle,
          s.vlessKey,
          s.clientUuid,
          s.orderPayeeName,
          s.orderTxid,
          s.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }

    return Response.json({
      keys: items,
      servers: store.servers.map((s) => ({
        id: s.id,
        name: s.name,
        region: s.region,
        isActive: s.isActive,
      })),
      plans: store.plans.map((p) => ({
        id: p.id,
        serverId: p.serverId,
        title: p.title,
        dataGb: p.dataGb,
        durationDays: p.durationDays,
        priceKs: p.priceKs,
        isActive: p.isActive,
      })),
    });
  } catch (err) {
    return jsonError(err);
  }
}
