import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { updateStore } from "@/lib/store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as {
      notes?: string;
      userName?: string;
      userPhone?: string;
      userEmail?: string;
      telegramId?: string;
    };

    const sub = await updateStore((store) => {
      const found = store.subscriptions.find((s) => s.id === id);
      if (!found) throw Object.assign(new Error("Subscription not found."), { status: 404 });

      if (typeof body.notes === "string") {
        found.notes = body.notes;
      }
      if (typeof body.userName === "string" && body.userName.trim()) {
        found.userName = body.userName.trim();
      }
      if (typeof body.userPhone === "string") {
        found.userPhone = body.userPhone.trim();
      }
      if (typeof body.userEmail === "string") {
        found.userEmail = body.userEmail.trim();
      }

      // Also update user record if present
      const user = store.users.find((u) => u.id === found.userId);
      if (user) {
        if (body.userName?.trim()) user.name = body.userName.trim();
        if (body.userPhone?.trim()) user.phone = body.userPhone.trim();
        if (body.userEmail?.trim()) user.email = body.userEmail.trim();
        if (typeof body.telegramId === "string") user.telegramId = body.telegramId.trim();
      }

      return found;
    });

    return Response.json({ ok: true, subscription: sub });
  } catch (err) {
    return jsonError(err);
  }
}
