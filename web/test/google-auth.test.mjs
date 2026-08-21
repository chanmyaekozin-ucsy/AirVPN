import test from "node:test";
import assert from "node:assert/strict";

function simulateGoogleTokenVerification(idToken, mockGoogleResponse, configuredClientId) {
  if (!idToken || typeof idToken !== "string") return null;

  const data = mockGoogleResponse;
  if (!data || !data.sub || !data.email) return null;

  if (configuredClientId && data.aud && data.aud !== configuredClientId) {
    return null;
  }

  if (data.exp && Number(data.exp) * 1000 < Date.now()) {
    return null;
  }

  return {
    sub: String(data.sub).trim(),
    email: String(data.email).trim().toLowerCase(),
    name: String(data.name || "Google User").trim(),
    emailVerified: data.email_verified === true || data.email_verified === "true",
  };
}

test("simulateGoogleTokenVerification accepts valid Google tokens", () => {
  const futureExp = Math.floor((Date.now() + 3600000) / 1000);
  const res = simulateGoogleTokenVerification("valid_jwt", {
    sub: "goog_123456",
    email: "user@example.com",
    name: "Aung Aung",
    email_verified: "true",
    aud: "my-client-id.apps.googleusercontent.com",
    exp: futureExp,
  }, "my-client-id.apps.googleusercontent.com");

  assert.notEqual(res, null);
  assert.equal(res.email, "user@example.com");
  assert.equal(res.sub, "goog_123456");
  assert.equal(res.name, "Aung Aung");
  assert.equal(res.emailVerified, true);
});

test("simulateGoogleTokenVerification rejects audience mismatch", () => {
  const futureExp = Math.floor((Date.now() + 3600000) / 1000);
  const res = simulateGoogleTokenVerification("valid_jwt", {
    sub: "goog_123456",
    email: "user@example.com",
    aud: "attacker-client-id.apps.googleusercontent.com",
    exp: futureExp,
  }, "expected-client-id.apps.googleusercontent.com");

  assert.equal(res, null);
});

test("simulateGoogleTokenVerification rejects expired tokens", () => {
  const pastExp = Math.floor((Date.now() - 3600000) / 1000);
  const res = simulateGoogleTokenVerification("expired_jwt", {
    sub: "goog_123456",
    email: "user@example.com",
    exp: pastExp,
  }, null);

  assert.equal(res, null);
});
