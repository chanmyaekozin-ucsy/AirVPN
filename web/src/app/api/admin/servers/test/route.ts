import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { PanelError, testPanelConnection } from "@/lib/panel";
import { normalizeServer } from "@/lib/server-config";
import { readStore } from "@/lib/store";
import type { Server } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as Partial<Server> & { id?: string };
    const store = await readStore();
    const id = String(body.id ?? "").trim();
    const saved = store.servers.find((s) => s.id === id);
    if (!saved && !body.panelUrl) {
      throw Object.assign(new Error("Server not found."), { status: 404 });
    }

    const server = normalizeServer({
      ...(saved || {
        id: id || "draft",
        slug: id || "draft",
        name: "Draft",
        nameMy: "Draft",
        region: "US",
        isActive: true,
        sortOrder: 0,
      }),
      ...body,
      id: saved?.id || id || "draft",
      slug: saved?.slug || id || "draft",
      name: body.name || saved?.name || "Draft",
    });

    const started = Date.now();
    const result = await testPanelConnection(server);
    return Response.json({
      ...result,
      serverId: server.id,
      ms: Date.now() - started,
    });
  } catch (err) {
    if (err instanceof PanelError) {
      return Response.json(
        { ok: false, error: err.message },
        { status: 502 },
      );
    }
    return jsonError(err);
  }
}
