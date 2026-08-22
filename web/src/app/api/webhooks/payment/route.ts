import { NextRequest } from "next/server";
import crypto from "crypto";
import { fulfillOrder, markFulfillFailed } from "@/lib/fulfill";
import { PanelError } from "@/lib/panel";
import { dominateConfig } from "@/lib/shop-env";
import { updateStore } from "@/lib/store";
import { notifyPurchaseSuccess, sendTelegramMessage } from "@/lib/telegram";
import type { Transaction } from "@/lib/types";

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return true;
  try {
    const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(hmac, "utf8"), Buffer.from(signature, "utf8"));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-signature-sha256") || req.headers.get("x-signature") || "";
    const { webhookSecret, key } = dominateConfig();
    const secret = webhookSecret || key;

    if (secret && signature && !verifySignature(rawBody, signature, secret)) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const depositId = String(payload.id || "").trim();
    const externalRef = String(payload.external_ref || "").trim();
    const status = String(payload.status || "").toLowerCase();
    const matchedOrderId = String(payload.matched_order_id || payload.submitted_last5 || depositId || "").trim();

    if (!depositId && !externalRef) {
      return Response.json({ error: "Missing deposit ID or external reference" }, { status: 400 });
    }

    if (status !== "paid") {
      return Response.json({ ok: true, status, message: "Non-paid status ignored" }, { status: 200 });
    }

    const result = await updateStore(async (store) => {
      // Find order by ID or deposit ID
      const order = store.orders.find(
        (o) => (externalRef && o.id === externalRef) || (depositId && o.depositId === depositId),
      );

      if (!order) {
        return { ok: false, message: "Order not found in store" };
      }

      if (order.status === "success") {
        return { ok: true, message: "Order already fulfilled", orderId: order.id };
      }

      if (order.status !== "awaiting_payment" && order.status !== "processing") {
        return { ok: false, message: `Order is in status: ${order.status}` };
      }

      const user = store.users.find((u) => u.id === order.userId);
      const txid = matchedOrderId || order.depositId || `DEP_${Date.now()}`;

      order.status = "processing";
      order.txid = txid;
      if (depositId) order.depositId = depositId;

      const txn: Transaction = {
        id: `txn_${Date.now().toString(36)}`,
        orderId: order.id,
        userId: order.userId,
        amountKs: order.amountKs,
        method: order.paymentMethod || "KBZPay",
        txid,
        status: "succeeded",
        note: `${order.paymentMethod || "PGW"} Webhook verified`,
        createdAt: new Date().toISOString(),
      };
      store.transactions.push(txn);

      try {
        const subscription = await fulfillOrder(store, order);
        void notifyPurchaseSuccess({ order, subscription, user }).catch(() => false);

        // If user ordered via Telegram, send instant notification to their Telegram chat
        if (order.telegramId) {
          const vlessCode = subscription.vlessKey;
          const subUrl = subscription.subUrl;
          const tgMsg = `
<b>ငွေပေးချေမှု အောင်မြင်ပြီး VPN Key အဆင်သင့်ဖြစ်ပါပြီ (Webhook Verified)</b>

• <b>ဆာဗာ:</b> ${order.serverName}
• <b>ပလန်:</b> ${order.planTitle}
• <b>TxID:</b> <code>${txid}</code>

━━━━━━━━━━━━━━━━━━━━
<b>VLESS Key (ကူးယူရန် နှိပ်ပါ):</b>
<code>${vlessCode}</code>

<b>Subscription URL:</b>
<code>${subUrl}</code>
━━━━━━━━━━━━━━━━━━━━
v2rayNG / Hiddify / Streisand ထဲသို့ ထည့်သွင်းပြီး အသုံးပြုနိုင်ပါပြီ။
`.trim();

          const numericTgId = Number(order.telegramId);
          if (Number.isFinite(numericTgId)) {
            void sendTelegramMessage(tgMsg, { chatId: numericTgId }).catch(() => false);
          }
        }

        return { ok: true, orderId: order.id, subscriptionId: subscription.id };
      } catch (err) {
        const message =
          err instanceof PanelError
            ? err.message
            : err instanceof Error
              ? err.message
              : "VPN provisioning failed.";
        markFulfillFailed(order, message);
        txn.status = "failed";
        txn.note = message;
        return { ok: false, error: message };
      }
    });

    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error("[PGW Webhook Error]", err);
    return Response.json({ error: "Internal webhook processing error" }, { status: 500 });
  }
}
