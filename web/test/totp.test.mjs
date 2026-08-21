import test from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  generateTotpCode,
  generateTotpSecret,
  getTotpUri,
  verifyTotpCode,
} from "../src/lib/totp.ts";

test("Base32 encoding and decoding round-trip accurately", () => {
  const original = Buffer.from("AirVPN-Admin-Secret-Key-12345");
  const encoded = base32Encode(original);
  const decoded = base32Decode(encoded);

  assert.equal(decoded.toString(), original.toString());
});

test("generateTotpSecret generates valid Base32 string", () => {
  const secret = generateTotpSecret(20);
  assert.equal(typeof secret, "string");
  assert.ok(secret.length >= 32);
  assert.match(secret, /^[A-Z2-7]+$/);
});

test("generateTotpCode produces 6-digit string", () => {
  const secret = generateTotpSecret(20);
  const code = generateTotpCode(secret);
  assert.match(code, /^\d{6}$/);
});

test("verifyTotpCode validates exact current code and drift tolerance", () => {
  const secret = generateTotpSecret(20);
  const now = Date.now();
  const currentCode = generateTotpCode(secret, now);

  assert.equal(verifyTotpCode(currentCode, secret, { timestampMs: now }), true);

  // Past 30s window
  const prevCode = generateTotpCode(secret, now - 30000);
  assert.equal(verifyTotpCode(prevCode, secret, { timestampMs: now, windowTolerance: 1 }), true);

  // Future 30s window
  const nextCode = generateTotpCode(secret, now + 30000);
  assert.equal(verifyTotpCode(nextCode, secret, { timestampMs: now, windowTolerance: 1 }), true);

  // Expired window (beyond tolerance)
  const expiredCode = generateTotpCode(secret, now - 90000);
  assert.equal(verifyTotpCode(expiredCode, secret, { timestampMs: now, windowTolerance: 1 }), false);

  // Invalid code
  assert.equal(verifyTotpCode("000000", secret), false);
  assert.equal(verifyTotpCode("invalid", secret), false);
});

test("getTotpUri produces valid Google Authenticator otpauth URI", () => {
  const uri = getTotpUri("admin@airvpn.mm", "JBSWY3DPEHPK3PXP", "AirVPN");
  assert.ok(uri.startsWith("otpauth://totp/AirVPN%3Aadmin%40airvpn.mm?"));
  assert.ok(uri.includes("secret=JBSWY3DPEHPK3PXP"));
  assert.ok(uri.includes("issuer=AirVPN"));
});
