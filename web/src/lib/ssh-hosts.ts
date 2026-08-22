import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

/**
 * Trust-On-First-Use host key store. First connection pins the host key;
 * later connections must match or the handshake is rejected.
 */
const KNOWN_HOSTS = path.join(process.cwd(), "data", "known_hosts");

function loadKnownHosts(): Record<string, string> {
  try {
    if (!existsSync(KNOWN_HOSTS)) return {};
    const raw = readFileSync(KNOWN_HOSTS, "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf(" ");
      if (idx <= 0) continue;
      out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
    return out;
  } catch {
    return {};
  }
}

function saveKnownHost(host: string, fingerprint: string) {
  try {
    const map = loadKnownHosts();
    map[host] = fingerprint;
    const body = Object.entries(map)
      .map(([h, f]) => `${h} ${f}`)
      .join("\n");
    writeFileSync(KNOWN_HOSTS, body + "\n", { mode: 0o600 });
  } catch {
    // best-effort persistence
  }
}

export function pinnedHostFingerprint(host: string): string | null {
  return loadKnownHosts()[host] ?? null;
}

export function forgetHostKey(host: string) {
  const map = loadKnownHosts();
  delete map[host];
  try {
    writeFileSync(
      KNOWN_HOSTS,
      Object.entries(map).map(([h, f]) => `${h} ${f}`).join("\n") + "\n",
      { mode: 0o600 },
    );
  } catch {
    // ignore
  }
}

export type HostKeyVerifier = (key: Buffer) => boolean;

/**
 * Build a TOFU verifier: accepts and records a first-seen key; afterwards only
 * the pinned key verifies. Returns a rejection reason when mismatched.
 */
export function tofuHostVerifier(
  host: string,
): { verify: HostKeyVerifier; error?: string } {
  let mismatch: string | undefined;
  const verify: HostKeyVerifier = (key) => {
    const fp = `sha256:${createHash("sha256").update(key).digest("base64")}`;
    const pinned = pinnedHostFingerprint(host);
    if (!pinned) {
      saveKnownHost(host, fp);
      return true;
    }
    if (pinned === fp) return true;
    mismatch = `SSH host key for ${host} changed (MITM risk). Expected ${pinned}, got ${fp}. If this change is intentional, clear the pin in Admin → data/known_hosts.`;
    return false;
  };
  return { verify, get error() { return mismatch; } };
}
