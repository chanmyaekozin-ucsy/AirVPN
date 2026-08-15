import { NextRequest } from "next/server";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { hashPin, wathanpaySubject } from "@/lib/hash";
import { updateStore } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { accessToken?: string };
    const token = String(body.accessToken ?? "").trim();
    if (!token) {
      return Response.json({ error: "Missing WathanPay token." }, { status: 401 });
    }
    // accessToken is a short-lived JWT reissued every mini-app open; key the
    // local account off its stable `sub` claim, not the raw token, so returning
    // buyers keep their order history instead of getting a fresh account each visit.
    const sub = `wp_${wathanpaySubject(token)}`;
    const user = await updateStore((store) => {
      let found = store.users.find((u) => u.wathanpaySub === sub || u.id === sub);
      if (!found) {
        found = {
          id: sub,
          name: "WathanPay",
          phone: "",
          email: "",
          role: "user",
          pinHash: hashPin(token.slice(-6).padStart(6, "0")),
          balanceKs: 250000,
          wathanpaySub: sub,
        };
        store.users.push(found);
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
        miniApp: true,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
