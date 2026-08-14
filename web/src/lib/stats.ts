import type { Order, OrderStatus, Store, Subscription } from "./types";

const REVENUE_STATUSES: OrderStatus[] = ["paid", "processing", "success"];

export function isRevenueOrder(order: Order) {
  return REVENUE_STATUSES.includes(order.status);
}

export type ServerStats = {
  serverId: string;
  serverName: string;
  region: string;
  isActive: boolean;
  keysSold: number;
  activeKeys: number;
  revenueKs: number;
  ordersPaid: number;
  ordersPending: number;
  ordersFailed: number;
};

export type AdminStats = {
  revenueKs: number;
  keysSold: number;
  activeKeys: number;
  activeServers: number;
  totalServers: number;
  pendingOrders: number;
  failedOrders: number;
  users: number;
  byServer: ServerStats[];
};

export function computeAdminStats(store: Store): AdminStats {
  const byId = new Map<string, ServerStats>();

  for (const server of store.servers) {
    byId.set(server.id, {
      serverId: server.id,
      serverName: server.name,
      region: server.region,
      isActive: server.isActive,
      keysSold: 0,
      activeKeys: 0,
      revenueKs: 0,
      ordersPaid: 0,
      ordersPending: 0,
      ordersFailed: 0,
    });
  }

  let revenueKs = 0;
  let keysSold = 0;
  let pendingOrders = 0;
  let failedOrders = 0;

  for (const order of store.orders) {
    const row = byId.get(order.serverId);
    if (order.status === "awaiting_payment") {
      pendingOrders += 1;
      if (row) row.ordersPending += 1;
      continue;
    }
    if (order.status === "failed" || order.status === "cancelled") {
      failedOrders += 1;
      if (row) row.ordersFailed += 1;
      continue;
    }
    if (isRevenueOrder(order)) {
      revenueKs += order.amountKs;
      if (row) {
        row.revenueKs += order.amountKs;
        row.ordersPaid += 1;
      }
    }
    if (order.status === "success") {
      keysSold += 1;
      if (row) row.keysSold += 1;
    }
  }

  let activeKeys = 0;
  for (const sub of store.subscriptions as Subscription[]) {
    if (sub.status !== "active") continue;
    activeKeys += 1;
    const row = byId.get(sub.serverId);
    if (row) row.activeKeys += 1;
  }

  const byServer = [...byId.values()].sort((a, b) => b.revenueKs - a.revenueKs || a.serverName.localeCompare(b.serverName));

  return {
    revenueKs,
    keysSold,
    activeKeys,
    activeServers: store.servers.filter((s) => s.isActive).length,
    totalServers: store.servers.length,
    pendingOrders,
    failedOrders,
    users: store.users.filter((u) => u.role === "user").length,
    byServer,
  };
}
