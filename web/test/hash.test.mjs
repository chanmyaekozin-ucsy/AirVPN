import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

function hashPin(pin) {
  return createHash("sha256").update(`cgs:${pin}`).digest("hex");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length >= 2) {
    try {
      const json = Buffer.from(parts[1], "base64url").toString("utf8");
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  return null;
}

test("hashPin generates consistent SHA-256 with cgs: prefix", () => {
  const hash1 = hashPin("123456");
  const hash2 = hashPin("123456");
  assert.equal(hash1, hash2);
  assert.equal(typeof hash1, "string");
  assert.equal(hash1.length, 64);
  assert.notEqual(hashPin("123456"), hashPin("654321"));
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
