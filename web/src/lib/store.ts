import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { decryptField, encryptField, isEncrypted } from "./crypto-fields";
import { mergeCatalog, seedStore, syncAdminFromEnv } from "./seed";
import type { Server, Store } from "./types";

const FILE = path.join(process.cwd(), "data", "store.json");
const AWAITING_PAYMENT_MS = 3 * 60 * 60 * 1000;

function expireStaleOrders(store: Store) {
  const cutoff = Date.now() - AWAITING_PAYMENT_MS;
  let changed = false;
  for (const order of store.orders) {
    if (order.status !== "awaiting_payment") continue;
    const created = Date.parse(order.createdAt);
    if (!Number.isFinite(created) || created > cutoff) continue;
    order.status = "failed";
    order.failReason = "Payment timed out after 3 hours.";
    order.completedAt = new Date().toISOString();
    changed = true;
  }
  return changed;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Panel credentials are encrypted at rest with STORE_SECRET (AES-256-GCM).
 * In-memory copies are plaintext; disk copies are ciphertext. Values written
 * before STORE_SECRET existed are encrypted lazily on the next write.
 */
function decryptServers(store: Store) {
  const keepCiphertext = (value: string | undefined): string => {
    if (!value || !isEncrypted(value)) return value ?? "";
    // Without STORE_SECRET we cannot decrypt; keeping the ciphertext preserves
    // the credential so it recovers when the correct secret is restored.
    if (!process.env.STORE_SECRET?.trim()) return value;
    return decryptField(value) || value;
  };
  for (const s of store.servers) {
    s.panelPassword = keepCiphertext(s.panelPassword);
    s.panelSecret = keepCiphertext(s.panelSecret);
  }
}

function encryptServers(store: Store) {
  for (const s of store.servers) {
    if (s.panelPassword && !isEncrypted(s.panelPassword)) {
      s.panelPassword = encryptField(s.panelPassword);
    }
    if (s.panelSecret && !isEncrypted(s.panelSecret)) {
      s.panelSecret = encryptField(s.panelSecret);
    }
  }
}

async function readRaw(): Promise<Store> {
  try {
    const raw = await readFile(FILE, "utf8");
    const store = JSON.parse(raw) as Store;
    if (!store.servers) store.servers = [];
    if (!store.plans) store.plans = [];
    if (!store.subscriptions) store.subscriptions = [];
    if (!store.settings) store.settings = { subPublicBaseUrl: "", deletedPlanIds: [] };
    decryptServers(store);
    const beforeServers = store.servers.map((s) => s.id).join(",");
    const beforePlans = store.plans.length;
    mergeCatalog(store);
    let dirty = expireStaleOrders(store);
    if (syncAdminFromEnv(store)) dirty = true;
    if (
      store.servers.map((s) => s.id).join(",") !== beforeServers ||
      store.plans.length !== beforePlans
    ) {
      dirty = true;
    }
    if (dirty) await writeRaw(store);
    return store;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code !== "ENOENT") {
      console.error("[Store] Error reading store.json:", err);
    }
    const seeded = seedStore();
    try {
      await mkdir(path.dirname(FILE), { recursive: true });
      await writeFile(FILE, JSON.stringify(seeded, null, 2) + "\n", "utf8");
    } catch (writeErr) {
      console.error("[Store] Error writing seeded store.json (check folder permissions):", writeErr);
    }
    return seeded;
  }
}

async function writeRaw(store: Store) {
  const snapshot: Store = JSON.parse(JSON.stringify(store));
  encryptServers(snapshot);
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  } catch (err) {
    console.error("[Store] Error writing to store.json:", err);
    throw err;
  }
}

export function readStore(): Promise<Store> {
  const next = queue.then(readRaw, readRaw);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function updateStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const store = await readRaw();
    const result = await fn(store);
    await writeRaw(store);
    return result;
  };
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export type { Server };
