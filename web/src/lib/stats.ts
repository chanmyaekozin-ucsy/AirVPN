import type { Order, OrderStatus, Store, Subscription } from "./types";

const REVENUE_STATUSES: OrderStatus[] = ["paid", "processing", "success"];

export function isRevenueOrder(order: Order): boolean {
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

export type PeriodMetric = {
  revenueKs: number;
  ordersCount: number;
  keysSold: number;
  avgOrderValueKs: number;
};

export type ChartPoint = {
  date: string;
  label: string;
  shortDay: string;
  revenueKs: number;
  successOrders: number;
  failedOrders: number;
  pendingOrders: number;
};

export type PaymentMethodKey = "KBZPay" | "WavePay" | "WathanPay" | "Other";

export type PaymentMethodStat = {
  method: PaymentMethodKey;
  displayName: string;
  count: number;
  revenueKs: number;
  percentage: number;
  color: string;
  badgeBg: string;
};

export type OrderOutcomeStats = {
  total: number;
  successCount: number;
  successRevenueKs: number;
  successPercentage: number;
  pendingCount: number;
  pendingPotentialKs: number;
  pendingPercentage: number;
  failedCount: number;
  failedPercentage: number;
};

export type RecentActivityItem = {
  id: string;
  orderId: string;
  customerName: string;
  contact: string;
  serverName: string;
  planTitle: string;
  dataGb: number;
  amountKs: number;
  paymentMethod: string;
  status: OrderStatus;
  createdAt: string;
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
  periods: {
    daily: PeriodMetric;
    weekly: PeriodMetric;
    monthly: PeriodMetric;
    allTime: PeriodMetric;
  };
  outcomes: OrderOutcomeStats;
  paymentMethods: PaymentMethodStat[];
  dailyTrend: ChartPoint[];
  byServer: ServerStats[];
  recentActivity: RecentActivityItem[];
};

function normalizePaymentMethod(methodName?: string | null): PaymentMethodKey {
  if (!methodName) return "Other";
  const m = methodName.toLowerCase().replace(/[\s_-]/g, "");
  if (m.includes("kbz") || m.includes("kpay")) return "KBZPay";
  if (m.includes("wave")) return "WavePay";
  if (m.includes("wathan") || m.includes("wp")) return "WathanPay";
  return "Other";
}

export function computeAdminStats(store: Store): AdminStats {
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const cutoffDaily = now - ONE_DAY_MS;
  const cutoffWeekly = now - 7 * ONE_DAY_MS;
  const cutoffMonthly = now - 30 * ONE_DAY_MS;

  // 1. Initialize Server Maps
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

  // 2. Initialize Payment Method Maps
  const pmMap = new Map<PaymentMethodKey, { count: number; revenueKs: number }>([
    ["KBZPay", { count: 0, revenueKs: 0 }],
    ["WavePay", { count: 0, revenueKs: 0 }],
    ["WathanPay", { count: 0, revenueKs: 0 }],
    ["Other", { count: 0, revenueKs: 0 }],
  ]);

  // 3. Initialize 14-Day Timeline
  const trendMap = new Map<string, ChartPoint>();
  const daysToShow = 14;
  for (let i = daysToShow - 1; i >= 0; i--) {
    const d = new Date(now - i * ONE_DAY_MS);
    const dateStr = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const shortDay = d.toLocaleDateString("en-US", { weekday: "short" });
    trendMap.set(dateStr, {
      date: dateStr,
      label,
      shortDay,
      revenueKs: 0,
      successOrders: 0,
      failedOrders: 0,
      pendingOrders: 0,
    });
  }

  // 4. Period Accumulators
  const periodData = {
    daily: { revenueKs: 0, ordersCount: 0, keysSold: 0 },
    weekly: { revenueKs: 0, ordersCount: 0, keysSold: 0 },
    monthly: { revenueKs: 0, ordersCount: 0, keysSold: 0 },
    allTime: { revenueKs: 0, ordersCount: 0, keysSold: 0 },
  };

  let totalOrdersCount = 0;
  let successCount = 0;
  let successRevenueKs = 0;
  let pendingCount = 0;
  let pendingPotentialKs = 0;
  let failedCount = 0;

  for (const order of store.orders) {
    totalOrdersCount += 1;
    const createdAtMs = Date.parse(order.createdAt) || now;
    const dateKey = new Date(createdAtMs).toISOString().slice(0, 10);
    const trendPoint = trendMap.get(dateKey);
    const row = byId.get(order.serverId);
    const pmKey = normalizePaymentMethod(order.paymentMethod);
    const isPaid = isRevenueOrder(order);

    if (order.status === "awaiting_payment") {
      pendingCount += 1;
      pendingPotentialKs += order.amountKs;
      if (row) row.ordersPending += 1;
      if (trendPoint) trendPoint.pendingOrders += 1;
    } else if (order.status === "failed" || order.status === "cancelled") {
      failedCount += 1;
      if (row) row.ordersFailed += 1;
      if (trendPoint) trendPoint.failedOrders += 1;
    }

    if (isPaid) {
      successCount += 1;
      successRevenueKs += order.amountKs;

      if (row) {
        row.revenueKs += order.amountKs;
        row.ordersPaid += 1;
      }

      // Payment method tracking
      const pm = pmMap.get(pmKey) || pmMap.get("Other")!;
      pm.count += 1;
      pm.revenueKs += order.amountKs;

      // Timeline trend
      if (trendPoint) {
        trendPoint.revenueKs += order.amountKs;
        trendPoint.successOrders += 1;
      }

      // Period stats
      periodData.allTime.revenueKs += order.amountKs;
      periodData.allTime.ordersCount += 1;

      if (createdAtMs >= cutoffMonthly) {
        periodData.monthly.revenueKs += order.amountKs;
        periodData.monthly.ordersCount += 1;
      }
      if (createdAtMs >= cutoffWeekly) {
        periodData.weekly.revenueKs += order.amountKs;
        periodData.weekly.ordersCount += 1;
      }
      if (createdAtMs >= cutoffDaily) {
        periodData.daily.revenueKs += order.amountKs;
        periodData.daily.ordersCount += 1;
      }
    }

    if (order.status === "success") {
      if (row) row.keysSold += 1;
      periodData.allTime.keysSold += 1;
      if (createdAtMs >= cutoffMonthly) periodData.monthly.keysSold += 1;
      if (createdAtMs >= cutoffWeekly) periodData.weekly.keysSold += 1;
      if (createdAtMs >= cutoffDaily) periodData.daily.keysSold += 1;
    }
  }

  // 5. Active Subscriptions
  let activeKeys = 0;
  for (const sub of store.subscriptions as Subscription[]) {
    if (sub.status !== "active") continue;
    activeKeys += 1;
    const row = byId.get(sub.serverId);
    if (row) row.activeKeys += 1;
  }

  // 6. Format Period Metrics
  const periods = {
    daily: {
      ...periodData.daily,
      avgOrderValueKs:
        periodData.daily.ordersCount > 0
          ? Math.round(periodData.daily.revenueKs / periodData.daily.ordersCount)
          : 0,
    },
    weekly: {
      ...periodData.weekly,
      avgOrderValueKs:
        periodData.weekly.ordersCount > 0
          ? Math.round(periodData.weekly.revenueKs / periodData.weekly.ordersCount)
          : 0,
    },
    monthly: {
      ...periodData.monthly,
      avgOrderValueKs:
        periodData.monthly.ordersCount > 0
          ? Math.round(periodData.monthly.revenueKs / periodData.monthly.ordersCount)
          : 0,
    },
    allTime: {
      ...periodData.allTime,
      avgOrderValueKs:
        periodData.allTime.ordersCount > 0
          ? Math.round(periodData.allTime.revenueKs / periodData.allTime.ordersCount)
          : 0,
    },
  };

  // 7. Format Payment Method Stats
  const totalPmRev = successRevenueKs || 1;
  const paymentMethods: PaymentMethodStat[] = [
    {
      method: "KBZPay",
      displayName: "KBZPay",
      count: pmMap.get("KBZPay")!.count,
      revenueKs: pmMap.get("KBZPay")!.revenueKs,
      percentage: Math.round((pmMap.get("KBZPay")!.revenueKs / totalPmRev) * 100),
      color: "#0047BA",
      badgeBg: "rgba(0, 71, 186, 0.15)",
    },
    {
      method: "WavePay",
      displayName: "WavePay",
      count: pmMap.get("WavePay")!.count,
      revenueKs: pmMap.get("WavePay")!.revenueKs,
      percentage: Math.round((pmMap.get("WavePay")!.revenueKs / totalPmRev) * 100),
      color: "#eab308",
      badgeBg: "rgba(234, 179, 8, 0.15)",
    },
    {
      method: "WathanPay",
      displayName: "WathanPay",
      count: pmMap.get("WathanPay")!.count,
      revenueKs: pmMap.get("WathanPay")!.revenueKs,
      percentage: Math.round((pmMap.get("WathanPay")!.revenueKs / totalPmRev) * 100),
      color: "#0d9488",
      badgeBg: "rgba(13, 148, 136, 0.15)",
    },
    {
      method: "Other",
      displayName: "Other / Direct",
      count: pmMap.get("Other")!.count,
      revenueKs: pmMap.get("Other")!.revenueKs,
      percentage: Math.round((pmMap.get("Other")!.revenueKs / totalPmRev) * 100),
      color: "#8b5cf6",
      badgeBg: "rgba(139, 92, 246, 0.15)",
    },
  ];

  // 8. Order Outcome Stats
  const totalOrders = totalOrdersCount || 1;
  const outcomes: OrderOutcomeStats = {
    total: totalOrdersCount,
    successCount,
    successRevenueKs,
    successPercentage: Math.round((successCount / totalOrders) * 100),
    pendingCount,
    pendingPotentialKs,
    pendingPercentage: Math.round((pendingCount / totalOrders) * 100),
    failedCount,
    failedPercentage: Math.round((failedCount / totalOrders) * 100),
  };

  // 9. Recent Activity Items (Latest 8 orders)
  const recentActivity: RecentActivityItem[] = [...store.orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8)
    .map((o) => ({
      id: o.id,
      orderId: o.id,
      customerName: o.userName || o.payeeName || "Customer",
      contact: o.userPhone || o.userEmail || o.telegramId || "—",
      serverName: o.serverName || o.serverId,
      planTitle: o.planTitle,
      dataGb: o.dataGb,
      amountKs: o.amountKs,
      paymentMethod: o.paymentMethod || "Direct",
      status: o.status,
      createdAt: o.createdAt,
    }));

  const byServer = [...byId.values()].sort(
    (a, b) => b.revenueKs - a.revenueKs || a.serverName.localeCompare(b.serverName),
  );

  return {
    revenueKs: successRevenueKs,
    keysSold: periodData.allTime.keysSold,
    activeKeys,
    activeServers: store.servers.filter((s) => s.isActive).length,
    totalServers: store.servers.length,
    pendingOrders: pendingCount,
    failedOrders: failedCount,
    users: store.users.filter((u) => u.role === "user").length,
    periods,
    outcomes,
    paymentMethods,
    dailyTrend: [...trendMap.values()],
    byServer,
    recentActivity,
  };
}
