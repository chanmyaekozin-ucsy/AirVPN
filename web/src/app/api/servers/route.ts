import { jsonError } from "@/lib/auth";
import { toPublicServer } from "@/lib/server-config";
import { readStore } from "@/lib/store";

export async function GET() {
  try {
    const store = await readStore();
    const servers = store.servers
      .filter((s) => s.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((server) => ({
        ...toPublicServer(server),
        plans: store.plans
          .filter((p) => p.serverId === server.id && p.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }));
    return Response.json({ servers });
  } catch (err) {
    return jsonError(err);
  }
}
