import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { decodeGoogleToken, hashPin } from "@/lib/hash";
import { updateStore } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      credential?: string;
      email?: string;
      name?: string;
      sub?: string;
    };

    let email = "";
    let name = "";
    let sub = "";

    if (body.credential) {
      const decoded = decodeGoogleToken(body.credential);
      if (!decoded || !decoded.email) {
        return Response.json({ error: "Invalid Google token." }, { status: 400 });
      }
      email = decoded.email.toLowerCase().trim();
      name = decoded.name || decoded.given_name || "Google User";
      sub = decoded.sub;
    } else if (body.email && body.sub) {
      email = String(body.email).toLowerCase().trim();
      name = String(body.name || "Google User").trim();
      sub = String(body.sub).trim();
    } else {
      return Response.json({ error: "Missing Google credentials." }, { status: 400 });
    }

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
          pinHash: hashPin(`goog_${sub.slice(-6)}`),
          balanceKs: 250000,
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
