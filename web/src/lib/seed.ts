import { randomBytes } from "crypto";
import { hashPin, PIN_HASH_PREFIX, verifyPin } from "./hash";
import { DEFAULT_SETTINGS, normalizeServer } from "./server-config";
import { loadShopEnv } from "./shop-env";
import type { Plan, Server, Store, User } from "./types";

const UNLIMITED_DAYS = 36500;

export function adminCredentials() {
  loadShopEnv();
  const email = (process.env.ADMIN_EMAIL || "admin@airvpn.com").trim().toLowerCase();
  const password = (process.env.ADMIN_PASSWORD || "").trim();
  return { email: email || "admin@airvpn.com", password };
}

function adminSecretHash(): string | undefined {
  const { password } = adminCredentials();
  return password ? hashPin(password) : undefined;
}

/** True when the stored admin hash no longer matches ADMIN_PASSWORD from env. */
export function adminCredentialChanged(storedHash: string | undefined): boolean {
  if (!storedHash) return true;
  const { password } = adminCredentials();
  if (!password) return false; // nothing configured — leave stored credentials alone
  if (!storedHash.startsWith(PIN_HASH_PREFIX)) return true;
  return !verifyPin(password, storedHash).ok;
}

function usPlans(serverId: string): Plan[] {
  // title, dataGb, saleKs, compareAtKs, days, sort
  const rows: Array<[string, number, number, number, number | "unlimited", number]> = [
    ["50 GB · 30 Days", 50, 2000, 2500, 30, 1],
    ["100 GB · 30 Days", 100, 3000, 3800, 30, 2],
    ["100 GB · Unlimited Date", 100, 4000, 5000, "unlimited", 3],
    ["300 GB · Unlimited Date", 300, 6000, 7500, "unlimited", 4],
    ["1 TB · Unlimited Date", 1024, 8000, 10000, "unlimited", 5],
  ];
  return rows.map(([title, dataGb, priceKs, compareAtKs, days, sortOrder]) => ({
    id: `plan_${serverId}_${sortOrder}`,
    serverId,
    title,
    dataGb,
    priceKs,
    compareAtKs,
    durationDays: days === "unlimited" ? UNLIMITED_DAYS : days,
    unlimitedDate: days === "unlimited",
    isActive: true,
    sortOrder,
  }));
}

/** Catalog server — panel settings intentionally left blank; configure in Admin → Servers. */
function us1Server(): Server {
  return normalizeServer({
    id: "us1",
    slug: "us1",
    name: "United States - California",
    nameMy: "အမေရိကန် - ကလယ်ဖိုးနီးယား",
    region: "US",
    isActive: true,
    sortOrder: 1,
    panelUrl: "",
    panelUsername: "",
    panelPassword: "",
    panelSecret: "",
    panelInboundId: 1,
    host: "",
    port: 443,
    vlessSni: "aws.amazon.com",
  });
}

export function seedStore(): Store {
  const admin = adminCredentials();
  const servers: Server[] = [us1Server()];
  const plans = usPlans("us1");
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      subPublicBaseUrl: process.env.APP_URL?.replace(/\/$/, "") || "",
    },
    users: [
      {
        id: "user_demo",
        name: "Aung Aung",
        phone: "09970000000",
        email: "user@airvpn.mm",
        role: "user",
        balanceKs: 500000,
      },
      {
        id: "user_admin",
        name: "Admin",
        phone: "09970000001",
        email: admin.email,
      role: "admin",
      ...(admin.password ? { passwordHash: adminSecretHash()! } : {}),
      balanceKs: 0,
      },
    ],
    servers,
    plans,
    orders: [],
    subscriptions: [],
    transactions: [],
  };
}

export function syncAdminFromEnv(store: Store) {
  const { email, password } = adminCredentials();
  const admin = store.users.find((u) => u.id === "user_admin" || u.role === "admin");
  if (!admin) {
    const created: User = {
      id: "user_admin",
      name: "Admin",
      phone: "09970000001",
      email,
      role: "admin",
      ...(password ? { passwordHash: hashPin(password) } : {}),
      balanceKs: 0,
    };
    store.users.push(created);
    return true;
  }
  let changed = false;
  if (email && admin.email !== email) {
    admin.email = email;
    changed = true;
  }
  if (password && (admin.passwordHash === undefined || adminCredentialChanged(admin.passwordHash))) {
    // Covers both fresh accounts and records that only carry a legacy pinHash.
    admin.passwordHash = hashPin(password);
    changed = true;
  }
  if (!password && !admin.passwordHash) {
    console.error(
      "[Seed] ADMIN_PASSWORD is not set and the admin account has no usable password. " +
        "Set ADMIN_PASSWORD in .env to enable admin sign-in.",
    );
  }
  if (admin.role !== "admin") {
    admin.role = "admin";
    changed = true;
  }
  return changed;
}

export function mergeCatalog(store: Store) {
  if (!store.settings) store.settings = { ...DEFAULT_SETTINGS };
  if (typeof store.settings.subPublicBaseUrl !== "string") {
    store.settings.subPublicBaseUrl = "";
  }
  if (!Array.isArray(store.settings.deletedPlanIds)) {
    store.settings.deletedPlanIds = [];
  }
  const deleted = new Set(store.settings.deletedPlanIds);
  const seeded = seedStore();

  // Add missing seed servers only — never delete admin/VPS-installed nodes (e.g. us2).
  for (const server of seeded.servers) {
    const existing = store.servers.find((s) => s.id === server.id);
    if (!existing) {
      store.servers.push(server);
      continue;
    }
    // Keep admin toggles; refresh identity from seed. Never overwrite configured panels.
    existing.name = server.name;
    existing.nameMy = server.nameMy;
    existing.region = server.region;
    existing.slug = server.slug;
    Object.assign(existing, normalizeServer(existing));
  }

  store.servers = store.servers.map((s) => normalizeServer(s));

  for (const plan of seeded.plans) {
    if (deleted.has(plan.id)) continue;
    if (!store.plans.find((p) => p.id === plan.id)) store.plans.push(plan);
  }

  for (const plan of store.plans) {
    if (typeof plan.compareAtKs !== "number" || !Number.isFinite(plan.compareAtKs)) {
      plan.compareAtKs = 0;
    } else {
      plan.compareAtKs = Math.max(0, Math.round(plan.compareAtKs));
    }
  }

  for (const sub of store.subscriptions) {
    if (!sub.subToken && sub.subUrl) {
      const m = /\/sub\/([^/?#]+)/.exec(sub.subUrl);
      if (m) sub.subToken = m[1];
    }
    if (!sub.subToken) sub.subToken = "";
    if (!sub.panelEmail) sub.panelEmail = "";
    if (!sub.clientUuid) sub.clientUuid = "";
  }
}

/** Random id helper for records that need uniqueness without a counter. */
export function randomId(bytes = 8): string {
  return randomBytes(bytes).toString("hex");
}
