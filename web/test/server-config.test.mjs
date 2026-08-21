import test from "node:test";
import assert from "node:assert/strict";

function defaultPanelFields() {
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

function normalizeServer(raw) {
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

function isServerProvisionReady(server) {
  return Boolean(server.panelUrl && server.host && (server.panelPassword || server.panelSecret));
}

test("normalizeServer provides default reality configurations and safe fallbacks", () => {
  const server = normalizeServer({
    id: "sg1",
    slug: "sg1",
    name: "Singapore 1",
  });

  assert.equal(server.id, "sg1");
  assert.equal(server.vlessSecurity, "reality");
  assert.equal(server.vlessFlow, "xtls-rprx-vision");
  assert.equal(server.vlessFp, "chrome");
  assert.equal(server.port, 443);
  assert.equal(server.isActive, true);
  assert.equal(server.panelInboundId, 1);
});

test("isServerProvisionReady validates panel credentials and host reachability requirements", () => {
  const incomplete = normalizeServer({
    id: "sg1",
    slug: "sg1",
    name: "Singapore 1",
  });
  assert.equal(isServerProvisionReady(incomplete), false);

  const readyWithPassword = normalizeServer({
    id: "sg1",
    slug: "sg1",
    name: "Singapore 1",
    panelUrl: "https://130.94.43.213:2053",
    panelPassword: "secret_password",
    host: "130.94.43.213",
  });
  assert.equal(isServerProvisionReady(readyWithPassword), true);

  const readyWithSecret = normalizeServer({
    id: "sg1",
    slug: "sg1",
    name: "Singapore 1",
    panelUrl: "https://130.94.43.213:2053",
    panelSecret: "bearer_token_123",
    host: "130.94.43.213",
  });
  assert.equal(isServerProvisionReady(readyWithSecret), true);
});
