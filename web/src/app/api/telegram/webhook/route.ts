import { NextRequest } from "next/server";
import { createDeposit, listPaymentMethods, paidStatus, verifyDepositLast5 } from "@/lib/dominate";
import { formatDataGb, formatDuration, formatKs, formatWhen } from "@/lib/format";
import { fulfillOrder, markFulfillFailed } from "@/lib/fulfill";
import { PanelError } from "@/lib/panel";
import { loadShopEnv } from "@/lib/shop-env";
import { readStore, updateStore } from "@/lib/store";
import { notifyKeyReplacementRequest, notifyPurchaseSuccess } from "@/lib/telegram";
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

function mainMenuKeyboard() {
  const appUrl = getAppBaseUrl();
  return {
    inline_keyboard: [
      [
        { text: "Buy VPN / Plan ဝယ်ယူရန်", callback_data: "buy_servers" },
        { text: "Plans / ပလန်များ", callback_data: "cmd_plans" },
      ],
      [
        { text: "My Keys / ကီးများ", callback_data: "cmd_mykeys" },
        { text: "Support / အကူအညီ", callback_data: "cmd_support" },
      ],
      [
        { text: "Open Web Shop (WathanPay)", web_app: { url: appUrl } },
      ],
    ],
  };
}

async function handleStart(chatId: number, user: User) {
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
    reply_markup: mainMenuKeyboard(),
  });
}

