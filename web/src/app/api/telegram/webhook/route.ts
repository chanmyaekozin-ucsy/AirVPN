import { NextRequest } from "next/server";
import { createDeposit, listPaymentMethods, paidStatus, verifyDepositLast5 } from "@/lib/dominate";
import { formatDataGb, formatDuration, formatKs, formatWhen } from "@/lib/format";
import { fulfillOrder, markFulfillFailed } from "@/lib/fulfill";
import { PanelError } from "@/lib/panel";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { loadShopEnv } from "@/lib/shop-env";
import { readStore, updateStore } from "@/lib/store";
import { getTelegramWebhookSecret, notifyKeyReplacementRequest, notifyPurchaseSuccess } from "@/lib/telegram";
import type { Order, Transaction, User } from "@/lib/types";

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

type Lang = "my" | "en";

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

async function answerCallback(queryId: string, text?: string, alert = false) {
  return sendTg("answerCallbackQuery", { callback_query_id: queryId, text, show_alert: alert });
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
      email: "",
      name: fullName,
      role: "user",
      balanceKs: 0,
      loginMethod: "phone",
      telegramId: from.username || String(from.id),
      createdAt: new Date().toISOString(),
    };
    store.users.push(created);
    return created;
  });
}

async function setUserLanguage(userId: string, lang: Lang) {
  await updateStore((store) => {
    const u = store.users.find((x) => x.id === userId);
    if (u) {
      u.language = lang;
    }
  });
}

/** Language Selection Prompt */
async function promptLanguageSelection(chatId: number) {
  const text = `
<b>Please choose your language / ဘာသာစကား ရွေးချယ်ပါ</b>

အသုံးပြုလိုသော ဘာသာစကားကို ရွေးချယ်ပေးပါ:
`.trim();

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "မြန်မာစာ (Myanmar)", callback_data: "set_lang:my" },
          { text: "English", callback_data: "set_lang:en" },
        ],
      ],
    },
  });
}

function mainMenuKeyboard(lang: Lang) {
  const appUrl = getAppBaseUrl();
  if (lang === "my") {
    return {
      inline_keyboard: [
        [
          { text: "VPN ဝယ်ယူရန်", callback_data: "buy_servers" },
          { text: "ပလန်များ ကြည့်ရန်", callback_data: "cmd_plans" },
        ],
        [
          { text: "ကျွန်ုပ်၏ ကီးများ", callback_data: "cmd_mykeys" },
          { text: "အကူအညီ ရယူရန်", callback_data: "cmd_support" },
        ],
        [
          { text: "ဘာသာစကား ပြောင်းရန်", callback_data: "cmd_lang" },
        ],
        [
          { text: "Web Shop ဖွင့်ရန် (WathanPay)", web_app: { url: appUrl } },
        ],
      ],
    };
  }

  return {
    inline_keyboard: [
      [
        { text: "Buy VPN", callback_data: "buy_servers" },
        { text: "View Plans", callback_data: "cmd_plans" },
      ],
      [
        { text: "My Keys", callback_data: "cmd_mykeys" },
        { text: "Support", callback_data: "cmd_support" },
      ],
      [
        { text: "Change Language", callback_data: "cmd_lang" },
      ],
      [
        { text: "Open Web Shop (WathanPay)", web_app: { url: appUrl } },
      ],
    ],
  };
}

async function handleMainMenu(chatId: number, user: User) {
  const lang: Lang = user.language || "my";

  if (lang === "my") {
    const text = `
<b>AirVPN Myanmar</b>

မင်္ဂလာပါ <b>${user.name || "Customer"}</b>!
အမြန်ဆုံးနှင့် အပိတ်မရှိ VLESS Reality VPN ဝန်ဆောင်မှု။

• MPT, ATOM, Ooredoo, Mytel နှင့် Wi-Fi အားလုံးတွင် အဆင်ပြေစွာ သုံးနိုင်သည်
• Singapore & Global Server Node များ
• KBZPay နှင့် WavePay ဖြင့် တိုက်ရိုက် ဝယ်ယူနိုင်ပါသည်

အောက်ပါ Menu မှ စတင် ဝယ်ယူ အသုံးပြုနိုင်ပါသည်:
`.trim();

    await sendTg("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard("my"),
    });
  } else {
    const text = `
<b>AirVPN Myanmar</b>

Welcome <b>${user.name || "Customer"}</b>!
Fast and unblockable VLESS Reality VPN Service.

• Works smoothly across MPT, ATOM, Ooredoo, Mytel, and all Wi-Fi networks
• Singapore & Global High-Speed Server Nodes
• Direct Payment via KBZPay and WavePay

Select an option below to get started:
`.trim();

    await sendTg("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard("en"),
    });
  }
}

