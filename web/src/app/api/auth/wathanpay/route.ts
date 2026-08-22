import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { decodeWathanpayToken, hashPin } from "@/lib/hash";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { updateStore } from "@/lib/store";
import { verifyWathanPayAuth } from "@/lib/wathanpay";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`auth_wathanpay:${ip}`, 15, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const body = (await req.json()) as {
      authData?: string;
      accessToken?: string;
      name?: string;
      phone?: string;
      email?: string;
      avatarUrl?: string;
    };

    const authData = String(body.authData ?? "").trim();
    const token = String(body.accessToken ?? "").trim();

    if (!authData && !token) {
      return Response.json(
        { error: "Missing WathanPay authData or accessToken." },
        { status: 401 },
      );
    }

    let sub = "";
    let displayName = "WathanPay User";
    let phone: string | undefined = undefined;
    let email: string | undefined = undefined;
    let avatarUrl: string | null = null;
    let pinSeed = "";

    if (authData) {
      // 🛡️ Cryptographic Zero-Trust verification against Merchant Secret Key
      const verified = verifyWathanPayAuth(authData);
      if (!verified.ok) {
        return Response.json(
          { error: verified.error || "Invalid cryptographic signature." },
          { status: 401 },
        );
      }

      const authUser = verified.user;
      const rawId = String(authUser?.id ?? "").trim();
      sub = rawId ? (rawId.startsWith("wp_") ? rawId : `wp_${rawId}`) : `wp_${Date.now().toString(36)}`;
      displayName = authUser?.name || String(body.name ?? "").trim() || "WathanPay User";
      phone = authUser?.phone || authUser?.maskedPhone || String(body.phone ?? "").trim() || undefined;
      email = String(body.email ?? "").trim() || undefined;
      avatarUrl = authUser?.avatarUrl || String(body.avatarUrl ?? "").trim() || null;
      pinSeed = rawId || authData.slice(-6);
    } else {
      // Legacy JWT fallback
      const decoded = decodeWathanpayToken(token);
      sub = `wp_${decoded.subKey}`;
      displayName = String(body.name ?? "").trim() || decoded.name || "WathanPay User";
      phone = String(body.phone ?? "").trim() || decoded.phone || undefined;
      email = String(body.email ?? "").trim() || decoded.email || undefined;
      avatarUrl = String(body.avatarUrl ?? "").trim() || null;
      pinSeed = token.slice(-6);
    }

    const user = await updateStore((store) => {
      let found = store.users.find((u) => u.wathanpaySub === sub || u.id === sub);
      if (!found) {
        found = {
          id: sub,
          name: displayName,
          phone,
          email,
          avatarUrl,
          role: "user",
          loginMethod: "wathanpay",
          pinHash: hashPin(pinSeed.padStart(6, "0")),
          balanceKs: 0,
          wathanpaySub: sub,
          createdAt: new Date().toISOString(),
        };
        store.users.push(found);
      } else {
        found.loginMethod = "wathanpay";
        if (displayName && displayName !== "WathanPay User" && (!found.name || found.name === "WathanPay")) {
          found.name = displayName;
        }
        if (phone && !found.phone) found.phone = phone;
        if (email && !found.email) found.email = email;
        if (avatarUrl && !found.avatarUrl) found.avatarUrl = avatarUrl;
      }
      return found;
    });

    await setSessionCookie({ sub: user.id, role: user.role, name: user.name });
    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        balanceKs: user.balanceKs,
        loginMethod: user.loginMethod,
        phone: user.phone,
        email: user.email,
        avatarUrl: user.avatarUrl,
        miniApp: true,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
