import { NextRequest } from "next/server";
import { applyProvisionedServer } from "@/lib/apply-server";
import { requireAdmin } from "@/lib/auth";
import { isServerProvisionReady } from "@/lib/server-config";
import { updateStore } from "@/lib/store";
import { provisionVps, type ProvisionMode } from "@/lib/vps-provision";

export const runtime = "nodejs";
export const maxDuration = 600;

function autoServerId(region: string, ip: string) {
  const regionLc = region.trim().toLowerCase() || "us";
  const digits = ip.replace(/\D/g, "").slice(-2) || "01";
  return `${regionLc}${digits}`;
}

type StreamEvent =
  | { type: "log"; line: string }
  | { type: "status"; phase: string }
  | { type: "done"; server: unknown; meta: unknown }
  | { type: "error"; message: string };

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    const status =
      typeof err === "object" && err && "status" in err
        ? Number((err as { status: number }).status)
        : 401;
    return Response.json({ error: message }, { status });
  }

  const body = (await req.json()) as {
    ip?: string;
    password?: string;
    mode?: string;
    serverId?: string;
    name?: string;
    nameMy?: string;
    region?: string;
    panelUser?: string;
    panelPass?: string;
    panelUrl?: string;
    reuseInboundId?: string;
    vlessPort?: string;
    panelPort?: string;
    sni?: string;
  };

  const ip = String(body.ip ?? "").trim();
  const password = String(body.password ?? "");
  const region = String(body.region ?? "US").trim().toUpperCase() || "US";
  const modeRaw = String(body.mode ?? "fresh").toLowerCase();
  const mode: ProvisionMode =
    modeRaw === "reuse" ? "reuse" : modeRaw === "auto" ? "auto" : "fresh";

  if (!ip || !password) {
    return Response.json({ error: "IP and password are required." }, { status: 400 });
  }

  const serverId = String(body.serverId ?? "").trim() || autoServerId(region, ip);
  const name =
    String(body.name ?? "").trim() ||
    (region === "SG" ? `Singapore - ${serverId}` : `United States - ${serverId}`);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({ type: "status", phase: "connecting" });
        send({ type: "log", line: `Deploy ${serverId} → ${ip} (${mode})` });

        const result = await provisionVps({
          ip,
          password,
          mode,
          serverId,
          name,
          nameMy: String(body.nameMy ?? "").trim() || name,
          region,
          panelUser: String(body.panelUser ?? "dominate").trim() || "dominate",
          panelPass: String(body.panelPass ?? ""),
          panelUrl: String(body.panelUrl ?? "").trim(),
          reuseInboundId: String(body.reuseInboundId ?? "").trim(),
          vlessPort: String(body.vlessPort ?? "").trim(),
          panelPort: String(body.panelPort ?? "").trim(),
          sni: String(body.sni ?? "").trim(),
          onLog: (line) => {
            const cleaned = line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
            if (cleaned) send({ type: "log", line: cleaned });
          },
        });

        send({ type: "status", phase: "registering" });
        send({ type: "log", line: "Registering server in shop store…" });
        const server = await updateStore((store) => applyProvisionedServer(store, result));
        send({
          type: "done",
          server: {
            ...server,
            panelPassword: server.panelPassword ? "__SET__" : "",
            panelSecret: server.panelSecret ? "__SET__" : "",
            configured: isServerProvisionReady(server),
          },
          meta: result.meta ?? null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Provisioning failed";
        send({ type: "error", message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