/** Step 1: Choose Server Node */
async function handleBuyServers(chatId: number, lang: Lang) {
  const store = await readStore();
  const activeServers = store.servers.filter((s) => s.isActive);

  if (activeServers.length === 0) {
    const emptyMsg = lang === "my"
      ? "လက်ရှိတွင် VPN ဆာဗာများ မရှိသေးပါ။ ခေတ္တစောင့်ဆိုင်းပေးပါ။"
      : "No active VPN servers available right now. Please check back later.";
    await sendTg("sendMessage", { chat_id: chatId, text: emptyMsg, parse_mode: "HTML" });
    return;
  }

  const buttons = activeServers.map((server) => [
    {
      text: lang === "my" && server.nameMy ? `${server.nameMy} (${server.region})` : `${server.name} (${server.region})`,
      callback_data: `buy_srv:${server.id}`,
    },
  ]);
  buttons.push([{ text: lang === "my" ? "ပင်မစာမျက်နှာသို့" : "Back to Menu", callback_data: "cmd_start" }]);

  const text = lang === "my"
    ? "<b>ဆာဗာ တည်နေရာ ရွေးချယ်ပါ:</b>\n\nအသုံးပြုလိုသော ဆာဗာကို ရွေးချယ်ပါ:"
    : "<b>Choose Server Location:</b>\n\nPlease select your preferred server node:";

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
}

/** Step 2: Choose Plan for Server */
async function handleBuyServerPlans(chatId: number, serverId: string, lang: Lang) {
  const store = await readStore();
  const server = store.servers.find((s) => s.id === serverId);
  if (!server) {
    await handleBuyServers(chatId, lang);
    return;
  }

  const serverName = lang === "my" && server.nameMy ? server.nameMy : server.name;
  const plans = store.plans.filter((p) => p.serverId === serverId && p.isActive);

  if (plans.length === 0) {
    const emptyMsg = lang === "my"
      ? `<b>${serverName}</b> အတွက် ပလန်များ မရှိသေးပါ။`
      : `No plans found for <b>${server.name}</b>.`;
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: emptyMsg,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: lang === "my" ? "ဆာဗာများသို့ ပြန်သွားရန်" : "Back to Servers", callback_data: "buy_servers" }]],
      },
    });
    return;
  }

  const buttons = plans.map((plan) => [
    {
      text: `${plan.title} (${formatDataGb(plan.dataGb)}) — ${formatKs(plan.priceKs)}`,
      callback_data: `buy_plan:${plan.id}`,
    },
  ]);
  buttons.push([{ text: lang === "my" ? "ဆာဗာများသို့ ပြန်သွားရန်" : "Back to Servers", callback_data: "buy_servers" }]);

  const text = lang === "my"
    ? `<b>${serverName} — ပလန် ရွေးချယ်ပါ:</b>\n\nဝယ်ယူလိုသော ပက်ကေ့ချ်ကို ရွေးချယ်ပါ:`
    : `<b>${server.name} (${server.region}) — Choose Plan:</b>\n\nPlease select a package:`;

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
}

/** Step 3: Choose Payment Method */
async function handleBuyPlan(chatId: number, planId: string, lang: Lang) {
  const store = await readStore();
  const plan = store.plans.find((p) => p.id === planId);
  if (!plan) {
    await handleBuyServers(chatId, lang);
    return;
  }
  const server = store.servers.find((s) => s.id === plan.serverId);
  const serverName = lang === "my" && server?.nameMy ? server.nameMy : (server?.name || plan.serverId);
  const methods = await listPaymentMethods();

  const buttons: { text: string; callback_data: string }[][] = [];

  for (const m of methods) {
    const btnLabel = lang === "my"
      ? `${m.method} ဖြင့် ပေးချေမည် (${m.accountName || ""})`
      : `Pay with ${m.method} (${m.accountName || ""})`;

    buttons.push([
      {
        text: btnLabel,
        callback_data: `buy_pay:${plan.id}:${m.id}`,
      },
    ]);
  }

  buttons.push([
    { text: lang === "my" ? "ပလန်များသို့ ပြန်သွားရန်" : "Back to Plans", callback_data: `buy_srv:${plan.serverId}` },
  ]);

  const text = lang === "my"
    ? `
<b>အော်ဒါ အကျဉ်းချုပ်</b>

• <b>ဆာဗာ:</b> ${serverName}
• <b>ပလန်:</b> ${plan.title} (${formatDataGb(plan.dataGb)})
• <b>သက်တမ်း:</b> ${formatDuration(plan.durationDays)}
• <b>ကျသင့်ငွေ:</b> <b>${formatKs(plan.priceKs)}</b>

ပေးချေလိုသော ငွေပေးချေနည်းလမ်းကို ရွေးချယ်ပါ:
`.trim()
    : `
<b>Order Summary</b>

• <b>Server:</b> ${server?.name || plan.serverId}
• <b>Plan:</b> ${plan.title} (${formatDataGb(plan.dataGb)})
• <b>Duration:</b> ${formatDuration(plan.durationDays)}
• <b>Price:</b> <b>${formatKs(plan.priceKs)}</b>

Please select a payment method:
`.trim();

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
}

