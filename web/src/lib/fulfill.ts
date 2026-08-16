import { randomBytes } from "crypto";
import { formatKeyRemark } from "./format";
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

  const user = store.users.find((u) => u.id === order.userId);
  const userLoginMethod = order.userLoginMethod || user?.loginMethod;
  const userName = order.userName || user?.name || order.payeeName || undefined;
  const userEmail = order.userEmail || user?.email || undefined;
  const userPhone = order.userPhone || user?.phone || undefined;

  const keyRemark = formatKeyRemark(server.name, userName, order.dataGb);

  const provisioned = await provisionVless({
    server,
    userKey: order.userId,
    dataGb: order.dataGb,
    durationDays: order.durationDays,
    remark: keyRemark,
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
    userLoginMethod,
    userName,
    userEmail,
    userPhone,
    replacementCount: 0,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt(order.durationDays),
  };
  store.subscriptions.push(sub);
  order.subscriptionId = sub.id;
  order.userLoginMethod = userLoginMethod;
  order.userName = userName;
  order.userEmail = userEmail;
  order.userPhone = userPhone;
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

/**
 * Replaces / re-issues a key for a customer's active subscription.
 * Supports switching Server/Node, updating Package/Plan, and updating the 3x-ui panel.
 */
export async function replaceSubscriptionKey(
  store: Store,
  subId: string,
  options?: {
    targetServerId?: string;
    targetPlanId?: string;
    dataGb?: number;
    durationDays?: number;
    resetDuration?: boolean;
    reason?: string;
    adminNote?: string;
  },
): Promise<Subscription> {
  const sub = store.subscriptions.find((s) => s.id === subId);
  if (!sub) {
    throw Object.assign(new Error("Subscription not found."), { status: 404 });
  }

  const oldServer = store.servers.find((s) => s.id === sub.serverId);
  const targetServerId = options?.targetServerId || sub.serverId;
  const targetServer = store.servers.find((s) => s.id === targetServerId);

  if (!targetServer) {
    throw Object.assign(new PanelError("Target VPN server not found."), { status: 500 });
  }
  if (!isServerProvisionReady(targetServer)) {
    throw Object.assign(
      new PanelError(
        `Server “${targetServer.name}” panel is not configured. Configure panel settings in Admin → Servers.`,
      ),
      { status: 503 },
    );
  }

  // Handle plan update if requested
  let targetPlanTitle = sub.planTitle;
  let targetDataGb = typeof options?.dataGb === "number" && options.dataGb > 0 ? options.dataGb : sub.dataGb;
  let planDuration = sub.durationDays;

  if (options?.targetPlanId) {
    const plan = store.plans.find((p) => p.id === options.targetPlanId);
    if (plan) {
      targetPlanTitle = plan.title;
      targetDataGb = plan.dataGb;
      planDuration = plan.durationDays;
    }
  }

  // Calculate remaining days from expiresAt or reset
  let remainingDays = typeof options?.durationDays === "number" && options.durationDays > 0 ? options.durationDays : planDuration;
  if (!options?.resetDuration && sub.expiresAt) {
    const msLeft = Date.parse(sub.expiresAt) - Date.now();
    if (msLeft > 0) {
      remainingDays = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
    }
  }

  // Best-effort cleanup on old server if switching nodes or client
  if (oldServer && isServerProvisionReady(oldServer) && sub.clientUuid) {
    try {
      const { PanelClient } = await import("./panel");
      const client = new PanelClient(oldServer);
      await client.deleteClientByUuid(sub.clientUuid).catch(() => false);
    } catch {
      // Ignore cleanup error on old server
    }
  }

  // Provision new client on target server
  const keyRemark = formatKeyRemark(targetServer.name, sub.userName, targetDataGb);
  const provisioned = await provisionVless({
    server: targetServer,
    userKey: `${sub.userId}_r${(sub.replacementCount || 0) + 1}`,
    dataGb: targetDataGb,
    durationDays: remainingDays,
    remark: keyRemark,
  });

  const isServerChanged = sub.serverId !== targetServer.id;
  const isPlanChanged = sub.planTitle !== targetPlanTitle || sub.dataGb !== targetDataGb;

  // Update subscription fields
  sub.serverId = targetServer.id;
  sub.planTitle = targetPlanTitle;
  sub.dataGb = targetDataGb;
  sub.durationDays = remainingDays;
  sub.vlessKey = provisioned.vlessKey;
  sub.clientUuid = provisioned.uuid;
  sub.panelEmail = provisioned.email;
  sub.replacementCount = (sub.replacementCount || 0) + 1;
  sub.lastReplacedAt = new Date().toISOString();
  sub.expiresAt = expiresAt(remainingDays);
  sub.status = "active";
  sub.replacementRequested = false;
  sub.replacementReason = undefined;
  sub.replacementRequestedAt = undefined;

  const order = store.orders.find((o) => o.id === sub.orderId || o.subscriptionId === sub.id);
  if (order) {
    order.replacementRequested = false;
    order.replacementReason = undefined;
    order.replacementRequestedAt = undefined;
  }

  const changeNotes: string[] = [];
  if (isServerChanged) changeNotes.push(`Node changed to ${targetServer.name}`);
  if (isPlanChanged) changeNotes.push(`Plan changed to ${targetPlanTitle} (${targetDataGb} GB)`);

  const noteEntry = `[${new Date().toISOString().slice(0, 16)}] Key replaced (#${sub.replacementCount})${
    changeNotes.length ? ` [${changeNotes.join(", ")}]` : ""
  }${options?.reason ? `: ${options.reason}` : ""}${options?.adminNote ? ` (Note: ${options.adminNote})` : ""}`;
  sub.notes = sub.notes ? `${sub.notes}\n${noteEntry}` : noteEntry;

  return sub;
}

