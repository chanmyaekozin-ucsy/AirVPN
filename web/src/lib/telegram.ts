import { loadShopEnv } from "./shop-env";
import { formatDataGb, formatDuration, formatKs } from "./format";
import type { Order, Subscription, User } from "./types";

export type TelegramNotificationOptions = {
  chatId?: string | number;
};

/**
 * Send a notification message via the configured AirVPN Telegram bot.
 */
export async function sendTelegramMessage(
  text: string,
  options?: TelegramNotificationOptions,
): Promise<boolean> {
  loadShopEnv();
  const botToken = process.env.BOT_TOKEN || "";
  if (!botToken) {
    console.log("[Telegram] BOT_TOKEN not configured — skipping notification");
    return false;
  }

  // Get recipient chat IDs: group ID, or specific notify chat ID, or admin IDs
  const targetChatIds: (string | number)[] = [];
  if (options?.chatId) {
    targetChatIds.push(options.chatId);
  } else {
    if (process.env.PAYMENTS_PROOFS_GROUP_ID) {
      targetChatIds.push(process.env.PAYMENTS_PROOFS_GROUP_ID);
    }
    if (process.env.TELEGRAM_NOTIFY_CHAT_ID) {
      targetChatIds.push(process.env.TELEGRAM_NOTIFY_CHAT_ID);
    }
    // If no group is configured, fall back to first ADMIN_TELEGRAM_ID
    if (targetChatIds.length === 0 && process.env.ADMIN_TELEGRAM_IDS) {
      const firstAdmin = process.env.ADMIN_TELEGRAM_IDS.split(",")[0]?.trim();
      if (firstAdmin) targetChatIds.push(firstAdmin);
    }
  }

  if (targetChatIds.length === 0) {
    console.log("[Telegram] No Telegram recipient configured (PAYMENTS_PROOFS_GROUP_ID / ADMIN_TELEGRAM_IDS)");
    return false;
  }

  let anySent = false;
  for (const chatId of targetChatIds) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      if (res.ok) {
        anySent = true;
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.error("[Telegram] Error sending message:", errJson);
      }
    } catch (err) {
      console.error("[Telegram] Network error sending notification:", err);
    }
  }

  return anySent;
}

/**
 * Send a notification when a web purchase is successfully paid & fulfilled.
 */
export async function notifyPurchaseSuccess(input: {
  order: Order;
  subscription?: Subscription | null;
  user?: User | null;
}) {
  const { order, subscription, user } = input;
  const method = order.userLoginMethod || user?.loginMethod || "Email";
  const customerName = order.userName || user?.name || order.payeeName || "Customer";
  const contact = [order.userEmail || user?.email, order.userPhone || user?.phone].filter(Boolean).join(" · ");
  const txLine = order.txid ? `\n<b>TxID:</b> <code>${order.txid}</code>` : "";
  const payerLine = order.payeeName ? `\n<b>Payer Name:</b> ${order.payeeName}` : "";

  const text = `
<b>AirVPN Web — Purchase Successful</b>

<b>Order:</b> <code>#${order.id}</code>
<b>Server:</b> ${order.serverName}
<b>Plan:</b> ${order.planTitle} (${formatDataGb(order.dataGb)})
<b>Duration:</b> ${formatDuration(order.durationDays)}
<b>Amount:</b> <b>${formatKs(order.amountKs)}</b>
<b>Payment:</b> ${order.paymentMethod || "Direct"}${payerLine}${txLine}

<b>Customer:</b> ${customerName}
<b>Login Method:</b> ${method.toUpperCase()}
<b>Contact:</b> ${contact || "—"}
${subscription?.vlessKey ? `\n<b>VLESS Key Remark:</b>\n<code>${subscription.vlessKey.split("#")[1] || "AirVPN"}</code>` : ""}
`.trim();

  return sendTelegramMessage(text);
}

/**
 * Send a notification when an admin replaces / reissues a key or switches nodes.
 */
export async function notifyKeyReplaced(input: {
  subscription: Subscription;
  serverName: string;
  reason?: string;
  adminNote?: string;
}) {
  const { subscription, serverName, reason, adminNote } = input;
  const customerName = subscription.userName || "Customer";
  const loginMethod = subscription.userLoginMethod || "Unknown";

  const text = `
<b>AirVPN Web — Key Replaced</b>

<b>Customer:</b> ${customerName} (${loginMethod.toUpperCase()})
<b>Server / Node:</b> ${serverName}
<b>Plan:</b> ${subscription.planTitle} (${formatDataGb(subscription.dataGb)})
<b>Replacement Count:</b> #${subscription.replacementCount || 1}
<b>Reason:</b> ${reason || "Key re-issued"}
${adminNote ? `<b>Admin Note:</b> ${adminNote}\n` : ""}
<b>New Key Remark:</b> <code>${subscription.vlessKey.split("#")[1] || "AirVPN"}</code>
`.trim();

  return sendTelegramMessage(text);
}

/**
 * Send a notification when a customer requests key replacement from their order page.
 */
export async function notifyKeyReplacementRequest(input: {
  order: Order;
  subscription?: Subscription | null;
  reason: string;
  customerNote?: string;
}) {
  const { order, subscription, reason, customerNote } = input;
  const customerName = order.userName || subscription?.userName || "Customer";
  const contact = [order.userEmail, order.userPhone].filter(Boolean).join(" · ");

  const text = `
<b>AirVPN Web — Key Replacement Request</b>

<b>Order:</b> <code>#${order.id}</code>
<b>Server:</b> ${order.serverName}
<b>Plan:</b> ${order.planTitle} (${formatDataGb(order.dataGb)})
<b>Amount:</b> ${formatKs(order.amountKs)}
<b>Payment:</b> ${order.paymentMethod || "—"}

<b>Customer:</b> ${customerName} (${(order.userLoginMethod || "email").toUpperCase()})
<b>Contact:</b> ${contact || "—"}
<b>Reason:</b> <b>${reason}</b>
${customerNote ? `<b>Customer Note:</b> ${customerNote}\n` : ""}
<b>Action:</b> Replace key in Admin → Keys & Customers (/admin/keys)
`.trim();

  return sendTelegramMessage(text);
}

