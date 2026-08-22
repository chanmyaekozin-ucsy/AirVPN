import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { decodeJwtPayload, hashPin, hashToken, verifyPin, PIN_HASH_PREFIX } from "../src/lib/hash.ts";

test("hashPin produces salted scrypt hashes with prefix and unique salts", () => {
  const h1 = hashPin("123456");
  const h2 = hashPin("123456");
  assert.ok(h1.startsWith(PIN_HASH_PREFIX), `expected scrypt prefix, got: ${h1}`);
  assert.notEqual(h1, h2, "same PIN must produce different hashes (unique salts)");
  const parts = h1.split("$");
  assert.equal(parts.length, 4);
  const [nStr, rStr] = parts[1].split(":");
  assert.equal(Number(nStr) >= 16384, true);
  assert.equal(Number(rStr) >= 8, true);
});

test("verifyPin accepts correct PIN and rejects wrong PIN for scrypt hashes", () => {
  const stored = hashPin("987654");
  assert.equal(verifyPin("987654", stored).ok, true);
  assert.equal(verifyPin("000000", stored).ok, false);
  assert.equal(verifyPin("", stored).ok, false);
  assert.equal(verifyPin("987654", "").ok, false);
});

test("verifyPin supports legacy unsalted SHA-256 hashes and flags them for rehash", () => {
  const legacyHash = createHash("sha256").update("cgs:123456").digest("hex");
  const result = verifyPin("123456", legacyHash);
  assert.equal(result.ok, true);
  assert.equal(result.legacy, true);

  const wrong = verifyPin("111111", legacyHash);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.legacy, true);
});

test("hashPin works for long passwords (admin password support)", () => {
  const pw = "correct-horse-battery-staple-42!";
  const stored = hashPin(pw);
  assert.equal(verifyPin(pw, stored).ok, true);
  assert.equal(verifyPin(pw + "x", stored).ok, false);
});

test("hashToken creates a 24-character hexadecimal digest", () => {
  const tokenHash = hashToken("test-user-sub-id-12345");
  assert.equal(tokenHash.length, 24);
  assert.equal(typeof tokenHash, "string");
  assert.equal(tokenHash, hashToken("test-user-sub-id-12345"));
});

test("decodeJwtPayload parses valid base64url payloads", () => {
  const payload = { sub: "user_12345", name: "Ko Kyaw", role: "user" };
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mockJwt = `eyJhbGciOiJIUzI1NiJ9.${base64Payload}.signature`;

  const decoded = decodeJwtPayload(mockJwt);
  assert.deepEqual(decoded, payload);
});

test("decodeJwtPayload returns null for malformed tokens", () => {
  assert.equal(decodeJwtPayload("invalid"), null);
  assert.equal(decodeJwtPayload("invalid.not-json.sig"), null);
});
