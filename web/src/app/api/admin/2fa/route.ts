import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { readStore, updateStore } from "@/lib/store";
import {
  generateQrCodeDataUrl,
  generateTotpSecret,
  getTotpUri,
  verifyTotpCode,
} from "@/lib/totp";

export async function GET() {
  try {
    const session = await requireAdmin();
    const store = await readStore();
    const adminUser = store.users.find((u) => u.id === session.sub);

    if (!adminUser) {
      return Response.json({ error: "Admin account not found." }, { status: 404 });
    }

    if (adminUser.twoFactorEnabled && adminUser.twoFactorSecret) {
      return Response.json({
        enabled: true,
        email: adminUser.email || "admin@airvpn.mm",
      });
    }

    // Generate a fresh secret for setup
    const secret = generateTotpSecret(20);
    const email = adminUser.email || "admin@airvpn.mm";
    const otpauthUri = getTotpUri(email, secret, "AirVPN Admin");
    const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUri);

    return Response.json({
      enabled: false,
      secret,
      qrCodeDataUrl,
      otpauthUri,
      email,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      action?: "enable" | "disable";
      secret?: string;
      code?: string;
    };

    const action = body.action;
    const code = String(body.code ?? "").trim();

    if (!code || code.length !== 6) {
      return Response.json({ error: "Please enter the 6-digit Google Authenticator code." }, { status: 400 });
    }

    if (action === "enable") {
      const secret = String(body.secret ?? "").trim();
      if (!secret) {
        return Response.json({ error: "Missing TOTP secret key." }, { status: 400 });
      }

      const isValid = verifyTotpCode(code, secret);
      if (!isValid) {
        return Response.json({ error: "Invalid 2FA code. Please verify the code in Google Authenticator." }, { status: 400 });
      }

      await updateStore((store) => {
        const admin = store.users.find((u) => u.id === session.sub);
        if (admin) {
          admin.twoFactorSecret = secret;
          admin.twoFactorEnabled = true;
        }
      });

      return Response.json({
        ok: true,
        message: "Google 2FA authentication successfully enabled for admin account.",
        enabled: true,
      });
    }

    if (action === "disable") {
      const store = await readStore();
      const admin = store.users.find((u) => u.id === session.sub);
      if (!admin || !admin.twoFactorSecret) {
        return Response.json({ error: "2FA is not currently enabled." }, { status: 400 });
      }

      const isValid = verifyTotpCode(code, admin.twoFactorSecret);
      if (!isValid) {
        return Response.json({ error: "Invalid 2FA code. Cannot disable 2FA without valid code." }, { status: 400 });
      }

      await updateStore((s) => {
        const user = s.users.find((u) => u.id === session.sub);
        if (user) {
          user.twoFactorSecret = undefined;
          user.twoFactorEnabled = false;
        }
      });

      return Response.json({
        ok: true,
        message: "2FA has been disabled.",
        enabled: false,
      });
    }

    return Response.json({ error: "Invalid action. Must be enable or disable." }, { status: 400 });
  } catch (err) {
    return jsonError(err);
  }
}
