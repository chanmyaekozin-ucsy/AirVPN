import type { Plan, Server, Store } from "./types";
import { normalizeServer } from "./server-config";

const UNLIMITED = 36500;

export function defaultPlansForServer(serverId: string): Plan[] {
  const rows: Array<[string, number, number, number, boolean, number]> = [
    ["50 GB · 30 Days", 50, 2000, 30, false, 1],
    ["100 GB · 30 Days", 100, 3000, 30, false, 2],
    ["100 GB · Unlimited Date", 100, 4000, UNLIMITED, true, 3],
    ["300 GB · Unlimited Date", 300, 6000, UNLIMITED, true, 4],
    ["1 TB · Unlimited Date", 1024, 8000, UNLIMITED, true, 5],
  ];
  return rows.map(([title, dataGb, priceKs, durationDays, unlimitedDate, sortOrder]) => ({
    id: `plan_${serverId}_${sortOrder}`,
    serverId,
    title,
    dataGb,
    priceKs,
    compareAtKs: 0,
    durationDays,
    unlimitedDate,
    isActive: true,
    sortOrder,
  }));
}

/** Merge a provisioned server JSON into the shop store (keeps plans). */
export function applyProvisionedServer(store: Store, raw: Record<string, unknown>): Server {
  if (!store.settings) store.settings = { subPublicBaseUrl: "", deletedPlanIds: [] };
  if (!Array.isArray(store.settings.deletedPlanIds)) store.settings.deletedPlanIds = [];

  const { meta: _meta, ...rest } = raw;
  const server = normalizeServer(rest as Partial<Server> & Pick<Server, "id" | "slug" | "name">);

  const existingIdx = store.servers.findIndex((s) => s.id === server.id);
  if (existingIdx >= 0) {
    store.servers[existingIdx] = {
      ...store.servers[existingIdx],
      ...server,
      sortOrder: store.servers[existingIdx].sortOrder || store.servers.length,
    };
  } else {
    server.sortOrder = store.servers.length + 1;
    store.servers.push(server);
  }

  store.settings.deletedPlanIds = store.settings.deletedPlanIds.filter(
    (id) => !String(id).startsWith(`plan_${server.id}_`),
  );
  for (const plan of defaultPlansForServer(server.id)) {
    if (!store.plans.find((p) => p.id === plan.id)) store.plans.push(plan);
  }

  return store.servers.find((s) => s.id === server.id)!;
}
