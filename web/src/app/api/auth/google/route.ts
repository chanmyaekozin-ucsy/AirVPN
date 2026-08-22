import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { verifyGoogleIdToken } from "@/lib/google-auth";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { updateStore } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`auth_google:${ip}`, 10, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const body = (await req.json().catch(() => ({}))) as {
      credential?: string;
    };

    const credential = String(body.credential ?? "").trim();
    if (!credential) {
      return Response.json({ error: "Missing Google ID token credential." }, { status: 400 });
    }

    const verified = await verifyGoogleIdToken(credential);
    if (!verified || !verified.email) {
      return Response.json({ error: "Google token verification failed." }, { status: 401 });
    }

    const { email, name, sub } = verified;

    const user = await updateStore((store) => {
      let found = store.users.find(
        (u) =>
          (sub && u.googleSub === sub) ||
          (email && u.email?.toLowerCase() === email),
      );

      if (!found) {
        const userId = `goog_${sub || Date.now().toString(36)}`;
        found = {
          id: userId,
          name: name || "Google User",
          phone: "",
          email,
          role: "user",
          loginMethod: "google",
          googleSub: sub,
          // No password credential — Google users sign in via Google only.
          balanceKs: 0,
          createdAt: new Date().toISOString(),
        };
        store.users.push(found);
      } else {
        found.loginMethod = "google";
        if (sub && !found.googleSub) found.googleSub = sub;
        if (name && (!found.name || found.name === "Google User")) found.name = name;
        if (email && !found.email) found.email = email;
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
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}

