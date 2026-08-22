import test from "node:test";
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";

// Mirrors the constant-time comparison used by /api/telegram/webhook
function verifyWebhookRequest(secretHeader, expectedSecret) {
  if (!expectedSecret) return false;
  const incoming = secretHeader || "";
  if (incoming.length !== expectedSecret.length) return false;
  return timingSafeEqual(Buffer.from(incoming), Buffer.from(expectedSecret));
}

test("verifyWebhookRequest accepts the exact secret and rejects wrong/missing values", () => {
  const secret = "a".repeat(32);
  assert.equal(verifyWebhookRequest(secret, secret), true);
  assert.equal(verifyWebhookRequest("b".repeat(32), secret), false);
  assert.equal(verifyWebhookRequest(undefined, secret), false);
  assert.equal(verifyWebhookRequest("", secret), false);
});

test("verifyWebhookRequest fails closed when no secret configured", () => {
  assert.equal(verifyWebhookRequest("anything", ""), false);
});
