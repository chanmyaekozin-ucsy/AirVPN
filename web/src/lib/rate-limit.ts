import { NextRequest } from "next/server";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Cleanup expired entries every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

if (typeof cleanupTimer === "object" && typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

/**
 * Extract client IP address safely from standard proxy headers.
 */
export function getClientIp(req: NextRequest | Request): string {
  const headers = req.headers;
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "127.0.0.1";
}

/**
 * In-memory sliding window rate limiter.
 */
export function checkRateLimit(
  key: string,
  limit: number = 10,
  windowMs: number = 60 * 1000,
): { ok: boolean; remaining: number; resetAt: number } {
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

/**
 * Standard 429 HTTP Response with Retry-After headers.
 */
export function rateLimitResponse(resetAt: number) {
  const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return Response.json(
    { error: "Too many requests. Please slow down and try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Reset": String(resetAt),
      },
    },
  );
}
