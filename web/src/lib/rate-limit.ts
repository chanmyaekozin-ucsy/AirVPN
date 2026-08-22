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
 * Trusted proxy configuration. Only requests that actually arrived through a
 * configured proxy may influence the client IP. Set TRUSTED_PROXIES to a
 * comma-separated list of proxy IPs/CIDRs (e.g. your Cloudflare/NGINX edge).
 * Unset = no proxy is trusted and spoofable headers are ignored entirely.
 */
function trustedProxyCidrs(): string[] {
  return (process.env.TRUSTED_PROXIES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function ipToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split("/");
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  const ipLong = ipToLong(ip);
  const rangeLong = ipToLong(range);
  if (ipLong === null || rangeLong === null || !Number.isInteger(bits)) return false;
  if (bits <= 0) return true;
  const mask = bits >= 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
}

/** True when the immediate peer (`x-forwarded-for` last hop / socket info) is a trusted proxy. */
export function requestFromTrustedProxy(req: NextRequest | Request): boolean {
  const proxies = trustedProxyCidrs();
  if (proxies.length === 0) return false;
  const forwarded = req.headers.get("x-forwarded-for");
  // The right-most entry in X-Forwarded-For is added by our own edge — the
  // only hop an attacker cannot overwrite.
  const peer = forwarded ? forwarded.split(",").map((s) => s.trim()).filter(Boolean).pop() : null;
  if (!peer) return false;
  return proxies.some((cidr) => ipInCidr(peer, cidr));
}

/**
 * Extract client IP address. Proxy headers are honored ONLY when the request
 * came through a trusted proxy; otherwise fall back to a stable key.
 */
export function getClientIp(req: NextRequest | Request): string {
  if (requestFromTrustedProxy(req)) {
    const headers = req.headers;
    const cf = headers.get("cf-connecting-ip");
    if (cf && /^[0-9a-fA-F:.]+$/.test(cf.trim())) return cf.trim();
    const fwd = headers.get("x-forwarded-for");
    if (fwd) {
      const first = fwd.split(",")[0].trim();
      if (/^[0-9a-fA-F:.]+$/.test(first)) return first;
    }
    const real = headers.get("x-real-ip");
    if (real && /^[0-9a-fA-F:.]+$/.test(real.trim())) return real.trim();
  }
  // No trusted proxy: all clients share one bucket per route rather than
  // trusting attacker-controlled headers.
  return "direct";
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

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Same-origin check for mutating requests (CSRF defense).
 * Session cookies are SameSite=Lax, which already blocks cross-site POSTs in
 * modern browsers — this adds server-side enforcement for defense in depth
 * (old browsers, Lax-bypass top-level navigations with methods, tooling).
 */
export function assertSameOrigin(req: NextRequest): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;

  // Server-to-server callers authenticate via secrets, not cookies:
  // payment webhook (HMAC), Telegram webhook (secret token).
  if (req.nextUrl.pathname.startsWith("/api/webhooks/")) return;
  if (req.nextUrl.pathname.startsWith("/api/telegram/webhook")) return;

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");

  // No Origin header: non-browser clients (curl, health checks). Require a
  // same-host Referer when present; otherwise allow (cookie alone is still
  // needed to do anything sensitive).
  if (!origin) {
    const referer = req.headers.get("referer");
    if (referer) {
      try {
        const refHost = new URL(referer).host;
        if (host && refHost !== host) {
          throw Object.assign(new Error("Cross-origin request blocked."), { status: 403 });
        }
      } catch (err) {
        if ((err as { status?: number }).status === 403) throw err;
        throw Object.assign(new Error("Malformed Referer header."), { status: 403 });
      }
    }
    return;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw Object.assign(new Error("Malformed Origin header."), { status: 403 });
  }

  if (!host || originHost !== host) {
    throw Object.assign(new Error("Cross-origin request blocked."), { status: 403 });
  }
}
