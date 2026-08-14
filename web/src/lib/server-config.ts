import type { PublicServer, Server, ShopSettings } from "./types";

export const DEFAULT_SETTINGS: ShopSettings = {
  subPublicBaseUrl: "",
  deletedPlanIds: [],
};

export function defaultPanelFields(): Omit<
  Server,
  "id" | "slug" | "name" | "nameMy" | "region" | "isActive" | "sortOrder"
> {
  return {
    panelUrl: "",
    panelUsername: "",
    panelPassword: "",
    panelSecret: "",
    panelInboundId: 1,
    panelVerifySsl: true,
    host: "",
    port: 443,
    vlessSecurity: "reality",
    vlessFlow: "xtls-rprx-vision",
    vlessSni: "",
    vlessFp: "chrome",
    vlessPbk: "",
    vlessSid: "",
    vlessSpx: "/",
  };
}

export function normalizeServer(raw: Partial<Server> & Pick<Server, "id" | "slug" | "name">): Server {
  const defaults = defaultPanelFields();
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    nameMy: raw.nameMy || raw.name,
    region: raw.region || "",
    isActive: raw.isActive !== false,
    sortOrder: typeof raw.sortOrder === "number" ? raw.sortOrder : 0,
    panelUrl: (raw.panelUrl || "").replace(/\/$/, ""),
    panelUsername: raw.panelUsername || "",
    panelPassword: raw.panelPassword || "",
    panelSecret: raw.panelSecret || "",
    panelInboundId: Math.max(1, Math.round(Number(raw.panelInboundId) || 1)),
    panelVerifySsl: raw.panelVerifySsl !== false,
    host: raw.host || "",
    port: Math.max(1, Math.round(Number(raw.port) || 443)),
    vlessSecurity: raw.vlessSecurity || defaults.vlessSecurity,
    vlessFlow: raw.vlessFlow || defaults.vlessFlow,
    vlessSni: raw.vlessSni || "",
    vlessFp: raw.vlessFp || defaults.vlessFp,
    vlessPbk: raw.vlessPbk || "",
    vlessSid: raw.vlessSid || "",
    vlessSpx: raw.vlessSpx || "/",
  };
}

export function isServerProvisionReady(server: Server): boolean {
  return Boolean(server.panelUrl && server.host && (server.panelPassword || server.panelSecret));
}

export function toPublicServer(server: Server): PublicServer {
  return {
    id: server.id,
    slug: server.slug,
    name: server.name,
    nameMy: server.nameMy,
    region: server.region,
    isActive: server.isActive,
    sortOrder: server.sortOrder,
  };
}