/** Step 4: Create Order & Show Deposit Details */
async function handleCreateDeposit(chatId: number, user: User, planId: string, accountId: string, lang: Lang) {
  const store = await readStore();
  const plan = store.plans.find((p) => p.id === planId);
  if (!plan) {
    await handleBuyServers(chatId, lang);
    return;
  }
  const server = store.servers.find((s) => s.id === plan.serverId);
  const serverName = lang === "my" && server?.nameMy ? server.nameMy : (server?.name || plan.serverId);
  const methods = await listPaymentMethods();
  const method = methods.find((m) => m.id === accountId) || methods[0];

  if (!method) {
    const unavailableMsg = lang === "my"
      ? "ငွေပေးချေမှု လိုင်း ခေတ္တမအားလပ်ပါ။ နောက်မှ ပြန်လည်ကြိုးစားပါ။"
      : "Payment gateway is temporarily unavailable. Please try again later.";
    await sendTg("sendMessage", { chat_id: chatId, text: unavailableMsg, parse_mode: "HTML" });
    return;
  }

  // Create Order in store
  const order = await updateStore((s) => {
    const ord: Order = {
      id: `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      userId: user.id,
      serverId: plan.serverId,
      serverName: server?.name || plan.serverId,
      planId: plan.id,
      planTitle: plan.title,
      dataGb: plan.dataGb,
      durationDays: plan.durationDays,
      amountKs: plan.priceKs,
      status: "awaiting_payment",
      paymentMethod: method.method,
      depositId: null,
      payeeName: method.accountName,
      payeePhone: method.accountNumber,
      txid: null,
      failReason: null,
      subscriptionId: null,
      userLoginMethod: "phone",
      userName: user.name,
      telegramId: user.telegramId,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    s.orders.push(ord);
    return ord;
  });

  // Call Dominate Gateway to create deposit
  try {
    const deposit = await createDeposit({
      accountId: method.id,
      amountKs: plan.priceKs,
      orderId: order.id,
    });
    const payee = deposit.payee || {};

    await updateStore((s) => {
      const found = s.orders.find((o) => o.id === order.id);
      if (found) {
        found.depositId = deposit.id;
        found.payeeName = String(payee.display_name || found.payeeName || method.accountName);
        found.payeePhone = String(payee.msisdn || found.payeePhone || method.accountNumber);
      }
    });

    order.depositId = deposit.id;
    order.payeeName = String(payee.display_name || order.payeeName);
    order.payeePhone = String(payee.msisdn || order.payeePhone);
  } catch (err) {
    console.error("[Telegram Deposit] Gateway createDeposit failed:", err);
  }

  const text = lang === "my"
    ? `
<b>အော်ဒါ #${order.id}</b>

• <b>ဆာဗာ:</b> ${serverName}
• <b>ပလန်:</b> ${order.planTitle} (${formatDataGb(order.dataGb)})
• <b>ကျသင့်ငွေ:</b> <b>${formatKs(order.amountKs)}</b> (ကျပ်တိတိ)

<b>ငွေပေးချေနည်းလမ်း:</b> <b>${order.paymentMethod}</b>
<b>အကောင့်အမည်:</b> <code>${order.payeeName || method.accountName}</code>
<b>အကောင့်နံပါတ်:</b> <code>${order.payeePhone || method.accountNumber}</code>

━━━━━━━━━━━━━━━━━━━━
<b>ငွေလွှဲပြီးပါက ပြုလုပ်ရန်:</b>
၁။ အထက်ပါ အကောင့်သို့ <b>${formatKs(order.amountKs)}</b> တိတိ လွှဲပေးပါ။
၂။ ငွေလွှဲပြေစာမှ <b>TxID (နောက်ဆုံး ၅ လုံး)</b> ကို ဤ Chat တွင် စာရိုက်ပို့ပေးပါ (ဥပမာ: <code>12345</code>)။
━━━━━━━━━━━━━━━━━━━━
`.trim()
    : `
<b>Order #${order.id}</b>

• <b>Server:</b> ${order.serverName}
• <b>Plan:</b> ${order.planTitle} (${formatDataGb(order.dataGb)})
• <b>Amount to Pay:</b> <b>${formatKs(order.amountKs)}</b>

<b>Payment Method:</b> <b>${order.paymentMethod}</b>
<b>Account Name:</b> <code>${order.payeeName || method.accountName}</code>
<b>Account Number:</b> <code>${order.payeePhone || method.accountNumber}</code>

━━━━━━━━━━━━━━━━━━━━
<b>Next Steps:</b>
1. Transfer exact <b>${formatKs(order.amountKs)}</b> to the account above.
2. Send the <b>Last 5 digits of your TxID</b> directly in this chat (e.g. <code>12345</code>).
━━━━━━━━━━━━━━━━━━━━
`.trim();

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: lang === "my" ? "အော်ဒါ ပယ်ဖျက်မည်" : "Cancel Order", callback_data: `cancel_ord:${order.id}` },
          { text: lang === "my" ? "အခြေအနေ ပြန်စစ်မည်" : "Refresh Status", callback_data: `check_ord:${order.id}` },
        ],
      ],
    },
  });
}

/** Step 5: User sends TxID / 5 digits in chat */
async function handleTxidSubmission(chatId: number, user: User, inputTxid: string) {
  const lang: Lang = user.language || "my";
  const store = await readStore();
  const digits = inputTxid.replace(/\D/g, "");
  const last5 = digits.length >= 5 ? digits.slice(-5) : "";

  if (last5.length !== 5) {
    const warnMsg = lang === "my"
      ? "ကျေးဇူးပြု၍ ငွေလွှဲပြေစာမှ <b>TxID နောက်ဆုံး ၅ လုံး</b> (ဥပမာ: <code>12345</code>) ကို ရိုက်ပို့ပေးပါ။"
      : "Please send the <b>last 5 digits of your Transaction ID (TxID)</b> (e.g. <code>12345</code>).";
    await sendTg("sendMessage", { chat_id: chatId, text: warnMsg, parse_mode: "HTML" });
    return;
  }

  // Find user's active awaiting order
  const pendingOrders = store.orders.filter(
    (o) => o.userId === user.id && o.status === "awaiting_payment",
  );

  if (pendingOrders.length === 0) {
    const noOrdMsg = lang === "my"
      ? "ငွေပေးချေရန် စောင့်ဆိုင်းနေသော အော်ဒါ မတွေ့ပါ။ အသစ်ဝယ်ယူလိုပါက /start ကို နှိပ်ပါ။"
      : "No pending order awaiting payment found. Please type /start to create a new order.";
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: noOrdMsg,
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(lang),
    });
    return;
  }

  const order = pendingOrders[pendingOrders.length - 1];

  const verifyingMsg = lang === "my"
    ? `TxID <code>${last5}</code> ဖြင့် ငွေလွှဲစစ်ဆေးနေပါသည်... ခေတ္တစောင့်ပေးပါ။`
    : `Verifying transaction with TxID <code>${last5}</code>... Please wait.`;

  await sendTg("sendMessage", { chat_id: chatId, text: verifyingMsg, parse_mode: "HTML" });

  if (order.depositId) {
    try {
      const deposit = await verifyDepositLast5(order.depositId, last5);
      const isPaid = paidStatus(deposit.status);
      const txid = String(deposit.bank_trx_id || deposit.trx_id || last5);

      if (!isPaid) {
        const notFoundText = lang === "my"
          ? `
<b>ငွေလွှဲပြေစာ မတွေ့ရှိသေးပါ</b>

လွှဲငွေ <b>${formatKs(order.amountKs)}</b> နှင့် TxID <code>${last5}</code> ကို စစ်ဆေးနေဆဲဖြစ်ပါသည်။
ငွေလွှဲပြီးပါက ၁ မိနစ်ခန့်စောင့်ပြီး TxID ၅ လုံးကို ပြန်လည်ပို့ပေးပါ။
`.trim()
          : `
<b>Payment Record Not Found Yet</b>

Checking transfer of <b>${formatKs(order.amountKs)}</b> with TxID <code>${last5}</code>.
Please wait a minute after transfer and send the 5 digits again.
`.trim();

        await sendTg("sendMessage", {
          chat_id: chatId,
          text: notFoundText,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: lang === "my" ? "ပြန်လည်စစ်ဆေးမည်" : "Check Again", callback_data: `check_ord:${order.id}` }],
              [{ text: lang === "my" ? "Order ပယ်ဖျက်မည်" : "Cancel Order", callback_data: `cancel_ord:${order.id}` }],
            ],
          },
        });
        return;
      }

      // Deliver & Fulfill VPN Key!
      const deliveryResult = await updateStore(async (s) => {
        const ord = s.orders.find((o) => o.id === order.id);
        if (!ord) throw new Error("Order missing");
        ord.txid = txid;
        ord.status = "processing";

        const txn: Transaction = {
          id: `txn_${Date.now().toString(36)}`,
          orderId: ord.id,
          userId: ord.userId,
          amountKs: ord.amountKs,
          method: ord.paymentMethod || "KBZPay",
          txid,
          status: "succeeded",
          note: `${ord.paymentMethod} Bot direct`,
          createdAt: new Date().toISOString(),
        };
        s.transactions.push(txn);

        try {
          const subscription = await fulfillOrder(s, ord);
          void notifyPurchaseSuccess({ order: ord, subscription, user }).catch(() => false);
          return { order: ord, subscription };
        } catch (err) {
          const msg = err instanceof PanelError ? err.message : "VPN provisioning failed.";
          markFulfillFailed(ord, msg);
          return { order: ord, subscription: null, error: msg };
        }
      });

      if (!deliveryResult.subscription) {
        const failMsg = lang === "my"
          ? "ငွေပေးချေမှု အောင်မြင်သော်လည်း VPN Key ထုတ်ပေးရာတွင် ချို့ယွင်းချက်ရှိပါသည်။ Support @dominate_x17 သို့ ဆက်သွယ်ပေးပါ။"
          : "Payment verified but VPN key provisioning failed. Please contact Support @dominate_x17.";
        await sendTg("sendMessage", { chat_id: chatId, text: failMsg, parse_mode: "HTML" });
        return;
      }

      const sub = deliveryResult.subscription;
      const successText = lang === "my"
        ? `
<b>ငွေပေးချေမှု အောင်မြင်ပြီး VPN Key အဆင်သင့်ဖြစ်ပါပြီ</b>

• <b>ဆာဗာ:</b> ${order.serverName}
• <b>ပလန်:</b> ${order.planTitle} (${formatDataGb(order.dataGb)})
• <b>သက်တမ်း:</b> ${formatDuration(order.durationDays)}
• <b>TxID:</b> <code>${txid}</code>

━━━━━━━━━━━━━━━━━━━━
<b>VLESS Key (ကူးယူရန် နှိပ်ပါ):</b>
<code>${sub.vlessKey}</code>

<b>Subscription URL:</b>
<code>${sub.subUrl}</code>
━━━━━━━━━━━━━━━━━━━━
v2rayNG / Hiddify / Streisand ထဲသို့ ထည့်သွင်းပြီး ချိတ်ဆက် အသုံးပြုနိုင်ပါပြီ။
`.trim()
        : `
<b>Payment Confirmed & VPN Key Ready</b>

• <b>Server:</b> ${order.serverName}
• <b>Plan:</b> ${order.planTitle} (${formatDataGb(order.dataGb)})
• <b>Duration:</b> ${formatDuration(order.durationDays)}
• <b>TxID:</b> <code>${txid}</code>

━━━━━━━━━━━━━━━━━━━━
<b>VLESS Key (Tap to Copy):</b>
<code>${sub.vlessKey}</code>

<b>Subscription URL:</b>
<code>${sub.subUrl}</code>
━━━━━━━━━━━━━━━━━━━━
Import into v2rayNG / Hiddify / Streisand to connect immediately.
`.trim();

      await sendTg("sendMessage", {
        chat_id: chatId,
        text: successText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: lang === "my" ? "ကျွန်ုပ်၏ ကီးများ" : "My Keys", callback_data: "cmd_mykeys" }],
            [{ text: lang === "my" ? "ပင်မစာမျက်နှာ" : "Main Menu", callback_data: "cmd_start" }],
          ],
        },
      });
      return;
    } catch (err) {
      console.error("[Telegram Webhook] verifyDeposit error:", err);
      const errMsg = lang === "my"
        ? "ငွေလွှဲစစ်ဆေးရာတွင် ချို့ယွင်းချက်ဖြစ်ပေါ်ခဲ့ပါသည်။ ခေတ္တစောင့်ပြီး ပြန်လည်ပို့ပေးပါ။"
        : "An error occurred while verifying the payment. Please wait a moment and try again.";
      await sendTg("sendMessage", { chat_id: chatId, text: errMsg, parse_mode: "HTML" });
      return;
    }
  }
}

/** Check order status button */
async function handleCheckOrder(chatId: number, user: User, orderId: string, lang: Lang) {
  const store = await readStore();
  const order = store.orders.find((o) => o.id === orderId && o.userId === user.id);
  if (!order) {
    const notFoundMsg = lang === "my" ? "အော်ဒါ မတွေ့ရှိပါ။ /start ကို နှိပ်ပါ။" : "Order not found. Please type /start.";
    await sendTg("sendMessage", { chat_id: chatId, text: notFoundMsg, parse_mode: "HTML" });
    return;
  }

  if (order.status === "success") {
    await handleMyKeys(chatId, { id: Number(user.id.replace(/\D/g, "") || "0"), username: user.telegramId }, lang);
    return;
  }

  const text = lang === "my"
    ? `
Order #${order.id}
Status: <b>${order.status.toUpperCase()}</b>
ငွေလွှဲပြီးပါက TxID နောက်ဆုံး ၅ လုံးကို ဤ Chat တွင် စာရိုက်ပို့ပေးပါ။
`.trim()
    : `
Order #${order.id}
Status: <b>${order.status.toUpperCase()}</b>
Please send the last 5 digits of your TxID in this chat.
`.trim();

  await sendTg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

/** Cancel order button */
async function handleCancelOrder(chatId: number, user: User, orderId: string, lang: Lang) {
  await updateStore((s) => {
    const order = s.orders.find((o) => o.id === orderId && o.userId === user.id);
    if (order && order.status === "awaiting_payment") {
      order.status = "cancelled";
      order.completedAt = new Date().toISOString();
    }
  });

  const text = lang === "my"
    ? `Order #${orderId} ကို ပယ်ဖျက်ပြီးပါပြီ။`
    : `Order #${orderId} has been cancelled.`;

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(lang),
  });
}

/** View Plans */
async function handlePlans(chatId: number, lang: Lang) {
  const store = await readStore();
  const activeServers = store.servers.filter((s) => s.isActive);

  if (activeServers.length === 0) {
    const msg = lang === "my"
      ? "လက်ရှိတွင် VPN ပလန်များ မရှိသေးပါ။"
      : "No VPN plans available at the moment.";
    await sendTg("sendMessage", { chat_id: chatId, text: msg, parse_mode: "HTML" });
    return;
  }

  let text = lang === "my" ? "<b>AirVPN ပလန်များနှင့် ဈေးနှုန်းများ</b>\n\n" : "<b>AirVPN Plans & Pricing</b>\n\n";

  for (const server of activeServers) {
    const serverPlans = store.plans.filter((p) => p.serverId === server.id && p.isActive);
    if (serverPlans.length === 0) continue;

    const srvName = lang === "my" && server.nameMy ? server.nameMy : server.name;
    text += `<b>${srvName} (${server.region})</b>\n`;
    for (const plan of serverPlans) {
      text += `• <b>${plan.title}</b> (${formatDataGb(plan.dataGb)}) — <b>${formatKs(plan.priceKs)}</b> / ${formatDuration(plan.durationDays)}\n`;
    }
    text += "\n";
  }

  text += lang === "my"
    ? "ပလန်အားလုံးတွင် အပိတ်အဆို့မရှိ VLESS Reality နှင့် မြန်နှုန်းမြင့် Bandwidth ပါဝင်ပါသည်။"
    : "All plans include unblockable VLESS Reality & high-speed bandwidth.";

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: lang === "my" ? "VPN ဝယ်ယူရန်" : "Buy VPN", callback_data: "buy_servers" }],
        [{ text: lang === "my" ? "ပင်မစာမျက်နှာသို့" : "Back to Menu", callback_data: "cmd_start" }],
      ],
    },
  });
}

