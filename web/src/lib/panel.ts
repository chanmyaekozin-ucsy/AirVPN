import { randomUUID } from "crypto";
import type { Server } from "./types";
import { isServerProvisionReady } from "./server-config";

export class PanelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PanelError";
  }
}

type Json = Record<string, unknown>;

function parseJsonField(value: unknown, field: string): Json | unknown[] {
  if (value == null) return {};
  if (typeof value === "object") return value as Json;
  if (typeof value === "string") {
    if (!value.trim()) return {};
    return JSON.parse(value) as Json;
  }
  throw new PanelError(`Unexpected type for inbound ${field}`);
}

function serializeJsonField(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? {});
}

function parseSetCookie(header: string | null): string[] {
  if (!header) return [];
  // Node fetch may join multiple Set-Cookie with comma — keep name=value only.
  return header
    .split(/,(?=[^;]+?=)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter(Boolean) as string[];
}

class CookieJar {
  private jar = new Map<string, string>();

  absorb(res: Response) {
    const raw =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : parseSetCookie(res.headers.get("set-cookie"));
    for (const line of raw) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const name = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!name) continue;
      if (!value || value.toLowerCase() === "deleted") this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  header(): string | undefined {
    if (!this.jar.size) return undefined;
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export function buildVlessUrl(input: {
  uuid: string;
  host: string;
  port: number;
  remark: string;
  stream?: Json;
  server: Server;
}): string {
  const { uuid, host, port, remark, stream, server } = input;
  const params = new URLSearchParams({
    encryption: "none",
    type: "tcp",
    security: server.vlessSecurity || "reality",
  });

  if (stream && typeof stream === "object" && !Array.isArray(stream)) {
    const net = String(stream.network || "tcp");
    params.set("type", net);
    const sec = String(stream.security || server.vlessSecurity || "reality");
    params.set("security", sec);

    if (sec === "reality") {
      const rs = (stream.realitySettings || {}) as Json;
      const rsSettings = (rs.settings || {}) as Json;
      const serverNames = (rs.serverNames as string[] | undefined) || [];
      const shortIds = (rs.shortIds as string[] | undefined) || [];
      params.set("pbk", server.vlessPbk || String(rsSettings.publicKey || ""));
      params.set("fp", server.vlessFp || "chrome");
      params.set("sni", server.vlessSni || serverNames[0] || "");
      params.set("sid", server.vlessSid || shortIds[0] || "");
      params.set("spx", server.vlessSpx || "/");
      if (server.vlessFlow) params.set("flow", server.vlessFlow);
    } else if (sec === "tls") {
      const ts = (stream.tlsSettings || {}) as Json;
      params.set("sni", server.vlessSni || String(ts.serverName || host));
    }
  } else if ((server.vlessSecurity || "reality") === "reality") {
    params.set("pbk", server.vlessPbk);
    params.set("fp", server.vlessFp || "chrome");
    params.set("sni", server.vlessSni);
    params.set("sid", server.vlessSid);
    params.set("spx", server.vlessSpx || "/");
    if (server.vlessFlow) params.set("flow", server.vlessFlow);
  }

  return `vless://${uuid}@${host}:${port}?${params.toString()}#${encodeURIComponent(remark)}`;
}

export class PanelClient {
  private cookies = new CookieJar();
  private loggedIn = false;

  constructor(private server: Server) {
    if (!server.panelUrl) {
      throw new PanelError(`Panel URL is not configured for server ${server.id}`);
    }
  }

  private get base() {
    return this.server.panelUrl.replace(/\/$/, "");
  }

  private apiHeaders(): HeadersInit {
    if (this.server.panelSecret) {
      return { Authorization: `Bearer ${this.server.panelSecret}` };
    }
    return {};
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = this.cookies.header();
    if (cookie) headers.set("cookie", cookie);
    for (const [k, v] of Object.entries(this.apiHeaders())) headers.set(k, v);

    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers,
      // Node undici: allow self-signed when verifySsl false via custom dispatcher is complex;
      // panels on http:// skip TLS; https with bad certs need NODE_TLS_REJECT_UNAUTHORIZED in host.
      redirect: "manual",
    });
    this.cookies.absorb(res);
    return res;
  }

  private async parseJson(res: Response, action: string): Promise<Json> {
    if (res.status >= 400) throw new PanelError(`${action} failed: HTTP ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text) as Json;
    } catch {
      throw new PanelError(`${action} failed: non-JSON response (${text.slice(0, 200)})`);
    }
  }

  async login() {
    if (this.server.panelSecret) {
      this.loggedIn = true;
      return;
    }
    const csrfRes = await this.request("/csrf-token");
    const csrfBody = await this.parseJson(csrfRes, "csrf-token");
    const csrfToken = String(csrfBody.obj || "");
    if (!csrfToken) throw new PanelError("Panel csrf-token missing (3x-ui v3?)");

    const body = new URLSearchParams({
      username: this.server.panelUsername,
      password: this.server.panelPassword,
    });
    const res = await this.request("/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": csrfToken,
      },
      body,
    });
    const loginBody = await this.parseJson(res, "login");
    if (!loginBody.success) {
      throw new PanelError(`Panel login failed: ${String(loginBody.msg || "unknown")}`);
    }
    this.loggedIn = true;
  }

  private async ensureLogin() {
    if (!this.loggedIn) await this.login();
  }

  private async csrfToken(): Promise<string> {
    const res = await this.request("/csrf-token");
    const body = await this.parseJson(res, "csrf-token");
    return String(body.obj || "");
  }

  private async get(path: string) {
    await this.ensureLogin();
    return this.request(path);
  }

  private async post(path: string, init: RequestInit = {}) {
    await this.ensureLogin();
    const headers = new Headers(init.headers);
    if (!this.server.panelSecret) {
      headers.set("x-csrf-token", await this.csrfToken());
    }
    return this.request(path, { ...init, method: "POST", headers });
  }

  async getInbound(inboundId?: number) {
    const iid = inboundId ?? this.server.panelInboundId;
    const res = await this.get(`/panel/api/inbounds/get/${iid}`);
    const body = await this.parseJson(res, "get inbound");
    if (!body.success) throw new PanelError(`get inbound failed: ${String(body.msg)}`);
    return body.obj as Json;
  }

  /** Login + fetch inbound — used by Admin “Test connection”. */
  async testConnection(): Promise<{
    ok: true;
    inboundId: number;
    protocol: string;
    port: number;
    remark: string;
    clientCount: number;
    sampleVless: string;
  }> {
    await this.login();
    const inbound = await this.getInbound();
    const settings = parseJsonField(inbound.settings, "settings") as Json;
    const stream = parseJsonField(inbound.streamSettings, "streamSettings") as Json;
    const clients = Array.isArray(settings.clients) ? settings.clients : [];
    const port = this.server.port || Number(inbound.port) || 443;
    const sampleVless = buildVlessUrl({
      uuid: "00000000-0000-0000-0000-000000000000",
      host: this.server.host || "host.invalid",
      port,
      remark: `AirVPN-test-${this.server.id}`,
      stream,
      server: this.server,
    });
    return {
      ok: true,
      inboundId: Number(inbound.id) || this.server.panelInboundId,
      protocol: String(inbound.protocol || ""),
      port: Number(inbound.port) || port,
      remark: String(inbound.remark || ""),
      clientCount: clients.length,
      sampleVless,
    };
  }

  async addClient(input: {
    emailPrefix: string;
    dataLimitGb: number;
    expiryDays: number;
    remark: string;
  }): Promise<{ uuid: string; email: string; vlessKey: string }> {
    const inbound = await this.getInbound();
    const settings = parseJsonField(inbound.settings, "settings") as Json;
    const stream = parseJsonField(inbound.streamSettings, "streamSettings") as Json;

    const clientUuid = randomUUID();
    const email = `${input.emailPrefix}_${clientUuid.slice(0, 8)}`;
    const totalBytes = Math.round(input.dataLimitGb * 1024 ** 3);
    const expiryMs = Date.now() + Math.max(1, input.expiryDays) * 24 * 60 * 60 * 1000;
    const flow = this.server.vlessSecurity === "reality" ? this.server.vlessFlow : "";

    const clients = Array.isArray(settings.clients) ? [...(settings.clients as Json[])] : [];
    clients.push({
      id: clientUuid,
      email,
      enable: true,
      expiryTime: expiryMs,
      totalGB: totalBytes,
      limitIp: 2,
      flow,
    });
    settings.clients = clients;

    const payload = {
      id: inbound.id,
      settings: JSON.stringify(settings),
      streamSettings: serializeJsonField(inbound.streamSettings),
      sniffing: serializeJsonField(inbound.sniffing ?? "{}"),
      remark: inbound.remark ?? "",
      enable: inbound.enable ?? true,
      expiryTime: inbound.expiryTime ?? 0,
      listen: inbound.listen ?? "",
      port: inbound.port,
      protocol: inbound.protocol,
      tag: inbound.tag ?? "",
    };

    const res = await this.post(`/panel/api/inbounds/update/${inbound.id}`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await this.parseJson(res, "add client");
    if (!body.success) throw new PanelError(`add client failed: ${String(body.msg)}`);

    const port = this.server.port || Number(inbound.port) || 443;
    const vlessKey = buildVlessUrl({
      uuid: clientUuid,
      host: this.server.host,
      port,
      remark: input.remark,
      stream,
      server: this.server,
    });
    return { uuid: clientUuid, email, vlessKey };
  }
}

export async function provisionVless(input: {
  server: Server;
  userKey: string;
  dataGb: number;
  durationDays: number;
  remark: string;
}): Promise<{ uuid: string; email: string; vlessKey: string }> {
  const { server } = input;
  if (!isServerProvisionReady(server)) {
    throw new PanelError(
      `Server ${server.id} is not configured. Set panel URL, host, and password/secret in Admin → Servers.`,
    );
  }
  const client = new PanelClient(server);
  return client.addClient({
    emailPrefix: `web_${input.userKey}`.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24) || "web",
    dataLimitGb: input.dataGb,
    expiryDays: input.durationDays >= 36500 ? 36500 : Math.max(1, input.durationDays),
    remark: input.remark,
  });
}

export async function testPanelConnection(server: Server) {
  if (!isServerProvisionReady(server)) {
    throw new PanelError(
      `Server ${server.id} is not configured. Set panel URL, host, and password/secret first.`,
    );
  }
  const client = new PanelClient(server);
  return client.testConnection();
}
