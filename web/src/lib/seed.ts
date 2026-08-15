import { hashPin } from "./hash";
import { DEFAULT_SETTINGS, normalizeServer } from "./server-config";
import { loadShopEnv } from "./shop-env";
import type { Plan, Server, Store, User } from "./types";

const UNLIMITED_DAYS = 36500;

export function adminCredentials() {
  loadShopEnv();
  const email = (process.env.ADMIN_EMAIL || "admin@airvpn.mm").trim().toLowerCase();
  const pin = (process.env.ADMIN_PIN || "123456").trim();
  return {
    email: email || "admin@airvpn.mm",
    pin: pin.length === 6 ? pin : "123456",
  };
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

/** Catalog server — panel settings match production us1 (editable later in Admin). */
function us1Server(): Server {
  return normalizeServer({
    id: "us1",
    slug: "us1",
    name: "United States - California",
    nameMy: "အမေရိကန် - ကလယ်ဖိုးနီးယား",
    region: "US",
    isActive: true,
    sortOrder: 1,
    panelUrl: "http://23.94.229.119:51826/XIzeqcH8HdFgvQ1Aqv",
    panelUsername: "dominate",
    panelPassword: "",
    panelSecret: "",
    panelInboundId: 1,
    panelVerifySsl: true,
    host: "23.94.229.119",
    port: 50708,
    vlessSecurity: "reality",
    vlessFlow: "xtls-rprx-vision",
    vlessSni: "aws.amazon.com",
    vlessFp: "chrome",
    vlessPbk: "h1O2p4CwZv26wliFcB88M3DxLgen-lPHXu5ngXtPGjA",
    vlessSid: "03c1e6a63273",
    vlessSpx: "/",
  });
}

export function seedStore(): Store {
  const admin = adminCredentials();
  const servers: Server[] = [us1Server()];
  const plans = usPlans("us1");
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      subPublicBaseUrl: "https://airnetworkshop.flash-myanmar.com",
    },
    users: [
      {
        id: "user_demo",
        name: "Aung Aung",
        phone: "09970000000",
        email: "user@airvpn.mm",
        role: "user",
        pinHash: hashPin("123456"),
        balanceKs: 500000,
      },
      {
        id: "user_admin",
        name: "Admin",
        phone: "09970000001",
        email: admin.email,
        role: "admin",
        pinHash: hashPin(admin.pin),
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
  const { email, pin } = adminCredentials();
  const pinHash = hashPin(pin);
  const admin = store.users.find((u) => u.id === "user_admin" || u.role === "admin");
  if (!admin) {
    const created: User = {
      id: "user_admin",
      name: "Admin",
      phone: "09970000001",
      email,
      role: "admin",
      pinHash,
      balanceKs: 0,
    };
    store.users.push(created);
    return true;
  }
  let changed = false;
  if (admin.email !== email) {
    admin.email = email;
    changed = true;
  }
  if (admin.pinHash !== pinHash) {
    admin.pinHash = pinHash;
    changed = true;
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
  if (!store.settings.subPublicBaseUrl) {
    store.settings.subPublicBaseUrl = "https://airnetworkshop.flash-myanmar.com";
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
    // Keep admin toggles; refresh identity from seed. Fill panel only when unset.
    existing.name = server.name;
    existing.nameMy = server.nameMy;
    existing.region = server.region;
    existing.slug = server.slug;
    if (!existing.panelUrl) {
      Object.assign(existing, {
        panelUrl: server.panelUrl,
        panelUsername: server.panelUsername,
        panelPassword: server.panelPassword || existing.panelPassword,
        panelSecret: server.panelSecret,
        panelInboundId: server.panelInboundId,
        panelVerifySsl: server.panelVerifySsl,
        host: server.host,
        port: server.port,
        vlessSecurity: server.vlessSecurity,
        vlessFlow: server.vlessFlow,
        vlessSni: server.vlessSni,
        vlessFp: server.vlessFp,
        vlessPbk: server.vlessPbk,
        vlessSid: server.vlessSid,
        vlessSpx: server.vlessSpx,
      });
    }
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
