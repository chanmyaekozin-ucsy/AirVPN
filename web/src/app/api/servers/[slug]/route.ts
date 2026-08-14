import { jsonError } from "@/lib/auth";
import { toPublicServer } from "@/lib/server-config";
import { readStore } from "@/lib/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const store = await readStore();
    const server = store.servers.find((s) => s.slug === slug && s.isActive);
    if (!server) return Response.json({ error: "Server not found." }, { status: 404 });
    const plans = store.plans
      .filter((p) => p.serverId === server.id && p.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return Response.json({ server: toPublicServer(server), plans });
  } catch (err) {
    return jsonError(err);
  }
}
