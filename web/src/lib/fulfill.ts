import { randomBytes } from "crypto";
import { PanelError, provisionVless } from "./panel";
import { isServerProvisionReady } from "./server-config";
import type { Order, Store, Subscription } from "./types";

function expiresAt(durationDays: number) {
  if (durationDays >= 36500) return null;
  const d = new Date();
  d.setDate(d.getDate() + durationDays);
  return d.toISOString();
}

function subBaseUrl(store: Store) {
  const fromSettings = (store.settings?.subPublicBaseUrl || "").replace(/\/$/, "");
  if (fromSettings) return fromSettings;
  return "";
}

/**
 * Provision a real 3x-ui client using the server's admin-configured panel settings.
 * Call outside of long store locks when possible; safe to await inside updateStore.
 */
export async function fulfillOrder(store: Store, order: Order): Promise<Subscription> {
  const server = store.servers.find((s) => s.id === order.serverId);
  if (!server) {
    throw Object.assign(new PanelError("VPN server not found."), { status: 500 });
  }
  if (!isServerProvisionReady(server)) {
    throw Object.assign(
      new PanelError(
        `Server “${server.name}” panel is not configured. Open Admin → Servers and fill panel URL, host, and credentials.`,
      ),
      { status: 503 },
    );
  }

  const provisioned = await provisionVless({
    server,
    userKey: order.userId,
    dataGb: order.dataGb,
    durationDays: order.durationDays,
    remark: `AirVPN-${order.serverId}-${order.id.slice(-6)}`,
  });

  const token = randomBytes(16).toString("hex");
  const base = subBaseUrl(store);
  const subUrl = base ? `${base}/sub/${token}` : `/sub/${token}`;

  const sub: Subscription = {
    id: `sub_${Date.now().toString(36)}${randomBytes(2).toString("hex")}`,
    orderId: order.id,
    userId: order.userId,
    serverId: order.serverId,
    planTitle: order.planTitle,
    dataGb: order.dataGb,
    durationDays: order.durationDays,
    subToken: token,
    subUrl,
    vlessKey: provisioned.vlessKey,
    panelEmail: provisioned.email,
    clientUuid: provisioned.uuid,
    status: "active",
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt(order.durationDays),
  };
  store.subscriptions.push(sub);
  order.subscriptionId = sub.id;
  order.status = "success";
  order.completedAt = new Date().toISOString();
  order.failReason = null;
  return sub;
}

export function markFulfillFailed(order: Order, message: string) {
  order.status = "failed";
  order.failReason = message;
  order.completedAt = new Date().toISOString();
}
