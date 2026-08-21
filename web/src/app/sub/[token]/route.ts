import { readStore } from "@/lib/store";
import { formatKeyRemark } from "@/lib/format";
import { buildVlessUrl } from "@/lib/panel";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import type { Server } from "@/lib/types";

interface PanelStatsCache {
  timestamp: number;
  stats: { email: string; up: number; down: number }[];
}

const statsCache = new Map<string, PanelStatsCache>();

async function getCachedPanelStats(server: Server) {
  const now = Date.now();
  const cached = statsCache.get(server.id);
  if (cached && now - cached.timestamp < 60_000) {
    return cached.stats;
  }
  const { PanelClient } = await import("@/lib/panel");
  const client = new PanelClient(server);
  await client.login();
  const stats = await client.getClientStats();
  statsCache.set(server.id, { timestamp: now, stats });
  return stats;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`sub_token:${ip}`, 60, 60 * 1000);
  if (!rl.ok) return rateLimitResponse(rl.resetAt);

  const { token } = await params;
  const store = await readStore();
  const sub = store.subscriptions.find(
    (s) => s.subToken === token && s.status === "active",
  );
  if (!sub?.vlessKey) {
    return new Response("Not found", { status: 404 });
  }
  if (sub.expiresAt && Date.parse(sub.expiresAt) < Date.now()) {
    return new Response("Expired", { status: 410 });
  }

  // Dynamically rebuild the VLESS URL from the CURRENT server config
  // so port/SNI/key changes auto-propagate to all subscription users.
  const server = store.servers.find((s) => s.id === sub.serverId);
  let vlessKey = sub.vlessKey;
  if (server && sub.clientUuid && server.host) {
    const remark = formatKeyRemark(server.name, sub.userName, sub.dataGb);
    vlessKey = buildVlessUrl({
      uuid: sub.clientUuid,
      host: server.host,
      port: server.port,
      remark,
      server,
    });
  }

  // Build subscription-userinfo header for v2ray apps
  // Format: upload=<bytes>; download=<bytes>; total=<bytes>; expire=<unix>
  // This tells the app the quota limit and expiry so it can display them.
  const totalBytes = sub.dataGb > 0 ? Math.round(sub.dataGb * 1024 ** 3) : 0;
  const expireUnix = sub.expiresAt ? Math.round(Date.parse(sub.expiresAt) / 1000) : 0;

  // Try to get live usage from panel with 60s cache (best-effort, don't block)
  let uploadBytes = 0;
  let downloadBytes = 0;
  if (server) {
    try {
      const stats = await getCachedPanelStats(server);
      const match = stats.find((s) => s.email === sub.panelEmail);
      if (match) {
        uploadBytes = match.up;
        downloadBytes = match.down;
      }
    } catch {
      // Panel offline — just show 0 usage, still show quota + expiry
    }
  }

  const userInfo = [
    `upload=${uploadBytes}`,
    `download=${downloadBytes}`,
    totalBytes > 0 ? `total=${totalBytes}` : null,
    expireUnix > 0 ? `expire=${expireUnix}` : null,
  ]
    .filter(Boolean)
    .join("; ");

  const body = Buffer.from(`${vlessKey}\n`, "utf8").toString("base64");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "profile-title": "AirVPN",
      "subscription-userinfo": userInfo,
    },
  });
}
