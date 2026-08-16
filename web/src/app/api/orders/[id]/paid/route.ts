import { NextRequest } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { fulfillOrder, markFulfillFailed } from "@/lib/fulfill";
import { PanelError } from "@/lib/panel";
import { updateStore } from "@/lib/store";
import { notifyPurchaseSuccess } from "@/lib/telegram";
import { verifyWathanPayPayment } from "@/lib/wathanpay";
import type { Transaction } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;
    const body = (await req.json()) as {
      txid?: string;
      payeeName?: string;
      payerName?: string;
    };
    const txid = String(body.txid ?? "").trim();
    if (!txid) {
      return Response.json({ error: "Missing WathanPay payment id." }, { status: 400 });
    }

    const result = await updateStore(async (store) => {
      const order = store.orders.find((o) => o.id === id && o.userId === session.sub);
      if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
      if (order.status === "success" && order.txid === txid) {
        return {
          order,
          subscription: store.subscriptions.find((s) => s.orderId === order.id) ?? null,
          transaction: store.transactions.find((t) => t.orderId === order.id) ?? null,
        };
      }
      if (order.status !== "awaiting_payment") {
        throw Object.assign(new Error("This order is already closed."), { status: 409 });
      }

      // Rule 1: Anti-Replay Guard — Never trust client-supplied TxIDs that were previously consumed
      const isReused =
        store.orders.some((o) => o.id !== id && o.txid === txid && o.status === "success") ||
        store.transactions.some((t) => t.orderId !== id && t.txid === txid && t.status === "succeeded");
      if (isReused) {
        throw Object.assign(new Error("This transaction ID has already been redeemed."), { status: 409 });
      }

      // Rule 2: Server-to-Server Zero-Trust Verification with WathanPay Core Ledger
      const verification = await verifyWathanPayPayment({
        shopOrderId: order.id,
        transactionId: txid,
        amountKs: order.amountKs,
      });

      const isAuthentic =
        verification.ok === true &&
        verification.verified === true &&
        verification.status === "succeeded" &&
        (verification.amountKs == null || verification.amountKs === order.amountKs);

      if (!isAuthentic) {
        throw Object.assign(
          new Error(verification.message || "Payment verification failed on WathanPay ledger."),
          { status: 400 },
        );
      }

      const user = store.users.find((u) => u.id === session.sub);
      const payerName =
        String(body.payeeName ?? body.payerName ?? "").trim() ||
        (user?.name && user.name !== "WathanPay" ? user.name : "WathanPay User");

      order.paymentMethod = "WathanPay";
      order.txid = txid;
      order.payeeName = payerName;
      order.payeePhone = user?.phone || null;
      order.depositId = null;
      order.userLoginMethod = user?.loginMethod || "wathanpay";
      order.userName = user?.name || payerName;
      order.userEmail = user?.email;
      order.userPhone = user?.phone;
      order.status = "processing";

      const txn: Transaction = {
        id: `txn_${Date.now().toString(36)}`,
        orderId: order.id,
        userId: order.userId,
        amountKs: order.amountKs,
        method: "WathanPay",
        txid,
        status: "succeeded",
        note: "WathanPay in-app (verified)",
        createdAt: new Date().toISOString(),
      };
      store.transactions.push(txn);

      try {
        const subscription = await fulfillOrder(store, order);
        void notifyPurchaseSuccess({ order, subscription, user }).catch(() => false);
        return { order, subscription, transaction: txn };
      } catch (err) {
        const message =
          err instanceof PanelError
            ? err.message
            : err instanceof Error
              ? err.message
              : "VPN provisioning failed.";
        markFulfillFailed(order, message);
        txn.note = message;
        return { order, subscription: null, transaction: txn };
      }
    });

    return Response.json(result);
  } catch (err) {
    return jsonError(err);
  }
}