/** View My Keys */
async function handleMyKeys(chatId: number, from: TelegramFrom, lang: Lang) {
  const store = await readStore();
  const tgId = (from.username || "").toLowerCase();
  const tgUserId = `tg_${from.id}`;

  const userSubs = store.subscriptions.filter(
    (s) =>
      s.userId === tgUserId ||
      (tgId && s.userEmail?.toLowerCase().includes(tgId)) ||
      (tgId && s.userName?.toLowerCase().includes(tgId)) ||
      (tgId && s.notes?.toLowerCase().includes(tgId)),
  );

  if (userSubs.length === 0) {
    const emptyText = lang === "my"
      ? `
<b>အသုံးပြုဆဲ VPN ကီး မတွေ့ရှိပါ</b>

@${from.username || from.id} နှင့် ချိတ်ဆက်ထားသော VPN ကီး မရှိသေးပါ။
အောက်ပါ Menu မှ စတင်ဝယ်ယူနိုင်ပါသည်:
`.trim()
      : `
<b>No Active VPN Keys Found</b>

No active VPN subscription linked with @${from.username || from.id}.
You can purchase a new plan from the menu below:
`.trim();

    await sendTg("sendMessage", {
      chat_id: chatId,
      text: emptyText,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: lang === "my" ? "VPN ဝယ်ယူရန်" : "Buy VPN", callback_data: "buy_servers" }],
          [{ text: lang === "my" ? "ပင်မစာမျက်နှာသို့" : "Back to Menu", callback_data: "cmd_start" }],
        ],
      },
    });
    return;
  }

  let text = lang === "my"
    ? `<b>သင့်၏ VPN ကီးများ (${userSubs.length})</b>\n\n`
    : `<b>Your AirVPN Subscriptions (${userSubs.length})</b>\n\n`;

  const buttons: { text: string; callback_data: string }[][] = [];

  for (const sub of userSubs) {
    const server = store.servers.find((s) => s.id === sub.serverId);
    const serverName = lang === "my" && server?.nameMy ? server.nameMy : (server?.name || sub.serverId);
    text += `<b>${serverName} · ${sub.planTitle}</b>\n`;
    text += `• Status: <b>${sub.status.toUpperCase()}</b>\n`;
    text += `• Data: ${formatDataGb(sub.dataGb)}\n`;
    text += `• Expires: ${sub.expiresAt ? formatWhen(sub.expiresAt) : formatDuration(sub.durationDays)}\n`;
    if (sub.vlessKey) {
      text += `• <b>VLESS Key:</b>\n<code>${sub.vlessKey}</code>\n`;
    }
    if (sub.subUrl) {
      text += `• <b>Subscription URL:</b>\n<code>${sub.subUrl}</code>\n`;
    }
    text += "\n";

    buttons.push([
      {
        text: lang === "my" ? `ကီး အသစ်လဲလှယ်ရန် (${serverName})` : `Request Key Replacement (${serverName})`,
        callback_data: `req_rep:${sub.id}`,
      },
    ]);
  }

  buttons.push([{ text: lang === "my" ? "ပင်မစာမျက်နှာ" : "Main Menu", callback_data: "cmd_start" }]);

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
}

