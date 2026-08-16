import { NextRequest } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { updateStore } from "@/lib/store";
import { notifyKeyReplacementRequest } from "@/lib/telegram";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      reason?: string;
      customerNote?: string;
    };

    const reason = body.reason?.trim() || "Customer requested key replacement";
    const customerNote = body.customerNote?.trim() || "";

    const result = await updateStore((store) => {
      const order = store.orders.find((o) => o.id === id && o.userId === session.sub);
      if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });

      const now = new Date().toISOString();
      order.replacementRequested = true;
      order.replacementReason = reason;
      order.replacementRequestedAt = now;

      const sub = store.subscriptions.find((s) => s.orderId === order.id || s.id === order.subscriptionId);
      if (sub) {
        sub.replacementRequested = true;
        sub.replacementReason = reason;
        sub.replacementRequestedAt = now;
        const noteLog = `[${now.slice(0, 16)}] Key replacement requested by customer: ${reason}${
          customerNote ? ` (Note: ${customerNote})` : ""
        }`;
        sub.notes = sub.notes ? `${sub.notes}\n${noteLog}` : noteLog;
      }

      return { order, subscription: sub ?? null };
    });

    // Send Telegram Notification to Admin payment bot
    void notifyKeyReplacementRequest({
      order: result.order,
      subscription: result.subscription,
      reason,
      customerNote,
    }).catch(() => false);

    return Response.json({ ok: true, order: result.order, subscription: result.subscription });
  } catch (err) {
    return jsonError(err);
  }
}
