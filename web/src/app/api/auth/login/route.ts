import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { hashPin, verifyPin } from "@/lib/hash";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { updateStore } from "@/lib/store";
import { verifyTotpCode } from "@/lib/totp";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`login:${ip}`, 5, 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.resetAt);

    const body = (await req.json()) as {
      identifier?: string;
      password?: string;
      totpCode?: string;
    };
    const identifier = String(body.identifier ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const totpCode = String(body.totpCode ?? "").trim();

    if (!identifier || !password) {
      return Response.json(
        { error: "Email/phone and password are required." },
        { status: 400 },
      );
    }

    const method = identifier.includes("@") ? "email" : "phone";

    let require2fa = false;
    let twoFactorSecret: string | undefined;

    const user = await updateStore((store) => {
      const found = store.users.find(
        (u) =>
          (u.phone && u.phone.replace(/\s/g, "") === identifier.replace(/\s/g, "")) ||
          (u.email && u.email.toLowerCase() === identifier),
      );
      if (!found) return null;

      const { ok, legacy } = verifyPin(password, found.passwordHash);
      if (!ok) return null;

      // Transparently upgrade legacy unsalted hashes to scrypt
      if (legacy && found.passwordHash) {
        found.passwordHash = hashPin(password);
      }

      if (found.twoFactorEnabled && found.twoFactorSecret) {
        require2fa = true;
        twoFactorSecret = found.twoFactorSecret;
      }

      if (found.role !== "admin" && !found.loginMethod) {
        found.loginMethod = method;
      }
      return found;
    });

    if (!user) {
      // Generic message — do not reveal whether the account exists.
      return Response.json({ error: "Invalid credentials." }, { status: 401 });
    }

    // Handle 2FA verification step for accounts with 2FA enabled
    if (require2fa && twoFactorSecret) {
      if (!totpCode) {
        return Response.json({
          require2fa: true,
          message: "Please enter your 6-digit Google Authenticator code.",
        });
      }

      const isValidTotp = verifyTotpCode(totpCode, twoFactorSecret);
      if (!isValidTotp) {
        return Response.json({ error: "Invalid 6-digit 2FA code." }, { status: 401 });
      }
    }

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
        twoFactorEnabled: user.twoFactorEnabled,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
