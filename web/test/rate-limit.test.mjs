import test from "node:test";
import assert from "node:assert/strict";

const rateLimitStore = new Map();

function checkRateLimit(key, limit = 5, windowMs = 60000) {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

function getClientIp(headers) {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "127.0.0.1";
}

test("checkRateLimit allows requests up to limit and blocks subsequent requests", () => {
  const testKey = "test_ip_1";
  
  for (let i = 0; i < 5; i++) {
    const res = checkRateLimit(testKey, 5, 10000);
    assert.equal(res.ok, true, `Request ${i + 1} should be allowed`);
  }

  const blocked = checkRateLimit(testKey, 5, 10000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
});

test("getClientIp extracts IP correctly prioritizing cf-connecting-ip and x-real-ip", () => {
  const cfHeaders = new Headers({
    "cf-connecting-ip": "203.0.113.195",
    "x-real-ip": "198.51.100.1",
    "x-forwarded-for": "192.0.2.1, 10.0.0.1",
  });
  assert.equal(getClientIp(cfHeaders), "203.0.113.195");

  const realHeaders = new Headers({
    "x-real-ip": "198.51.100.1",
    "x-forwarded-for": "192.0.2.1, 10.0.0.1",
  });
  assert.equal(getClientIp(realHeaders), "198.51.100.1");

  const fwdHeaders = new Headers({
    "x-forwarded-for": "192.0.2.1, 10.0.0.1",
  });
  assert.equal(getClientIp(fwdHeaders), "192.0.2.1");

  const emptyHeaders = new Headers();
  assert.equal(getClientIp(emptyHeaders), "127.0.0.1");
});
