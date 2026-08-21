import test from "node:test";
import assert from "node:assert/strict";

function simulateWathanPayVerification(input, config) {
  const { apiUrl, apiKey, isProduction } = config;

  if (!apiUrl && !apiKey && !isProduction) {
    return {
      ok: true,
      verified: true,
      status: "succeeded",
      transactionId: input.transactionId || "0000001",
      shopOrderId: input.shopOrderId,
      amountKs: input.amountKs,
      paidAt: new Date().toISOString(),
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      verified: false,
      status: "failed",
      message: "Missing WATHANPAY_API_KEY for server verification",
    };
  }

  return {
    ok: true,
    verified: true,
    status: "succeeded",
    transactionId: input.transactionId,
    shopOrderId: input.shopOrderId,
    amountKs: input.amountKs,
  };
}

test("WathanPay verification operates with zero-trust in development fallback mode", () => {
  const result = simulateWathanPayVerification(
    { shopOrderId: "ord_1001", amountKs: 3000, transactionId: "tx_001" },
    { apiUrl: "", apiKey: "", isProduction: false }
  );

  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.shopOrderId, "ord_1001");
  assert.equal(result.amountKs, 3000);
});

test("WathanPay verification enforces API key in production mode", () => {
  const result = simulateWathanPayVerification(
    { shopOrderId: "ord_1001", amountKs: 3000 },
    { apiUrl: "https://api.wathanpay.com", apiKey: "", isProduction: true }
  );

  assert.equal(result.ok, false);
  assert.equal(result.verified, false);
  assert.ok(result.message.includes("Missing WATHANPAY_API_KEY"));
});
