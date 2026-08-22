import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

function normalizePaymentMethod(methodOrProvider) {
  const val = String(methodOrProvider || "").toLowerCase().replace(/[\s\-_]/g, "");
  if (val.includes("kbz") || val.includes("kpay")) return "KBZPay";
  if (val.includes("wave")) return "WavePay";
  return null;
}

function normalizeUrl(rawUrl) {
  const base = (rawUrl || "https://pgw.flash-myanmar.com").replace(/\/$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function paidStatus(status) {
  if (!status) return false;
  return ["paid", "succeeded", "success", "completed"].includes(status.toLowerCase());
}

function failedStatus(status) {
  if (!status) return false;
  return ["failed", "expired", "cancelled", "canceled", "rejected"].includes(status.toLowerCase());
}

function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return true;
  try {
    const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(hmac, "utf8"), Buffer.from(signature, "utf8"));
  } catch {
    return false;
  }
}

test("normalizePaymentMethod accurately normalizes KBZPay and WavePay variants", () => {
  assert.equal(normalizePaymentMethod("kbzpay"), "KBZPay");
  assert.equal(normalizePaymentMethod("KBZPay"), "KBZPay");
  assert.equal(normalizePaymentMethod("kbz"), "KBZPay");
  assert.equal(normalizePaymentMethod("kpay"), "KBZPay");
  assert.equal(normalizePaymentMethod("wavepay"), "WavePay");
  assert.equal(normalizePaymentMethod("WavePay"), "WavePay");
  assert.equal(normalizePaymentMethod("wave"), "WavePay");
  assert.equal(normalizePaymentMethod("wave_money"), "WavePay");
  assert.equal(normalizePaymentMethod("unknown_bank"), null);
});

test("normalizeUrl ensures clean /v1 endpoint prefix", () => {
  assert.equal(normalizeUrl("https://pgw.flash-myanmar.com"), "https://pgw.flash-myanmar.com/v1");
  assert.equal(normalizeUrl("https://pgw.flash-myanmar.com/"), "https://pgw.flash-myanmar.com/v1");
  assert.equal(normalizeUrl("https://pgw.flash-myanmar.com/v1"), "https://pgw.flash-myanmar.com/v1");
  assert.equal(normalizeUrl("https://pgw.flash-myanmar.com/v1/"), "https://pgw.flash-myanmar.com/v1");
});

test("paidStatus and failedStatus correctly classify PGW deposit states", () => {
  assert.equal(paidStatus("paid"), true);
  assert.equal(paidStatus("PAID"), true);
  assert.equal(paidStatus("succeeded"), true);
  assert.equal(paidStatus("pending"), false);
  assert.equal(paidStatus("expired"), false);

  assert.equal(failedStatus("expired"), true);
  assert.equal(failedStatus("failed"), true);
  assert.equal(failedStatus("cancelled"), true);
  assert.equal(failedStatus("paid"), false);
});

test("verifySignature verifies authentic HMAC-SHA256 PGW webhook signatures", () => {
  const secret = "test_webhook_secret_key_123";
  const body = JSON.stringify({
    id: "dep_12345",
    status: "paid",
    amount_ks: 5000,
    matched_order_id: "202608170045678",
  });
  const validSignature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const invalidSignature = "deadbeef12345678";

  assert.equal(verifySignature(body, validSignature, secret), true);
  assert.equal(verifySignature(body, invalidSignature, secret), false);
});
