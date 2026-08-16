import { NextRequest } from "next/server";
import { formatDataGb, formatDuration, formatKs, formatWhen } from "@/lib/format";
import { loadShopEnv } from "@/lib/shop-env";
import { readStore, updateStore } from "@/lib/store";
import type { User } from "@/lib/types";

type TelegramFrom = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type TelegramChat = {
  id: number;
  type: string;
  first_name?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  from?: TelegramFrom;
  chat: TelegramChat;
  date: number;
  text?: string;
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramFrom;
  message?: TelegramMessage;
  data?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

async function sendTg(method: string, body: Record<string, unknown>) {
  loadShopEnv();
  const token = process.env.BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error(`[Telegram Webhook] Error calling ${method}:`, err);
    return false;
  }
}

async function answerCallback(queryId: string, text?: string) {
  return sendTg("answerCallbackQuery", { callback_query_id: queryId, text });
}

function getAppBaseUrl(): string {
  loadShopEnv();
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.COOLIFY_URL ||
    "https://airnetworkshop.flash-myanmar.com"
  ).replace(/\/$/, "");
}

async function findOrCreateTgUser(from: TelegramFrom): Promise<User> {
  const tgId = from.username || String(from.id);
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ") || `TG User ${from.id}`;

  return updateStore<User>((store) => {
    const existing = store.users.find(
      (u) =>
        u.telegramId === tgId ||
        (from.username && u.telegramId?.toLowerCase() === from.username.toLowerCase()) ||
        u.id === `tg_${from.id}`,
    );

    if (existing) {
      if (from.username && (!existing.telegramId || existing.telegramId !== from.username)) {
        existing.telegramId = from.username;
      }
      if (fullName && (!existing.name || existing.name.startsWith("TG User"))) {
        existing.name = fullName;
      }
      return existing;
    }

    const created: User = {
      id: `tg_${from.id}`,
      phone: "",
      name: fullName,
      role: "user",
      balanceKs: 0,
      loginMethod: "wathanpay",
      telegramId: from.username || String(from.id),
      createdAt: new Date().toISOString(),
    };
    store.users.push(created);
    return created;
  });
}

function buildStartText(user: User): string {
  return `
<b>AirVPN Myanmar</b> 🇲🇲

Welcome, <b>${user.name || "Customer"}</b>!
Fast, stable & unblockable VLESS Reality VPN.

• Works on MPT, ATOM, Ooredoo, Mytel & All Wi-Fi
• High-speed Singapore & Global Server Nodes
• Pay securely with <b>WathanPay</b>, <b>KBZPay</b>, or <b>WavePay</b>

Tap <b>Open AirVPN Shop</b> below to choose your server & connect!
`.trim();
}

function buildStartKeyboard() {
  const appUrl = getAppBaseUrl();
  return {
    inline_keyboard: [
      [
        {
          text: "🌐 Open AirVPN Shop (Mini App)",
          web_app: { url: appUrl },
        },
      ],
      [
        { text: "📋 Plans & Pricing", callback_data: "cmd_plans" },
        { text: "🔑 My Keys / Subscription", callback_data: "cmd_mykeys" },
      ],
      [
        { text: "💬 Contact Admin Support", url: "https://t.me/airvpn_support" },
      ],
    ],
  };
}

async function handlePlans(chatId: number) {
  const store = await readStore();
  const activeServers = store.servers.filter((s) => s.isActive);
  const appUrl = getAppBaseUrl();

  if (activeServers.length === 0) {
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: "No VPN plans available at the moment. Please check back later!",
      parse_mode: "HTML",
    });
    return;
  }

  let text = "<b>AirVPN Plans & Pricing</b> 🇲🇲\n\n";

  for (const server of activeServers) {
    const serverPlans = store.plans.filter((p) => p.serverId === server.id && p.isActive);
    if (serverPlans.length === 0) continue;

    text += `<b>${server.name} (${server.region})</b>\n`;
    for (const plan of serverPlans) {
      text += `• <b>${plan.title}</b> (${formatDataGb(plan.dataGb)}) — <b>${formatKs(plan.priceKs)}</b> / ${formatDuration(plan.durationDays)}\n`;
    }
    text += "\n";
  }

  text += "⚡️ <i>All plans include unblockable VLESS Reality & high-speed bandwidth.</i>";

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🛒 Buy Now on AirVPN Shop",
            web_app: { url: appUrl },
          },
        ],
        [
          { text: "⬅️ Back to Menu", callback_data: "cmd_start" },
        ],
      ],
    },
  });
}

