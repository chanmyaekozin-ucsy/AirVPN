import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

function getTelegramWebhookSecret(botToken, authSecret) {
  if (!botToken) return "";
  return createHash("sha256").update(`tg_webhook:${botToken}:${authSecret || "airvpn-secret"}`).digest("hex").slice(0, 32);
}

function verifyWebhookRequest(secretHeader, expectedSecret) {
  if (!expectedSecret) return true;
  return secretHeader === expectedSecret;
}

test("getTelegramWebhookSecret produces deterministic 32-char token", () => {
  const secret1 = getTelegramWebhookSecret("123456:ABC-DEF", "my-auth-secret");
  const secret2 = getTelegramWebhookSecret("123456:ABC-DEF", "my-auth-secret");
  assert.equal(secret1, secret2);
  assert.equal(secret1.length, 32);
});

test("verifyWebhookRequest verifies correct header and rejects spoofed headers", () => {
  const secret = getTelegramWebhookSecret("123456:ABC-DEF", "my-auth-secret");

  assert.equal(verifyWebhookRequest(secret, secret), true);
  assert.equal(verifyWebhookRequest("fake-secret-token", secret), false);
  assert.equal(verifyWebhookRequest(undefined, secret), false);
});
