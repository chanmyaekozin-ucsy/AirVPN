#!/usr/bin/env node
/**
 * Diagnose WathanPay authData signature failures.
 *
 * Usage: node scripts/diagnose-wathanpay-auth.mjs "<paste full authData string>"
 *
 * Tries every plausible secret (from env files + CLI) and signing variants,
 * then reports exactly which combination reproduces the received `hash`.
 * Secrets are never printed — only masked fingerprints.
 */
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const authData = process.argv[2];
if (!authData || !authData.includes("hash=")) {
  console.error('Usage: node scripts/diagnose-wathanpay-auth.mjs "<authData string>"');
  process.exit(1);
}

// Collect candidate secrets from every env file that could be loaded.
const candidates = new Map();
const envFiles = [
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), ".env.local"),
  path.join(process.cwd(), "..", ".env"),
];
for (const file of envFiles) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let [, k, v] = m;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (/WATHANPAY|SECRET|API_KEY/.test(k) && v && !candidates.has(v)) {
      candidates.set(v, `${path.relative(process.cwd(), file)}:${k}`);
    }
  }
}
for (const k of ["WATHANPAY_MERCHANT_SECRET", "WATHANPAY_API_KEY"]) {
  const v = process.env[k];
  if (v && !candidates.has(v)) candidates.set(v, `process-env:${k}`);
}

const fp = (s) =>
  s.length <= 12 ? `"${s}"` : `${s.slice(0, 10)}…${s.slice(-4)} (${s.length} chars)`;

// Parse received authData.
const params = new URLSearchParams(authData);
const receivedHash = (params.get("hash") || "").toLowerCase();
params.delete("hash");

console.log("── Received ─────────────────────────────────────────");
console.log("Params:", Array.from(params.keys()).join(", "));
console.log("Received hash:", fp(receivedHash));
console.log("Candidate secrets:", candidates.size);
console.log("");

let anyMatch = false;

/** Build dataCheckString under different conventions and test each secret. */
function tryVariant(label, dataCheckString) {
  for (const [secret, source] of candidates) {
    const computed = crypto
      .createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex")
      .toLowerCase();
    const match = computed === receivedHash;
    if (match) anyMatch = true;
    console.log(
      `${match ? "✅ MATCH   " : "✗ no match "} ${label} | secret=${fp(secret)} (${source})`,
    );
  }
}

// Variant A: decoded values via URLSearchParams (official spec)
const decodedKeys = Array.from(params.keys()).sort();
tryVariant(
  "A: decoded k=v, \\n-joined",
  decodedKeys.map((k) => `${k}=${params.get(k)}`).join("\n"),
);

// Variant B: raw (still-encoded) pairs, original order preserved
tryVariant(
  "B: raw string minus &hash=…",
  authData.replace(/&?hash=[^&]*&?/, "&").replace(/^&|&$/g, ""),
);

// Variant C: decoded values joined by newline but unsorted (original order)
const origOrder = Array.from(params.keys());
tryVariant(
  "C: decoded k=v, original order",
  origOrder.map((k) => `${k}=${params.get(k)}`).join("\n"),
);

// Variant D: ampersand-joined instead of newline
tryVariant(
  "D: decoded k=v, &-joined",
  decodedKeys.map((k) => `${k}=${params.get(k)}`).join("&"),
);

// Variant E: signed including the hash param itself (unlikely, but cheap to test)
tryVariant(
  "E: all params incl. hash",
  [...decodedKeys, "hash"]
    .sort()
    .map((k) => `${k}=${k === "hash" ? receivedHash : params.get(k)}`)
    .join("\n"),
);

console.log("");
console.log(
  anyMatch
    ? "✅ Found the working combination — see ✅ line above."
    : "❌ No combination matched.\n" +
        "   → The signing secret differs from every key found in your env files.\n" +
        "     Ask WathanPay support to confirm EXACTLY which key they sign\n" +
        "     authData with (it must equal wp_live_sk_… in your Merchant Dashboard).\n" +
        "   → If they give you a new key: put it in WATHANPAY_MERCHANT_SECRET, restart, retry.",
);