async function handleMyKeys(chatId: number, from: TelegramFrom) {
  const store = await readStore();
  const tgId = (from.username || "").toLowerCase();
  const tgUserId = `tg_${from.id}`;
  const appUrl = getAppBaseUrl();

  const userSubs = store.subscriptions.filter(
    (s) =>
      s.userId === tgUserId ||
      (tgId && s.userEmail?.toLowerCase().includes(tgId)) ||
      (tgId && s.userName?.toLowerCase().includes(tgId)) ||
      (tgId && s.notes?.toLowerCase().includes(tgId)),
  );

  if (userSubs.length === 0) {
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: `
<b>No Active VPN Keys Found</b>

We couldn't find active subscriptions linked to @${from.username || from.id}.
If you purchased via our web shop, open the shop link below or contact support.
`.trim(),
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🌐 Open AirVPN Shop", web_app: { url: appUrl } }],
          [{ text: "⬅️ Back to Menu", callback_data: "cmd_start" }],
        ],
      },
    });
    return;
  }

  let text = `<b>Your AirVPN Subscriptions (${userSubs.length})</b>\n\n`;

  for (const sub of userSubs) {
    const server = store.servers.find((s) => s.id === sub.serverId);
    const serverName = server?.name || sub.serverId;
    text += `<b>${serverName} · ${sub.planTitle}</b>\n`;
    text += `• Status: <b>${sub.status.toUpperCase()}</b>\n`;
    text += `• Data: ${formatDataGb(sub.dataGb)}\n`;
    text += `• Expires: ${sub.expiresAt ? formatWhen(sub.expiresAt) : formatDuration(sub.durationDays)}\n`;
    if (sub.subUrl) {
      text += `• <b>Subscription URL:</b>\n<code>${sub.subUrl}</code>\n`;
    }
    text += "\n";
  }

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🌐 Open AirVPN Shop", web_app: { url: appUrl } }],
        [{ text: "💬 Support / Key Help", url: "https://t.me/airvpn_support" }],
      ],
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const update = (await req.json().catch(() => ({}))) as TelegramUpdate;

    // Handle button callbacks
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || "";
      const chatId = cb.message?.chat.id || cb.from.id;

      if (data === "cmd_plans") {
        await answerCallback(cb.id);
        await handlePlans(chatId);
      } else if (data === "cmd_mykeys") {
        await answerCallback(cb.id);
        await handleMyKeys(chatId, cb.from);
      } else if (data === "cmd_start") {
        await answerCallback(cb.id);
        const user = await findOrCreateTgUser(cb.from);
        await sendTg("sendMessage", {
          chat_id: chatId,
          text: buildStartText(user),
          parse_mode: "HTML",
          reply_markup: buildStartKeyboard(),
        });
      } else {
        await answerCallback(cb.id);
      }

      return Response.json({ ok: true });
    }

    // Handle text messages
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = (msg.text || "").trim();
      const from = msg.from;

      if (from && text) {
        const user = await findOrCreateTgUser(from);

        if (text.startsWith("/start") || text.startsWith("/shop")) {
          await sendTg("sendMessage", {
            chat_id: chatId,
            text: buildStartText(user),
            parse_mode: "HTML",
            reply_markup: buildStartKeyboard(),
          });
        } else if (text.startsWith("/plans")) {
          await handlePlans(chatId);
        } else if (text.startsWith("/mykeys") || text.startsWith("/keys")) {
          await handleMyKeys(chatId, from);
        } else if (text.startsWith("/help") || text.startsWith("/support")) {
          await sendTg("sendMessage", {
            chat_id: chatId,
            text: `
<b>AirVPN Customer Support</b>

Need help with key replacement, payments, or setup?
• Open our Web App: ${getAppBaseUrl()}
• Admin Support: @airvpn_support
`.trim(),
            parse_mode: "HTML",
          });
        } else {
          // Default fallback response
          await sendTg("sendMessage", {
            chat_id: chatId,
            text: buildStartText(user),
            parse_mode: "HTML",
            reply_markup: buildStartKeyboard(),
          });
        }
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error handling update:", err);
    return Response.json({ ok: true });
  }
}
