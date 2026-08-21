import { NextRequest } from "next/server";
import { jsonError, requireUser } from "@/lib/auth";
import { failedStatus, paidStatus, verifyDepositLast5 } from "@/lib/dominate";
import { fulfillOrder, markFulfillFailed } from "@/lib/fulfill";
import { PanelError } from "@/lib/panel";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { readStore, updateStore } from "@/lib/store";
import { notifyPurchaseSuccess } from "@/lib/telegram";
import { chargeWathanPay } from "@/lib/wathanpay";
import type { Order, Transaction } from "@/lib/types";

function markFailed(
  order: Order,
  txn: Transaction,
  input: { txid: string; message: string },
) {
  order.status = "failed";
  order.txid = input.txid;
  order.failReason = input.message;
  order.completedAt = new Date().toISOString();
  txn.status = "failed";
  txn.txid = input.txid;
  txn.note = input.message;
}

async function deliver(store: Parameters<typeof fulfillOrder>[0], order: Order, txn: Transaction) {
  order.status = "processing";
  try {
    const subscription = await fulfillOrder(store, order);
    const user = store.users.find((u) => u.id === order.userId);
    void notifyPurchaseSuccess({ order, subscription, user }).catch(() => false);
    return { order, transaction: txn, subscription };
  } catch (err) {
    const message =
      err instanceof PanelError
        ? err.message
        : err instanceof Error
          ? err.message
          : "VPN provisioning failed.";
    markFulfillFailed(order, message);
    txn.note = message;
    return { order, transaction: txn, subscription: null };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const ip = getClientIp(req);
    const rl = checkRateLimit(`order_confirm:${session.sub}:${ip}`, 10, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const { id } = await params;
    const body = (await req.json()) as { last5?: string; accessToken?: string };
    const last5 = String(body.last5 ?? "").replace(/\D/g, "").slice(0, 5);
    if (last5.length !== 5) {
      return Response.json({ error: "Enter the last 5 digits of the TxID." }, { status: 400 });
    }

    const isDev = process.env.NODE_ENV !== "production";
    const preview = await readStore();
    const existing = preview.orders.find((o) => o.id === id && o.userId === session.sub);
    if (!existing) return Response.json({ error: "Order not found." }, { status: 404 });
    if (existing.status !== "awaiting_payment") {
      return Response.json({ error: "This order is already closed." }, { status: 409 });
    }

    // ── Dominate Payment Gateway Path ─────────────────────────────────────────
    if (existing.depositId) {
      const deposit = await verifyDepositLast5(existing.depositId, last5);
      const status = String(deposit.status || "");
      const txid = String(deposit.bank_trx_id || deposit.trx_id || last5);

      if (status === "pending") {
        return Response.json(
          { error: "Payment not found yet. Pay the exact amount, then send the last 5 digits again." },
          { status: 409 },
        );
      }

      const result = await updateStore(async (store) => {
        const order = store.orders.find((o) => o.id === id && o.userId === session.sub);
        if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
        const txn: Transaction = {
          id: `txn_${Date.now().toString(36)}`,
          orderId: order.id,
          userId: order.userId,
          amountKs: order.amountKs,
          method: order.paymentMethod || "KBZPay",
          txid,
          status: "pending",
          note: order.paymentMethod,
          createdAt: new Date().toISOString(),
        };
        store.transactions.push(txn);

        const isTestFail = isDev && last5 === "99999";
        if (failedStatus(status) || !paidStatus(status) || isTestFail) {
          markFailed(order, txn, {
            txid,
            message:
              isTestFail
                ? "Delivery failed (dev simulation). Payment will be reviewed."
                : deposit.verify_reason || "Payment failed.",
          });
          return { order, transaction: txn, subscription: null };
        }
        order.txid = txid;
        txn.status = "succeeded";
        txn.note = `${order.paymentMethod} ${txid}`;
        return deliver(store, order, txn);
      });
      return Response.json(result);
    }

    // ── WathanPay Direct Charge Path ──────────────────────────────────────────
    const remote = await chargeWathanPay({
      accessToken: body.accessToken,
      amountKs: existing.amountKs,
      orderId: id,
      last5,
    });

    // In production, require verified remote payment result
    if (!remote && !isDev) {
      return Response.json(
        { error: "Direct wallet payment is not available. Please use WathanPay In-App Checkout or KBZPay." },
        { status: 400 },
      );
    }

    const result = await updateStore(async (store) => {
      const user = store.users.find((u) => u.id === session.sub);
      const order = store.orders.find((o) => o.id === id && o.userId === session.sub);
      if (!user || !order) {
        throw Object.assign(new Error("Order not found."), { status: 401 });
      }
      if (order.status !== "awaiting_payment") {
        throw Object.assign(new Error("This order is already closed."), { status: 409 });
      }

      const txid = remote?.txid || `WP${last5}${Date.now().toString().slice(-6)}`;
      const txn: Transaction = {
        id: `txn_${Date.now().toString(36)}`,
        orderId: order.id,
        userId: user.id,
        amountKs: order.amountKs,
        method: "WathanPay",
        txid,
        status: "pending",
        note: "WathanPay in-app",
        createdAt: new Date().toISOString(),
      };
      store.transactions.push(txn);

      const payFailed =
        (isDev && last5 === "00000") ||
        remote?.ok === false ||
        (!remote && isDev && user.balanceKs < order.amountKs);

      if (payFailed) {
        const message =
          remote?.message ||
          (isDev && last5 === "00000" ? "Payment was declined (dev simulation)." : "Not enough WathanPay balance.");
        markFailed(order, txn, { txid, message });
        return { order, transaction: txn, subscription: null };
      }

      if (!remote && isDev) user.balanceKs -= order.amountKs;
      if (isDev && last5 === "99999") {
        markFailed(order, txn, { txid, message: "Delivery failed (dev simulation)." });
        return { order, transaction: txn, subscription: null };
      }

      order.paymentMethod = "WathanPay";
      order.txid = txid;
      txn.status = "succeeded";
      txn.note = "Paid with WathanPay";
      return deliver(store, order, txn);
    });

    return Response.json(result);
  } catch (err) {
    return jsonError(err);
  }
}

