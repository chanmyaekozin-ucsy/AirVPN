import test from "node:test";
import assert from "node:assert/strict";

function formatPurchaseNotification(order, subscription, user) {
  const method = order.userLoginMethod || user?.loginMethod || "Email";
  const customerName = order.userName || user?.name || order.payeeName || "Customer";
  const contact = [order.userEmail || user?.email, order.userPhone || user?.phone].filter(Boolean).join(" · ");
  const txLine = order.txid ? `\n<b>TxID:</b> <code>${order.txid}</code>` : "";

  return `
<b>AirVPN Web — Purchase Successful</b>

<b>Order:</b> <code>#${order.id}</code>
<b>Server:</b> ${order.serverName}
<b>Plan:</b> ${order.planTitle}
<b>Amount:</b> <b>${order.amountKs.toLocaleString()} Ks</b>
<b>Payment:</b> ${order.paymentMethod || "Direct"}${txLine}

<b>Customer:</b> ${customerName}
<b>Login Method:</b> ${method.toUpperCase()}
<b>Contact:</b> ${contact || "—"}
`.trim();
}

test("formatPurchaseNotification includes order ID, amount, and contact information", () => {
  const text = formatPurchaseNotification(
    {
      id: "ord_12345",
      serverName: "Singapore 1",
      planTitle: "100 GB · 30 Days",
      amountKs: 3000,
      paymentMethod: "WathanPay",
      txid: "wp_tx_9988",
      userName: "Ko Kyaw",
      userLoginMethod: "wathanpay",
      userEmail: "kokyaw@gmail.com",
    },
    null,
    null
  );

  assert.ok(text.includes("#ord_12345"));
  assert.ok(text.includes("Singapore 1"));
  assert.ok(text.includes("3,000 Ks"));
  assert.ok(text.includes("WathanPay"));
  assert.ok(text.includes("wp_tx_9988"));
  assert.ok(text.includes("Ko Kyaw"));
  assert.ok(text.includes("WATHANPAY"));
  assert.ok(text.includes("kokyaw@gmail.com"));
});

test("Telegram callback data parser properly handles server and plan delimiters", () => {
  const parseCallbackData = (data) => {
    if (data.startsWith("plan_")) {
      const parts = data.split("_");
      return { action: "plan", serverId: parts[1], planId: data };
    }
    if (data.startsWith("lang_")) {
      return { action: "lang", code: data.replace("lang_", "") };
    }
    return { action: data };
  };

  assert.deepEqual(parseCallbackData("plan_sg1_1"), {
    action: "plan",
    serverId: "sg1",
    planId: "plan_sg1_1",
  });
  assert.deepEqual(parseCallbackData("lang_my"), {
    action: "lang",
    code: "my",
  });
  assert.deepEqual(parseCallbackData("lang_en"), {
    action: "lang",
    code: "en",
  });
});
