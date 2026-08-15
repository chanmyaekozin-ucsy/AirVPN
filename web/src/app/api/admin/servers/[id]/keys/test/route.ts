import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { jsonError, requireAdmin } from "@/lib/auth";
import { PanelClient, PanelError } from "@/lib/panel";
import { readStore, updateStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * POST /api/admin/servers/[id]/keys/test
 * Body: { dataGb?: number, expiryHours?: number }
 *
 * Creates a short-lived test client on the panel and returns the VLESS link.
 * Stored as a subscription with planTitle "Test key" so it shows in the Keys tab.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      dataGb?: number;
      expiryHours?: number;
    };
    const dataGb = Math.max(0.1, Number(body.dataGb) || 1);
    const expiryHours = Math.max(1, Number(body.expiryHours) || 24);
    const expiryDays = Math.max(1, Math.ceil(expiryHours / 24));

    const store = await readStore();
    const server = store.servers.find((s) => s.id === id);
    if (!server) return Response.json({ error: "Server not found." }, { status: 404 });

    const client = new PanelClient(server);
    await client.login();

    const provisioned = await client.addClient({
      emailPrefix: "test_admin",
      dataLimitGb: dataGb,
      expiryDays,
      remark: `AirVPN-test-${id}`,
    });

    // Store as a subscription so it appears in the Keys tab
    const token = randomBytes(16).toString("hex");
    const base = (store.settings?.subPublicBaseUrl || "").replace(/\/$/, "");
    const subUrl = base ? `${base}/sub/${token}` : `/sub/${token}`;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    await updateStore((s) => {
      s.subscriptions.push({
        id: `sub_test_${Date.now().toString(36)}${randomBytes(2).toString("hex")}`,
        orderId: "test",
        userId: "admin",
        serverId: id,
        planTitle: `Test key (${dataGb} GB · ${expiryHours}h)`,
        dataGb,
        durationDays: expiryDays,
        subToken: token,
        subUrl,
        vlessKey: provisioned.vlessKey,
        panelEmail: provisioned.email,
        clientUuid: provisioned.uuid,
        status: "active",
        createdAt: new Date().toISOString(),
        expiresAt,
      });
    });

    return Response.json({
      ok: true,
      vlessKey: provisioned.vlessKey,
      subUrl,
      panelEmail: provisioned.email,
      expiresAt,
    });
  } catch (err) {
    if (err instanceof PanelError)
      return Response.json({ ok: false, error: err.message }, { status: 502 });
    return jsonError(err);
  }
}
