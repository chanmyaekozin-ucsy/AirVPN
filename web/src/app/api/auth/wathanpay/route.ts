import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { decodeWathanpayToken, hashPin } from "@/lib/hash";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { updateStore } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`auth_wathanpay:${ip}`, 15, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const body = (await req.json()) as {
      accessToken?: string;
      name?: string;
      phone?: string;
      email?: string;
      avatarUrl?: string;
    };
    const token = String(body.accessToken ?? "").trim();
    if (!token) {
      return Response.json({ error: "Missing WathanPay token." }, { status: 401 });
    }

    const decoded = decodeWathanpayToken(token);
    const sub = `wp_${decoded.subKey}`;
    const displayName =
      String(body.name ?? "").trim() ||
      decoded.name ||
      "WathanPay User";
    const phone = String(body.phone ?? "").trim() || decoded.phone;
    const email = String(body.email ?? "").trim() || decoded.email;
    const avatarUrl = String(body.avatarUrl ?? "").trim() || null;

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
          pinHash: hashPin(token.slice(-6).padStart(6, "0")),
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
