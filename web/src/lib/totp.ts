import { createHmac, randomBytes } from "crypto";
import QRCode from "qrcode";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encodes a buffer into RFC 4648 Base32 string (without padding).
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a Buffer.
 */
export function base32Decode(input: string): Buffer {
  const cleanInput = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleanInput.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleanInput[i]);
    if (idx === -1) continue; // skip invalid characters

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a random Base32 secret for Google Authenticator (default 20 bytes = 160 bits).
 */
export function generateTotpSecret(numBytes = 20): string {
  const buf = randomBytes(numBytes);
  return base32Encode(buf);
}

/**
 * Generates a 6-digit TOTP code for a given secret and unix timestamp (ms).
 */
export function generateTotpCode(secret: string, timestampMs = Date.now(), stepSeconds = 30): string {
  const key = base32Decode(secret);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);

  const counterBuf = Buffer.alloc(8);
  // Write counter as 64-bit big-endian integer
  counterBuf.writeUInt32BE(0, 0);
  counterBuf.writeUInt32BE(counter, 4);

  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;

  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, "0");
}

/**
 * Verifies a 6-digit Google Authenticator TOTP code with time drift window tolerance.
 */
export function verifyTotpCode(
  inputCode: string,
  secret: string,
  options: { windowTolerance?: number; timestampMs?: number } = {},
): boolean {
  if (!inputCode || !secret) return false;
  const cleanCode = inputCode.trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleanCode)) return false;

  const windowTolerance = options.windowTolerance ?? 1; // check -1, 0, +1 windows (90s window)
  const baseTime = options.timestampMs ?? Date.now();

  for (let w = -windowTolerance; w <= windowTolerance; w++) {
    const testTime = baseTime + w * 30 * 1000;
    const expected = generateTotpCode(secret, testTime);
    if (cleanCode === expected) {
      return true;
    }
  }

  return false;
}

/**
 * Generates the standard otpauth:// URL for Google Authenticator.
 */
export function getTotpUri(label: string, secret: string, issuer = "AirVPN"): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedLabel = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Generates a QR Code Data URL (PNG) from an otpauth URI for display in UI.
 */
export async function generateQrCodeDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 260,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
}
