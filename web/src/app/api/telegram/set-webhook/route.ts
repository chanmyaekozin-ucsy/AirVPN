import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { loadShopEnv } from "@/lib/shop-env";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    loadShopEnv();
    const token = process.env.BOT_TOKEN;
    if (!token) {
      return Response.json({ error: "BOT_TOKEN not configured in .env" }, { status: 400 });
    }

    const host = req.headers.get("host") || "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const defaultUrl = `${proto}://${host}/api/telegram/webhook`;
    const targetUrl = req.nextUrl.searchParams.get("url") || defaultUrl;

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(targetUrl)}`);
    const data = await res.json().catch(() => ({}));

    return Response.json({ ok: true, webhookUrl: targetUrl, telegramResponse: data });
  } catch (err) {
    return jsonError(err);
  }
}