/** Step 1: Choose Server Node */
async function handleBuyServers(chatId: number) {
  const store = await readStore();
  const activeServers = store.servers.filter((s) => s.isActive);

  if (activeServers.length === 0) {
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: "လက်ရှိတွင် VPN ဆာဗာများ မရှိသေးပါ။ ခေတ္တစောင့်ဆိုင်းပေးပါ။",
      parse_mode: "HTML",
    });
    return;
  }

  const buttons = activeServers.map((server) => [
    {
      text: `${server.name} (${server.region})`,
      callback_data: `buy_srv_${server.id}`,
    },
  ]);
  buttons.push([{ text: "Back to Menu", callback_data: "cmd_start" }]);

  await sendTg("sendMessage", {
    chat_id: chatId,
    text: "<b>Choose Server Location / ဆာဗာ ရွေးချယ်ပါ:</b>\n\nအသုံးပြုလိုသော ဆာဗာကို ရွေးချယ်ပါ:",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
}

/** Step 2: Choose Plan for Server */
async function handleBuyServerPlans(chatId: number, serverId: string) {
  const store = await readStore();
  const server = store.servers.find((s) => s.id === serverId);
  if (!server) {
    await handleBuyServers(chatId);
    return;
  }

  const plans = store.plans.filter((p) => p.serverId === serverId && p.isActive);
  if (plans.length === 0) {
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: `<b>${server.name}</b> အတွက် ပလန်များ မရှိသေးပါ။`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "Back to Servers", callback_data: "buy_servers" }]],
      },
    });
    return;
  }

  const buttons = plans.map((plan) => [
    {
      text: `${plan.title} (${formatDataGb(plan.dataGb)}) — ${formatKs(plan.priceKs)}`,
      callback_data: `buy_plan_${plan.id}`,
    },
  ]);
  buttons.push([{ text: "Back to Servers", callback_data: "buy_servers" }]);

  await sendTg("sendMessage", {
    chat_id: chatId,
    text: `<b>${server.name} (${server.region}) — Choose Plan:</b>\n\nဝယ်ယူလိုသော ပက်ကေ့ချ်ကို ရွေးချယ်ပါ:`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
}

/** Step 3: Choose Payment Method */
async function handleBuyPlan(chatId: number, planId: string) {
  const store = await readStore();
  const plan = store.plans.find((p) => p.id === planId);
  if (!plan) {
    await handleBuyServers(chatId);
    return;
  }
  const server = store.servers.find((s) => s.id === plan.serverId);
  const methods = await listPaymentMethods();

  const buttons: { text: string; callback_data: string }[][] = [];

  for (const m of methods) {
    buttons.push([
      {
        text: `Pay with ${m.method} (${m.accountName || ""})`,
        callback_data: `buy_pay_${plan.id}_${m.id}`,
      },
    ]);
  }

  buttons.push([
    { text: "Back to Plans", callback_data: `buy_srv_${plan.serverId}` },
  ]);

  const text = `
<b>Order Summary / အော်ဒါ အကျဉ်းချုပ်</b>

• <b>Server:</b> ${server?.name || plan.serverId}
• <b>Plan:</b> ${plan.title} (${formatDataGb(plan.dataGb)})
• <b>Duration:</b> ${formatDuration(plan.durationDays)}
• <b>Price:</b> <b>${formatKs(plan.priceKs)}</b>

ပေးချေလိုသော ငွေပေးချေနည်းလမ်းကို ရွေးချယ်ပါ:
`.trim();

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
}

/** Step 4: Create Order & Show Deposit Details */
async function handleCreateDeposit(chatId: number, user: User, planId: string, accountId: string) {
  const store = await readStore();
  const plan = store.plans.find((p) => p.id === planId);
  if (!plan) {
    await handleBuyServers(chatId);
    return;
  }
  const server = store.servers.find((s) => s.id === plan.serverId);
  const methods = await listPaymentMethods();
  const method = methods.find((m) => m.id === accountId) || methods[0];

  if (!method) {
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: "ငွေပေးချေမှု လိုင်း ခေတ္တမအားလပ်ပါ။ နောက်မှ ပြန်လည်ကြိုးစားပါ။",
      parse_mode: "HTML",
    });
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

  const text = `
<b>Order #${order.id}</b>

• <b>Server:</b> ${order.serverName}
• <b>Plan:</b> ${order.planTitle} (${formatDataGb(order.dataGb)})
• <b>Amount to Pay:</b> <b>${formatKs(order.amountKs)}</b> (ကျပ်တိတိ)

<b>Payment Method:</b> <b>${order.paymentMethod}</b>
<b>Account Name:</b> <code>${order.payeeName || method.accountName}</code>
<b>Account Number:</b> <code>${order.payeePhone || method.accountNumber}</code>

━━━━━━━━━━━━━━━━━━━━
<b>ငွေလွှဲပြီးပါက ပြုလုပ်ရန်:</b>
၁။ အထက်ပါ အကောင့်သို့ <b>${formatKs(order.amountKs)}</b> တိတိ လွှဲပေးပါ။
၂။ ငွေလွှဲပြေစာမှ <b>TxID (နောက်ဆုံး ၅ လုံး)</b> ကို ဤ Chat တွင် စာရိုက်ပို့ပေးပါ (ဥပမာ: <code>12345</code>)။
━━━━━━━━━━━━━━━━━━━━
`.trim();

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Cancel Order / ပယ်ဖျက်ရန်", callback_data: `cancel_ord_${order.id}` },
          { text: "Refresh Status / အခြေအနေစစ်", callback_data: `check_ord_${order.id}` },
        ],
      ],
    },
  });
}

