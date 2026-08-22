import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
/** Prefix marking hashes produced by hashPin() (scrypt, salted). */
export const PIN_HASH_PREFIX = "scrypt$";

/**
 * Hash a PIN/password with scrypt + per-value random salt.
 * Format: scrypt$<N>:<r>:<p>$<saltHex>$<hashHex>
 */
export function hashPin(secret: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(secret.normalize("NFKC"), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return (
    `${PIN_HASH_PREFIX}${SCRYPT_PARAMS.N}:${SCRYPT_PARAMS.r}:${SCRYPT_PARAMS.p}$` +
    `${salt.toString("hex")}$${derived.toString("hex")}`
  );
}

/**
 * Verify a PIN/password against a stored hash.
 * Supports legacy unsalted `sha256("cgs:"+pin)` hashes for migration:
 * returns { ok, legacy } so callers can transparently upgrade the stored hash.
 */
export function verifyPin(
  input: string,
  stored: string | undefined | null,
): { ok: boolean; legacy: boolean } {
  if (!input || !stored) return { ok: false, legacy: false };

  if (stored.startsWith(PIN_HASH_PREFIX)) {
    try {
      const [, params, saltHex, hashHex] = stored.split("$");
      const [nStr, rStr, pStr] = params.split(":");
      const derived = scryptSync(input.normalize("NFKC"), Buffer.from(saltHex, "hex"), Buffer.from(hashHex, "hex").length, {
        N: Number(nStr),
        r: Number(rStr),
        p: Number(pStr),
      });
      const expected = Buffer.from(hashHex, "hex");
      return {
        ok: derived.length === expected.length && timingSafeEqual(derived, expected),
        legacy: false,
      };
    } catch {
      return { ok: false, legacy: false };
    }
  }

  // Legacy unsalted SHA-256 ("cgs:<pin>") — constant-time compare, flag for rehash
  const legacy = createHash("sha256").update(`cgs:${input}`).digest("hex");
  const a = Buffer.from(legacy);
  const b = Buffer.from(stored);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return { ok, legacy: true };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

/**
 * Decodes a JWT payload WITHOUT signature verification.
 * Never use for authentication decisions — kept only for non-security
 * purposes (e.g. reading claims for logging).
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
