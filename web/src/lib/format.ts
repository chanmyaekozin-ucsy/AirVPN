export function formatKs(n: number) {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded).toLocaleString("en-US");
  return rounded < 0 ? `-${abs} Ks` : `${abs} Ks`;
}

/** CloudGameShop-style discount from compare-at vs sale price. */
export function planDiscount(plan: { priceKs: number; compareAtKs?: number | null }) {
  const priceKs = Math.max(0, Math.round(Number(plan.priceKs) || 0));
  const compareAtKs = Math.max(0, Math.round(Number(plan.compareAtKs) || 0));
  const hasDiscount = compareAtKs > priceKs;
  const offKs = hasDiscount ? compareAtKs - priceKs : 0;
  const offPct = hasDiscount ? Math.round((offKs / compareAtKs) * 100) : 0;
  return { priceKs, compareAtKs, hasDiscount, offKs, offPct };
}

export function formatOffBadge(offKs: number, offPct: number) {
  if (offKs <= 0) return "";
  const parts: string[] = [];
  if (offPct > 0) parts.push(`${offPct}% off`);
  parts.push(`${offKs.toLocaleString("en-US")} off`);
  return parts.join(" · ");
}

export function formatDataGb(n: number) {
  if (n >= 1024) return `${(n / 1024).toFixed(n % 1024 === 0 ? 0 : 1)} TB`;
  return `${n} GB`;
}

export function formatDuration(days: number, unlimitedDate?: boolean) {
  if (unlimitedDate || days >= 36500) return "Unlimited date";
  return `${days} days`;
}

export function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function orderStatusLabel(status: string) {
  if (status === "success") return "Active";
  if (status === "awaiting_payment") return "Awaiting payment";
  if (status === "processing") return "Processing";
  if (status === "paid") return "Paid";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return status;
}

/**
 * Format custom VLESS node remark / name:
 * e.g. Singapore_Ko_Kyaw_100Gb
 */
export function formatKeyRemark(serverName: string, userName?: string, dataGb?: number): string {
  const cleanServer = (serverName || "AirVPN")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "Server";
  const cleanUser = (userName || "User")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "User";
  const gbText = dataGb && dataGb < 36500 ? `${dataGb}Gb` : "Unlimited";
  return `${cleanServer}_${cleanUser}_${gbText}`;
}