/** Step 5: User sends TxID / 5 digits in chat */
async function handleTxidSubmission(chatId: number, user: User, inputTxid: string) {
  const store = await readStore();
  const digits = inputTxid.replace(/\D/g, "");
  const last5 = digits.length >= 5 ? digits.slice(-5) : "";

  if (last5.length !== 5) {
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: "ကျေးဇူးပြု၍ ငွေလွှဲပြေစာမှ <b>TxID နောက်ဆုံး ၅ လုံး</b> (ဥပမာ: <code>12345</code>) ကို ရိုက်ပို့ပေးပါ။",
      parse_mode: "HTML",
    });
    return;
  }

  // Find user's active awaiting order
  const pendingOrders = store.orders.filter(
    (o) => o.userId === user.id && o.status === "awaiting_payment",
  );

  if (pendingOrders.length === 0) {
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: `
ငွေပေးချေရန် စောင့်ဆိုင်းနေသော အော်ဒါ မတွေ့ပါ။
အသစ်ဝယ်ယူလိုပါက /start ကို နှိပ်ပါ။
`.trim(),
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }

  const order = pendingOrders[pendingOrders.length - 1];

  await sendTg("sendMessage", {
    chat_id: chatId,
    text: `TxID <code>${last5}</code> ဖြင့် ငွေလွှဲစစ်ဆေးနေပါသည်... ခေတ္တစောင့်ပေးပါ။`,
    parse_mode: "HTML",
  });

  if (order.depositId) {
    try {
      const deposit = await verifyDepositLast5(order.depositId, last5);
      const isPaid = paidStatus(deposit.status);
      const txid = String(deposit.bank_trx_id || deposit.trx_id || last5);

      if (!isPaid) {
        await sendTg("sendMessage", {
          chat_id: chatId,
          text: `
<b>ငွေလွှဲပြေစာ မတွေ့ရှိသေးပါ</b>

လွှဲငွေ <b>${formatKs(order.amountKs)}</b> နှင့် TxID <code>${last5}</code> ကို စစ်ဆေးနေဆဲဖြစ်ပါသည်။
ငွေလွှဲပြီးပါက ၁ မိနစ်ခန့်စောင့်ပြီး TxID ၅ လုံးကို ပြန်လည်ပို့ပေးပါ။
`.trim(),
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "ပြန်လည်စစ်ဆေးမည်", callback_data: `check_ord_${order.id}` }],
              [{ text: "Order ပယ်ဖျက်မည်", callback_data: `cancel_ord_${order.id}` }],
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
        await sendTg("sendMessage", {
          chat_id: chatId,
          text: "ငွေပေးချေမှု အောင်မြင်သော်လည်း VPN Key ထုတ်ပေးရာတွင် ချို့ယွင်းချက်ရှိပါသည်။ Support @dominate_x17 သို့ ဆက်သွယ်ပေးပါ။",
          parse_mode: "HTML",
        });
        return;
      }

      const sub = deliveryResult.subscription;
      const successText = `
<b>ငွေပေးချေမှု အောင်မြင်ပြီး VPN Key အဆင်သင့်ဖြစ်ပါပြီ</b>

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
v2rayNG / Hiddify / Streisand ထဲသို့ ထည့်သွင်းပြီး ချိတ်ဆက် အသုံးပြုနိုင်ပါပြီ။
`.trim();

      await sendTg("sendMessage", {
        chat_id: chatId,
        text: successText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "My Keys / ကီးများကြည့်ရန်", callback_data: "cmd_mykeys" }],
            [{ text: "Main Menu", callback_data: "cmd_start" }],
          ],
        },
      });
      return;
    } catch (err) {
      console.error("[Telegram Webhook] verifyDeposit error:", err);
      await sendTg("sendMessage", {
        chat_id: chatId,
        text: "ငွေလွှဲစစ်ဆေးရာတွင် ချို့ယွင်းချက်ဖြစ်ပေါ်ခဲ့ပါသည်။ ခေတ္တစောင့်ပြီး ပြန်လည်ပို့ပေးပါ။",
        parse_mode: "HTML",
      });
      return;
    }
  }
}

/** Check order status button */
async function handleCheckOrder(chatId: number, user: User, orderId: string) {
  const store = await readStore();
  const order = store.orders.find((o) => o.id === orderId && o.userId === user.id);
  if (!order) {
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: "အော်ဒါ မတွေ့ရှိပါ။ /start ကို နှိပ်ပါ။",
      parse_mode: "HTML",
    });
    return;
  }

  if (order.status === "success") {
    await handleMyKeys(chatId, { id: Number(user.id.replace(/\D/g, "") || "0"), username: user.telegramId });
    return;
  }

  await sendTg("sendMessage", {
    chat_id: chatId,
    text: `
Order #${order.id}
Status: <b>${order.status.toUpperCase()}</b>
ငွေလွှဲပြီးပါက TxID နောက်ဆုံး ၅ လုံးကို ဤ Chat တွင် စာရိုက်ပို့ပေးပါ။
`.trim(),
    parse_mode: "HTML",
  });
}

