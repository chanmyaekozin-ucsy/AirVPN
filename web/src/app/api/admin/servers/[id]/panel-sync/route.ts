import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { PanelClient, PanelError } from "@/lib/panel";
import { normalizeServer } from "@/lib/server-config";
import { readStore, updateStore } from "@/lib/store";

export const runtime = "nodejs";

/** GET — read live inbound from panel and return parsed fields */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const store = await readStore();
    const server = store.servers.find((s) => s.id === id);
    if (!server) return Response.json({ error: "Server not found." }, { status: 404 });

    const client = new PanelClient(server);
    await client.login();
    const fields = await client.syncInboundFields();
    return Response.json({ ok: true, fields });
  } catch (err) {
    if (err instanceof PanelError)
      return Response.json({ ok: false, error: err.message }, { status: 502 });
    return jsonError(err);
  }
}

/** POST — push port + SNI changes to the panel inbound, then update store */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as { port?: number; sni?: string };
    const newPort = Number(body.port ?? 0);
    const newSni = String(body.sni ?? "").trim();
    if (!newPort || !newSni) {
      return Response.json({ error: "port and sni are required." }, { status: 400 });
    }

    const store = await readStore();
    const server = store.servers.find((s) => s.id === id);
    if (!server) return Response.json({ error: "Server not found." }, { status: 404 });

    const client = new PanelClient(server);
    await client.login();
    await client.updateInboundPortAndSni(newPort, newSni);

    // Persist new port + SNI into store
    await updateStore((s) => {
      const srv = s.servers.find((x) => x.id === id);
      if (srv) {
        const updated = normalizeServer({ ...srv, port: newPort, vlessSni: newSni });
        Object.assign(srv, updated);
      }
    });

    return Response.json({ ok: true, port: newPort, sni: newSni });
  } catch (err) {
    if (err instanceof PanelError)
      return Response.json({ ok: false, error: err.message }, { status: 502 });
    return jsonError(err);
  }
}