/** Request Key Replacement from Bot */
async function handleRequestReplacement(chatId: number, user: User, subId: string, lang: Lang) {
  const store = await readStore();
  const sub = store.subscriptions.find((s) => s.id === subId);
  if (!sub) {
    const notFoundMsg = lang === "my" ? "ကီး မတွေ့ရှိပါ။" : "Subscription not found.";
    await sendTg("sendMessage", { chat_id: chatId, text: notFoundMsg, parse_mode: "HTML" });
    return;
  }

  const order = store.orders.find((o) => o.id === sub.orderId || o.subscriptionId === sub.id) || {
    id: sub.orderId || "unknown",
    userId: sub.userId,
    serverId: sub.serverId,
    serverName: sub.serverId,
    planId: "",
    planTitle: sub.planTitle,
    dataGb: sub.dataGb,
    durationDays: sub.durationDays,
    amountKs: 0,
    status: "success",
    paymentMethod: "Telegram Bot",
    depositId: null,
    payeeName: null,
    payeePhone: null,
    txid: null,
    failReason: null,
    subscriptionId: sub.id,
    userName: user.name,
    userPhone: user.phone,
    createdAt: sub.createdAt,
    completedAt: null,
  };

  const reason = "Connection / Blocked Key issue (via Telegram Bot)";

  await updateStore((s) => {
    const foundSub = s.subscriptions.find((x) => x.id === sub.id);
    if (foundSub) {
      foundSub.replacementRequested = true;
      foundSub.replacementReason = reason;
      foundSub.replacementRequestedAt = new Date().toISOString();
      const log = `[${new Date().toISOString().slice(0, 16)}] Key replacement requested via Telegram bot`;
      foundSub.notes = foundSub.notes ? `${foundSub.notes}\n${log}` : log;
    }
  });

  void notifyKeyReplacementRequest({
    order: order as Order,
    subscription: sub,
    reason,
    customerNote: `Requested by @${user.telegramId || user.name}`,
  }).catch(() => false);

  const text = lang === "my"
    ? `
<b>ကီး လဲလှယ်ခွင့် တောင်းဆိုမှု ပေးပို့ပြီးပါပြီ</b>

ဆာဗာ: ${sub.planTitle}
အခြေအနေ: <b>စိစစ်နေဆဲ</b>

Admin များထံသို့ အကြောင်းကြားပြီးပါပြီ။ အမြန်ဆုံး အသစ်လဲလှယ်ပေးပါမည်။
`.trim()
    : `
<b>Key Replacement Request Sent</b>

Server: ${sub.planTitle}
Status: <b>Under Review</b>

Our administrators have been notified. A new key will be issued promptly.
`.trim();

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(lang),
  });
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`tg_webhook:${ip}`, 120, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    // Verify Telegram Secret Token header if secret is configured
    const expectedSecret = getTelegramWebhookSecret();
    if (expectedSecret) {
      const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token");
      if (incomingSecret !== expectedSecret) {
        return Response.json({ error: "Unauthorized webhook caller" }, { status: 401 });
      }
    }

    const update = (await req.json().catch(() => ({}))) as TelegramUpdate;

    // ─── 1. Handle Inline Button Callbacks ──────────────────────────────────
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || "";
      const chatId = cb.message?.chat.id || cb.from.id;
      const user = await findOrCreateTgUser(cb.from);
      const lang: Lang = user.language || "my";

      if (data.startsWith("set_lang:")) {
        await answerCallback(cb.id);
        const selectedLang = data.slice("set_lang:".length) as Lang;
        await setUserLanguage(user.id, selectedLang);
        user.language = selectedLang;
        await handleMainMenu(chatId, user);
      } else if (data === "cmd_lang") {
        await answerCallback(cb.id);
        await promptLanguageSelection(chatId);
      } else if (data === "cmd_start" || data === "main_menu") {
        await answerCallback(cb.id);
        await handleMainMenu(chatId, user);
      } else if (data === "buy_servers") {
        await answerCallback(cb.id);
        await handleBuyServers(chatId, lang);
      } else if (data.startsWith("buy_srv:") || data.startsWith("buy_srv_")) {
        await answerCallback(cb.id);
        const srvId = data.startsWith("buy_srv:")
          ? data.slice("buy_srv:".length)
          : data.slice("buy_srv_".length);
        await handleBuyServerPlans(chatId, srvId, lang);
      } else if (data.startsWith("buy_plan:") || data.startsWith("buy_plan_")) {
        await answerCallback(cb.id);
        const planId = data.startsWith("buy_plan:")
          ? data.slice("buy_plan:".length)
          : data.slice("buy_plan_".length);
        await handleBuyPlan(chatId, planId, lang);
      } else if (data.startsWith("buy_pay:") || data.startsWith("buy_pay_")) {
        await answerCallback(cb.id);
        const rest = data.startsWith("buy_pay:")
          ? data.slice("buy_pay:".length)
          : data.slice("buy_pay_".length);
        let planId = "";
        let accountId = "";
        if (rest.includes(":")) {
          const parts = rest.split(":");
          planId = parts[0];
          accountId = parts.slice(1).join(":");
        } else {
          const store = await readStore();
          const foundPlan = store.plans.find((p) => rest.startsWith(p.id + "_"));
          if (foundPlan) {
            planId = foundPlan.id;
            accountId = rest.slice(planId.length + 1);
          } else {
            const parts = rest.split("_");
            planId = parts.slice(0, -1).join("_");
            accountId = parts[parts.length - 1];
          }
        }
        await handleCreateDeposit(chatId, user, planId, accountId, lang);
      } else if (data.startsWith("check_ord:") || data.startsWith("check_ord_")) {
        await answerCallback(cb.id);
        const ordId = data.startsWith("check_ord:")
          ? data.slice("check_ord:".length)
          : data.slice("check_ord_".length);
        await handleCheckOrder(chatId, user, ordId, lang);
      } else if (data.startsWith("cancel_ord:") || data.startsWith("cancel_ord_")) {
        await answerCallback(cb.id);
        const ordId = data.startsWith("cancel_ord:")
          ? data.slice("cancel_ord:".length)
          : data.slice("cancel_ord_".length);
        await handleCancelOrder(chatId, user, ordId, lang);
      } else if (data.startsWith("req_rep:") || data.startsWith("req_rep_")) {
        await answerCallback(cb.id);
        const subId = data.startsWith("req_rep:")
          ? data.slice("req_rep:".length)
          : data.slice("req_rep_".length);
        await handleRequestReplacement(chatId, user, subId, lang);
      } else if (data === "cmd_plans") {
        await answerCallback(cb.id);
        await handlePlans(chatId, lang);
      } else if (data === "cmd_mykeys") {
        await answerCallback(cb.id);
        await handleMyKeys(chatId, cb.from, lang);
      } else if (data === "cmd_support") {
        await answerCallback(cb.id);
        const supportText = lang === "my"
          ? `
<b>AirVPN အကူအညီနှင့် ဝန်ဆောင်မှု</b>

Key အခက်အခဲ၊ ငွေပေးချေမှု သို့မဟုတ် အကူအညီ လိုအပ်ပါက:
• Admin Support: @dominate_x17
• Official Channel: https://t.me/airvpn_myanmar_bot
• Web Shop: ${getAppBaseUrl()}
`.trim()
          : `
<b>AirVPN Customer Support</b>

Need help with key issues or payments:
• Admin Support: @dominate_x17
• Official Channel: https://t.me/airvpn_myanmar_bot
• Web Shop: ${getAppBaseUrl()}
`.trim();

        await sendTg("sendMessage", {
          chat_id: chatId,
          text: supportText,
          parse_mode: "HTML",
          reply_markup: mainMenuKeyboard(lang),
        });
      } else {
        await answerCallback(cb.id);
      }

      return Response.json({ ok: true });
    }

    // ─── 2. Handle Text Messages & TxID Submissions ─────────────────────────
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = (msg.text || "").trim();
      const from = msg.from;

      if (from && text) {
        const user = await findOrCreateTgUser(from);
        const lang: Lang = user.language || "my";

        if (text.startsWith("/start") || text.startsWith("/lang") || text.startsWith("/language")) {
          // If no language set, or user explicitly runs /lang or /start, prompt language selection
          if (!user.language || text.startsWith("/lang")) {
            await promptLanguageSelection(chatId);
          } else {
            await handleMainMenu(chatId, user);
          }
        } else if (text.startsWith("/menu")) {
          await handleMainMenu(chatId, user);
        } else if (text.startsWith("/buy")) {
          await handleBuyServers(chatId, lang);
        } else if (text.startsWith("/plans")) {
          await handlePlans(chatId, lang);
        } else if (text.startsWith("/mykeys") || text.startsWith("/keys")) {
          await handleMyKeys(chatId, from, lang);
        } else if (text.startsWith("/help") || text.startsWith("/support")) {
          const supportText = lang === "my"
            ? `
<b>AirVPN အကူအညီနှင့် ဝန်ဆောင်မှု</b>

Key အခက်အခဲ၊ ငွေပေးချေမှု သို့မဟုတ် အကူအညီ လိုအပ်ပါက:
• Admin Support: @dominate_x17
• Web Shop: ${getAppBaseUrl()}
`.trim()
            : `
<b>AirVPN Customer Support</b>

Need help with key issues or payments:
• Admin Support: @dominate_x17
• Web Shop: ${getAppBaseUrl()}
`.trim();

          await sendTg("sendMessage", { chat_id: chatId, text: supportText, parse_mode: "HTML" });
        } else if (/^\d{5,}$/.test(text) || text.length === 5 || text.toLowerCase().includes("tx")) {
          // User sent TxID digits
          await handleTxidSubmission(chatId, user, text);
        } else {
          // Fallback to main menu
          await handleMainMenu(chatId, user);
        }
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error handling update:", err);
    return Response.json({ ok: true });
  }
}