/** Cancel order button */
async function handleCancelOrder(chatId: number, user: User, orderId: string) {
  await updateStore((s) => {
    const order = s.orders.find((o) => o.id === orderId && o.userId === user.id);
    if (order && order.status === "awaiting_payment") {
      order.status = "cancelled";
      order.completedAt = new Date().toISOString();
    }
  });

  await sendTg("sendMessage", {
    chat_id: chatId,
    text: `Order #${orderId} ကို ပယ်ဖျက်ပြီးပါပြီ။`,
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(),
  });
}

/** View Plans */
async function handlePlans(chatId: number) {
  const store = await readStore();
  const activeServers = store.servers.filter((s) => s.isActive);

  if (activeServers.length === 0) {
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: "No VPN plans available at the moment. Please check back later.",
      parse_mode: "HTML",
    });
    return;
  }

  let text = "<b>AirVPN Plans & Pricing</b>\n\n";

  for (const server of activeServers) {
    const serverPlans = store.plans.filter((p) => p.serverId === server.id && p.isActive);
    if (serverPlans.length === 0) continue;

    text += `<b>${server.name} (${server.region})</b>\n`;
    for (const plan of serverPlans) {
      text += `• <b>${plan.title}</b> (${formatDataGb(plan.dataGb)}) — <b>${formatKs(plan.priceKs)}</b> / ${formatDuration(plan.durationDays)}\n`;
    }
    text += "\n";
  }

  text += "All plans include unblockable VLESS Reality & high-speed bandwidth.";

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Buy VPN / Plan ဝယ်ယူရန်", callback_data: "buy_servers" }],
        [{ text: "Back to Menu", callback_data: "cmd_start" }],
      ],
    },
  });
}

/** View My Keys */
async function handleMyKeys(chatId: number, from: TelegramFrom) {
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
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: `
<b>No Active VPN Keys Found</b>

@${from.username || from.id} နှင့် ချိတ်ဆက်ထားသော အသုံးပြုဆဲ VPN ကီး မရှိသေးပါ။
အောက်ပါ Menu မှ စတင်ဝယ်ယူနိုင်ပါသည်:
`.trim(),
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Buy VPN / Plan ဝယ်ယူရန်", callback_data: "buy_servers" }],
          [{ text: "Back to Menu", callback_data: "cmd_start" }],
        ],
      },
    });
    return;
  }

  let text = `<b>Your AirVPN Subscriptions (${userSubs.length})</b>\n\n`;

  const buttons: { text: string; callback_data: string }[][] = [];

  for (const sub of userSubs) {
    const server = store.servers.find((s) => s.id === sub.serverId);
    const serverName = server?.name || sub.serverId;
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
      { text: `Request Key Replacement (${serverName})`, callback_data: `req_rep_${sub.id}` },
    ]);
  }

  buttons.push([{ text: "Main Menu", callback_data: "cmd_start" }]);

  await sendTg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
}

