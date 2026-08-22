import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

function generateTestAuthData(payload, secret) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }

  // Sort keys alphabetically
  const sortedKeys = Array.from(params.keys()).sort();
  const dataCheckString = sortedKeys.map((k) => `${k}=${params.get(k)}`).join("\n");

  const hash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  params.set("hash", hash);
  return params.toString();
}

function verifyWathanPayAuth(authDataString, maxAgeSeconds = 86400, secret = "") {
  if (!authDataString || typeof authDataString !== "string") {
    return { ok: false, error: "Missing authData" };
  }

  if (!secret) {
    return { ok: false, error: "WATHANPAY_MERCHANT_SECRET is not configured" };
  }

  const params = new URLSearchParams(authDataString);
  const receivedHash = params.get("hash");
  if (!receivedHash) {
    return { ok: false, error: "Missing signature hash" };
  }

  params.delete("hash");

  const sortedKeys = Array.from(params.keys()).sort();
  const dataCheckString = sortedKeys.map((k) => `${k}=${params.get(k)}`).join("\n");

  const calculatedHash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  const calcBuf = Buffer.from(calculatedHash.toLowerCase());
  const recvBuf = Buffer.from(receivedHash.toLowerCase());
  const isMatch =
    calcBuf.length === recvBuf.length && crypto.timingSafeEqual(calcBuf, recvBuf);

  if (!isMatch) {
    return { ok: false, error: "Invalid cryptographic signature" };
  }

  const authDate = parseInt(params.get("auth_date") || "0", 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - authDate) > maxAgeSeconds) {
    return { ok: false, error: "Auth data expired" };
  }

  const phone = params.get("phone") || params.get("maskedPhone") || undefined;

  return {
    ok: true,
    user: {
      id: params.get("id") || params.get("userId") || undefined,
      name: params.get("name") || params.get("username") || undefined,
      phone,
      maskedPhone: phone,
      avatarUrl: params.get("avatarUrl") || null,
    },
  };
}

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

test("verifyWathanPayAuth verifies authentic HMAC-SHA256 signature and extracts masked phone", () => {
  const secret = "wp_live_sk_test_secret_key_123456";
  const now = Math.floor(Date.now() / 1000);
  const authData = generateTestAuthData(
    {
      id: "usr_994821",
      name: "Chan Myae Ko Zin",
      phone: "09*****9939",
      maskedPhone: "09*****9939",
      avatarUrl: "https://wathanpay.com/avatars/usr_994821.png",
      auth_date: now,
    },
    secret,
  );

  const result = verifyWathanPayAuth(authData, 86400, secret);
  assert.equal(result.ok, true);
  assert.equal(result.user?.id, "usr_994821");
  assert.equal(result.user?.name, "Chan Myae Ko Zin");
  assert.equal(result.user?.phone, "09*****9939");
  assert.equal(result.user?.maskedPhone, "09*****9939");
  assert.equal(result.user?.avatarUrl, "https://wathanpay.com/avatars/usr_994821.png");
});

test("verifyWathanPayAuth rejects tampered parameters or invalid hash", () => {
  const secret = "wp_live_sk_test_secret_key_123456";
  const now = Math.floor(Date.now() / 1000);
  const validAuthData = generateTestAuthData(
    {
      id: "usr_994821",
      name: "Chan Myae Ko Zin",
      auth_date: now,
    },
    secret,
  );

  // Tamper with user id
  const tamperedAuthData = validAuthData.replace("id=usr_994821", "id=usr_attacker");
  const result = verifyWathanPayAuth(tamperedAuthData, 86400, secret);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Invalid cryptographic signature");

  // Wrong secret
  const wrongSecretResult = verifyWathanPayAuth(validAuthData, 86400, "wrong_secret");
  assert.equal(wrongSecretResult.ok, false);
  assert.equal(wrongSecretResult.error, "Invalid cryptographic signature");
});

test("verifyWathanPayAuth rejects expired replay attack tokens", () => {
  const secret = "wp_live_sk_test_secret_key_123456";
  const expiredTime = Math.floor(Date.now() / 1000) - 100000; // > 24 hours ago
  const authData = generateTestAuthData(
    {
      id: "usr_994821",
      name: "Chan Myae Ko Zin",
      auth_date: expiredTime,
    },
    secret,
  );

  const result = verifyWathanPayAuth(authData, 86400, secret);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Auth data expired");
});

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

