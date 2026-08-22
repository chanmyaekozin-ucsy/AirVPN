import { existsSync, readFileSync } from "fs";
import path from "path";

let loaded = false;

export function loadShopEnv() {
  if (loaded) return;
  loaded = true;
  const files = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "..", ".env"),
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const i = trimmed.indexOf("=");
      const key = trimmed.slice(0, i).trim();
      let value = trimmed.slice(i + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

export function dominateConfig() {
  loadShopEnv();
  const rawUrl = process.env.DOMINATE_GATEWAY_URL || "https://pgw.flash-myanmar.com";
  let url = rawUrl.replace(/\/$/, "");
  if (!url.endsWith("/v1")) {
    url = `${url}/v1`;
  }
  return {
    url,
    baseUrl: rawUrl.replace(/\/$/, ""),
    key: process.env.DOMINATE_GATEWAY_API_KEY || "",
    webhookSecret: process.env.DOMINATE_WEBHOOK_SECRET || "",
  };
}
