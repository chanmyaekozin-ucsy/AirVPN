import { createHash } from "crypto";

export function hashPin(pin: string) {
  return createHash("sha256").update(`cgs:${pin}`).digest("hex");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

/**
 * Decodes the JSON payload from a JWT without signature verification.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  const parts = token.split(".");
  if (parts.length >= 2) {
    try {
      const json = Buffer.from(parts[1], "base64url").toString("utf8");
      return JSON.parse(json) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export type WathanPayPayload = {
  sub?: string;
  id?: string;
  name?: string;
  username?: string;
  phone?: string;
  email?: string;
  role?: string;
};

export function decodeWathanpayToken(token: string): {
  subKey: string;
  name: string;
  phone: string;
  email: string;
} {
  const payload = decodeJwtPayload<WathanPayPayload>(token);
  const rawSub = String(payload?.sub || payload?.id || "").trim();
  const subKey = rawSub ? hashToken(rawSub) : hashToken(token);
  const name = String(payload?.name || payload?.username || "").trim();
  const phone = String(payload?.phone || "").trim();
  const email = String(payload?.email || "").trim();
  return { subKey, name, phone, email };
}

/**
 * WathanPay mini-app accessToken is a short-lived JWT (`{ sub: userId, role }`,
 * ~15min TTL) — a fresh token is issued on every mini-app open, but `sub` stays
 * constant for the same WathanPay account.
 */
export function wathanpaySubject(token: string): string {
  return decodeWathanpayToken(token).subKey;
}

export type GooglePayload = {
  sub: string;
  email: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email_verified?: boolean;
};

export function decodeGoogleToken(idToken: string): GooglePayload | null {
  return decodeJwtPayload<GooglePayload>(idToken);
}

