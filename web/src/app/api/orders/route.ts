import { NextRequest } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { readStore, updateStore } from "@/lib/store";
import type { Order } from "@/lib/types";

export async function GET() {
  try {
    const session = await requireUser();
    const store = await readStore();
    const orders = store.orders
      .filter((o) => o.userId === session.sub)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Response.json({ orders });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireUser();
    const body = (await req.json()) as { planId?: string };
    const planId = String(body.planId ?? "").trim();
    const order = await updateStore((store) => {
      const user = store.users.find((u) => u.id === session.sub);
      if (!user) {
        throw Object.assign(new Error("User not found."), { status: 401 });
      }
      const open = store.orders.find(
        (o) =>
          o.userId === user.id &&
          (o.status === "awaiting_payment" || o.status === "processing" || o.status === "paid"),
      );
      if (open?.status === "awaiting_payment") {
        open.status = "cancelled";
        open.completedAt = new Date().toISOString();
      } else if (open) {
        throw Object.assign(
          new Error("You already have an open order. Finish or cancel it first."),
          { status: 409 },
        );
      }
      const plan = store.plans.find((p) => p.id === planId && p.isActive);
      const server = store.servers.find((s) => s.id === plan?.serverId && s.isActive);
      if (!plan || !server) {
        throw Object.assign(new Error("Plan not found."), { status: 404 });
      }
      const created: Order = {
        id: `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        userId: user.id,
        serverId: server.id,
        serverName: server.name,
        planId: plan.id,
        planTitle: plan.title,
        dataGb: plan.dataGb,
        durationDays: plan.durationDays,
        amountKs: plan.priceKs,
        status: "awaiting_payment",
        paymentMethod: "",
        depositId: null,
        payeeName: null,
        payeePhone: null,
        txid: null,
        failReason: null,
        subscriptionId: null,
        userLoginMethod: user.loginMethod,
        userName: user.name,
        userEmail: user.email,
        userPhone: user.phone,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      store.orders.push(created);
      return created;
    });
    return Response.json({ order });
  } catch (err) {
    return jsonError(err);
  }
}