/** Request Key Replacement from Bot */
async function handleRequestReplacement(chatId: number, user: User, subId: string) {
  const store = await readStore();
  const sub = store.subscriptions.find((s) => s.id === subId);
  if (!sub) {
    await sendTg("sendMessage", {
      chat_id: chatId,
      text: "Subscription not found.",
      parse_mode: "HTML",
    });
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

  await sendTg("sendMessage", {
    chat_id: chatId,
    text: `
<b>Key Replacement Request Sent</b>

Server: ${sub.planTitle}
Status: <b>Under Review</b>

Admin များထံသို့ အကြောင်းကြားပြီးပါပြီ။ ခေတ္တစောင့်ဆိုင်းပေးပါ၊ အမြန်ဆုံး အသစ်လဲလှယ်ပေးပါမည်။
`.trim(),
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const update = (await req.json().catch(() => ({}))) as TelegramUpdate;

    // ─── 1. Handle Inline Button Callbacks ──────────────────────────────────
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || "";
      const chatId = cb.message?.chat.id || cb.from.id;
      const user = await findOrCreateTgUser(cb.from);

      if (data === "cmd_start" || data === "main_menu") {
        await answerCallback(cb.id);
        await handleStart(chatId, user);
      } else if (data === "buy_servers") {
        await answerCallback(cb.id);
        await handleBuyServers(chatId);
      } else if (data.startsWith("buy_srv_")) {
        await answerCallback(cb.id);
        const srvId = data.replace("buy_srv_", "");
        await handleBuyServerPlans(chatId, srvId);
      } else if (data.startsWith("buy_plan_")) {
        await answerCallback(cb.id);
        const planId = data.replace("buy_plan_", "");
        await handleBuyPlan(chatId, planId);
      } else if (data.startsWith("buy_pay_")) {
        await answerCallback(cb.id);
        const parts = data.replace("buy_pay_", "").split("_");
        const planId = parts[0];
        const accountId = parts.slice(1).join("_");
        await handleCreateDeposit(chatId, user, planId, accountId);
      } else if (data.startsWith("check_ord_")) {
        await answerCallback(cb.id);
        const ordId = data.replace("check_ord_", "");
        await handleCheckOrder(chatId, user, ordId);
      } else if (data.startsWith("cancel_ord_")) {
        await answerCallback(cb.id);
        const ordId = data.replace("cancel_ord_", "");
        await handleCancelOrder(chatId, user, ordId);
      } else if (data.startsWith("req_rep_")) {
        await answerCallback(cb.id);
        const subId = data.replace("req_rep_", "");
        await handleRequestReplacement(chatId, user, subId);
      } else if (data === "cmd_plans") {
        await answerCallback(cb.id);
        await handlePlans(chatId);
      } else if (data === "cmd_mykeys") {
        await answerCallback(cb.id);
        await handleMyKeys(chatId, cb.from);
      } else if (data === "cmd_support") {
        await answerCallback(cb.id);
        await sendTg("sendMessage", {
          chat_id: chatId,
          text: `
<b>AirVPN Customer Support</b>

Key အခက်အခဲ၊ ငွေပေးချေမှု သို့မဟုတ် အကူအညီ လိုအပ်ပါက:
• Admin Support: @dominate_x17
• Official Channel: https://t.me/airvpn_myanmar_bot
• Web Shop: ${getAppBaseUrl()}
`.trim(),
          parse_mode: "HTML",
          reply_markup: mainMenuKeyboard(),
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

        if (text.startsWith("/start") || text.startsWith("/menu")) {
          await handleStart(chatId, user);
        } else if (text.startsWith("/buy")) {
          await handleBuyServers(chatId);
        } else if (text.startsWith("/plans")) {
          await handlePlans(chatId);
        } else if (text.startsWith("/mykeys") || text.startsWith("/keys")) {
          await handleMyKeys(chatId, from);
        } else if (text.startsWith("/help") || text.startsWith("/support")) {
          await sendTg("sendMessage", {
            chat_id: chatId,
            text: `
<b>AirVPN Customer Support</b>

Key အခက်အခဲ၊ ငွေပေးချေမှု သို့မဟုတ် အကူအညီ လိုအပ်ပါက:
• Admin Support: @dominate_x17
• Web Shop: ${getAppBaseUrl()}
`.trim(),
            parse_mode: "HTML",
          });
        } else if (/^\d{5,}$/.test(text) || text.length === 5 || text.toLowerCase().includes("tx")) {
          // User sent TxID digits
          await handleTxidSubmission(chatId, user, text);
        } else {
          // Fallback to start menu
          await handleStart(chatId, user);
        }
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error handling update:", err);
    return Response.json({ ok: true });
  }
}
