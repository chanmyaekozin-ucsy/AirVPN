#!/usr/bin/env node
/**
 * Merge a one-click VPS result JSON into web/data/store.json
 * Usage: node scripts/apply-vps-result.mjs /path/to/result.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const storePath = join(root, "data", "store.json");
const resultPath = process.argv[2];

if (!resultPath) {
  console.error("Usage: node scripts/apply-vps-result.mjs <result.json>");
  process.exit(1);
}

const result = JSON.parse(readFileSync(resultPath, "utf8"));
const UNLIMITED = 36500;

function defaultPlans(serverId) {
  const rows = [
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
    durationDays,
    unlimitedDate,
    isActive: true,
    sortOrder,
  }));
}

function emptyStore() {
  const pinHash = createHash("sha256").update("123456").digest("hex");
  return {
    settings: {
      subPublicBaseUrl: "https://airnetwork.flash-myanmar.com",
      deletedPlanIds: [],
    },
    users: [
      {
        id: "user_admin",
        name: "Admin",
        phone: "09970000001",
        email: "admin@airvpn.mm",
        role: "admin",
        pinHash,
        balanceKs: 0,
      },
    ],
    servers: [],
    plans: [],
    orders: [],
    subscriptions: [],
    transactions: [],
  };
}

mkdirSync(dirname(storePath), { recursive: true });
const store = existsSync(storePath)
  ? JSON.parse(readFileSync(storePath, "utf8"))
  : emptyStore();

if (!store.settings) store.settings = { subPublicBaseUrl: "", deletedPlanIds: [] };
if (!Array.isArray(store.settings.deletedPlanIds)) store.settings.deletedPlanIds = [];
if (!Array.isArray(store.servers)) store.servers = [];
if (!Array.isArray(store.plans)) store.plans = [];

const { meta: _meta, ...server } = result;
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

const deleted = new Set(store.settings.deletedPlanIds);
// Re-applying a VPS node should restore its default plans if they were
// accidentally tombstoned by an older catalog prune.
store.settings.deletedPlanIds = store.settings.deletedPlanIds.filter(
  (id) => !String(id).startsWith(`plan_${server.id}_`),
);
for (const plan of defaultPlans(server.id)) {
  if (!store.plans.find((p) => p.id === plan.id)) store.plans.push(plan);
}

writeFileSync(storePath, JSON.stringify(store, null, 2) + "\n");
console.log(`Applied server ${server.id} → ${storePath}`);
console.log(`Panel: ${server.panelUrl}`);
console.log(`Host: ${server.host}:${server.port} inbound #${server.panelInboundId}`);
