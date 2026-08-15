import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(root, "data/store.json"), "utf8"));
const serverId = process.argv[2] || "sg1";
const server = store.servers.find((s) => s.id === serverId);

if (!server) {
  console.error(`Server ${serverId} not found`);
  process.exit(1);
}

if (!server.panelUrl || !server.host || !(server.panelPassword || server.panelSecret)) {
  console.error(`Server ${serverId} is not fully configured`);
  process.exit(1);
}

const base = String(server.panelUrl).replace(/\/$/, "");
const jar = new Map();

function absorbCookies(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const line of raw) {
    const part = String(line).split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
}

async function req(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (jar.size) headers.set("cookie", [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
  if (server.panelSecret) headers.set("Authorization", `Bearer ${server.panelSecret}`);
  const res = await fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
  absorbCookies(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} non-JSON (${res.status}): ${text.slice(0, 180)}`);
  }
  return { res, json };
}

(async () => {
  const started = Date.now();
  console.log(`Testing ${server.id} → ${base}`);

  if (!server.panelSecret) {
    const csrf = await req("/csrf-token");
    const token = csrf.json.obj;
    if (!token) throw new Error("csrf-token missing");
    const login = await req("/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": String(token),
      },
      body: new URLSearchParams({
        username: server.panelUsername,
        password: server.panelPassword,
      }),
    });
    if (!login.json.success) throw new Error(`login failed: ${login.json.msg}`);
    console.log("login: ok");
  } else {
    console.log("auth: bearer token");
  }

  const inboundId = server.panelInboundId || 1;
  const inbound = await req(`/panel/api/inbounds/get/${inboundId}`);
  if (!inbound.json.success) throw new Error(`get inbound failed: ${inbound.json.msg}`);
  const obj = inbound.json.obj || {};
  const settings = typeof obj.settings === "string" ? JSON.parse(obj.settings || "{}") : obj.settings || {};
  const clients = Array.isArray(settings.clients) ? settings.clients : [];
  
  console.log(
    JSON.stringify(
      {
        ok: true,
        inboundId: obj.id,
        protocol: obj.protocol,
        port: obj.port,
        remark: obj.remark,
        clientCount: clients.length,
        ms: Date.now() - started,
        probeId: randomUUID().slice(0, 8),
      },
      null,
      2,
    ),
  );
})();