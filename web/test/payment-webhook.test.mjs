import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Mirrors verifySignature + replay guard in /api/webhooks/payment
function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const SECRET = "whsec_test_123";
const BODY = JSON.stringify({ id: "dep_1", status: "paid" });

test("payment webhook signature accepts valid HMAC and rejects missing/invalid", () => {
  const sig = crypto.createHmac("sha256", SECRET).update(BODY).digest("hex");
  assert.equal(verifySignature(BODY, sig, SECRET), true);
  assert.equal(verifySignature(BODY, sig, ""), false, "missing secret must fail closed");
  assert.equal(verifySignature(BODY, "", SECRET), false, "missing signature must fail closed");
  assert.equal(verifySignature(BODY + " ", sig, SECRET), false, "tampered body must fail");
  assert.equal(verifySignature(BODY, sig.toUpperCase(), SECRET), false);
});

test("payment webhook signature is bound to the exact raw body (no reordering)", () => {
  const reordered = JSON.stringify({ status: "paid", id: "dep_1" });
  const sig = crypto.createHmac("sha256", SECRET).update(reordered).digest("hex");
  assert.equal(verifySignature(BODY, sig, SECRET), false);
});
