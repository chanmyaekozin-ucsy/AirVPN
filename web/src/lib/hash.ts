import { createHash } from "crypto";

export function hashPin(pin: string) {
  return createHash("sha256").update(`cgs:${pin}`).digest("hex");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

/**
 * WathanPay mini-app accessToken is a short-lived JWT (`{ sub: userId, role }`,
 * ~15min TTL) — a fresh token is issued on every mini-app open, but `sub` stays
 * constant for the same WathanPay account. We don't have WathanPay's signing
 * secret to verify it, so decode the payload only; that's fine here because
 * we're just picking a stable local user key, not making an authorization
 * decision (WathanPay itself verifies the token when we send it back as a
 * Bearer header in chargeWathanPay).
 */
export function wathanpaySubject(token: string): string {
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
        sub?: unknown;
      };
      if (typeof payload.sub === "string" && payload.sub.trim()) {
        return hashToken(payload.sub.trim());
      }
    } catch {
      // not a JWT we can read — fall through to raw-token hashing below
    }
  }
  return hashToken(token);
}
