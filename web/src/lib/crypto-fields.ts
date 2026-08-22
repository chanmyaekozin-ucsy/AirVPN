import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const SALT = "airvpn-store-field-v1";

/**
 * Field-level encryption for sensitive values persisted in store.json
 * (panel passwords, panel secrets). Key is derived from STORE_SECRET env.
 */
function storeKey(): Buffer | null {
  const secret = process.env.STORE_SECRET?.trim();
  if (!secret) return null;
  return scryptSync(secret, SALT, 32);
}

export function isEncrypted(value: string | undefined | null): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}

/** Encrypt a plaintext field. Returns input unchanged when STORE_SECRET unset. */
export function encryptField(plain: string): string {
  const key = storeKey();
  if (!key || !plain) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${iv.toString("base64")}:${enc.toString("base64")}:${cipher.getAuthTag().toString("base64")}`;
}

/** Decrypt a field produced by encryptField. Returns input unchanged otherwise. */
export function decryptField(value: string | undefined | null): string {
  if (!isEncrypted(value)) return value ?? "";
  try {
    const [, ivB64, dataB64, tagB64] = (value as string).split(":");
    const key = storeKey();
    if (!key) return "";
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return "";
  }
}

/** Short fingerprint of a secret for safe display in UIs (e.g. "ab12…ef34"). */
export function secretFingerprint(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}
