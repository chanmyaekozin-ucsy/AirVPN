import test from "node:test";
import assert from "node:assert/strict";

function formatKs(n) {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded).toLocaleString("en-US");
  return rounded < 0 ? `-${abs} Ks` : `${abs} Ks`;
}

function planDiscount(plan) {
  const priceKs = Math.max(0, Math.round(Number(plan.priceKs) || 0));
  const compareAtKs = Math.max(0, Math.round(Number(plan.compareAtKs) || 0));
  const hasDiscount = compareAtKs > priceKs;
  const offKs = hasDiscount ? compareAtKs - priceKs : 0;
  const offPct = hasDiscount ? Math.round((offKs / compareAtKs) * 100) : 0;
  return { priceKs, compareAtKs, hasDiscount, offKs, offPct };
}

function formatOffBadge(offKs, offPct) {
  if (offKs <= 0) return "";
  const parts = [];
  if (offPct > 0) parts.push(`${offPct}% off`);
  parts.push(`${offKs.toLocaleString("en-US")} off`);
  return parts.join(" · ");
}

function formatDataGb(n) {
  if (n >= 1024) return `${(n / 1024).toFixed(n % 1024 === 0 ? 0 : 1)} TB`;
  return `${n} GB`;
}

function formatDuration(days, unlimitedDate) {
  if (unlimitedDate || days >= 36500) return "Unlimited date";
  return `${days} days`;
}

function formatKeyRemark(serverName, userName, dataGb) {
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

test("formatKs formats Myanmar Kyats with commas and symbols", () => {
  assert.equal(formatKs(3000), "3,000 Ks");
  assert.equal(formatKs(0), "0 Ks");
  assert.equal(formatKs(500000), "500,000 Ks");
  assert.equal(formatKs(-1500), "-1,500 Ks");
});

test("planDiscount computes percentage and amount discounts correctly", () => {
  const disc = planDiscount({ priceKs: 3000, compareAtKs: 5000 });
  assert.equal(disc.hasDiscount, true);
  assert.equal(disc.offKs, 2000);
  assert.equal(disc.offPct, 40);

  const noDisc = planDiscount({ priceKs: 3000, compareAtKs: 0 });
  assert.equal(noDisc.hasDiscount, false);
  assert.equal(noDisc.offKs, 0);
  assert.equal(noDisc.offPct, 0);
});

test("formatDataGb formats GB and TB with decimal rounding", () => {
  assert.equal(formatDataGb(50), "50 GB");
  assert.equal(formatDataGb(100), "100 GB");
  assert.equal(formatDataGb(1024), "1 TB");
  assert.equal(formatDataGb(1536), "1.5 TB");
  assert.equal(formatDataGb(2048), "2 TB");
});

test("formatDuration formats days and unlimited flags", () => {
  assert.equal(formatDuration(30, false), "30 days");
  assert.equal(formatDuration(36500, true), "Unlimited date");
  assert.equal(formatDuration(36500, false), "Unlimited date");
});

test("formatKeyRemark sanitizes characters and produces standardized VLESS remarks", () => {
  assert.equal(
    formatKeyRemark("Singapore 1", "Ko Kyaw", 100),
    "Singapore_1_Ko_Kyaw_100Gb"
  );
  assert.equal(
    formatKeyRemark("United States - California", "Aung Aung!!", 50),
    "United_States_California_Aung_Aung_50Gb"
  );
  assert.equal(
    formatKeyRemark("SG Node", "User", 36500),
    "SG_Node_User_Unlimited"
  );
});
