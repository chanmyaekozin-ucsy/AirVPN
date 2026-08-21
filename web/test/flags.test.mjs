import test from "node:test";
import assert from "node:assert/strict";

const NAME_MATCHERS = [
  [/\b(singapore|စင်္ကာပူ)\b/u, "SG"],
  [/\b(united\s*states|america|california|new\s*york|los\s*angeles)\b/, "US"],
  [/\b(japan|tokyo|osaka)\b/, "JP"],
  [/\b(korea|seoul)\b/, "KR"],
  [/\b(hong\s*kong)\b/, "HK"],
  [/\b(taiwan|taipei)\b/, "TW"],
  [/\b(myanmar|burma|yangon|mandalay)\b/, "MM"],
];

const SHORT_CODE_RE =
  /(?:^|[\s\-_/])(sg|us|jp|kr|hk|tw|mm|my|th|vn|id|ph|in|cn|de|nl|gb|uk|fr|au|ca|ae|tr|ru|br)(?=$|[\s\-_/0-9])/i;

function normalizeCountryCode(code) {
  const cc = code.trim().toUpperCase();
  if (cc === "UK") return "GB";
  return cc;
}

function countryCodeFor(input) {
  const region = (input.region || "").trim().toUpperCase();
  if (region.length === 2 && /^[A-Z]{2}$/.test(region)) {
    return normalizeCountryCode(region);
  }

  const blob = [input.name, input.slug, input.id]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .trim();
  if (!blob) return null;

  for (const [re, cc] of NAME_MATCHERS) {
    if (re.test(blob)) return normalizeCountryCode(cc);
  }

  const short = SHORT_CODE_RE.exec(blob);
  if (short?.[1]) return normalizeCountryCode(short[1]);

  return null;
}

function flagSvgUrl(countryCode, ratio = "4x3") {
  const cc = countryCode.trim().toLowerCase();
  return `https://cdn.jsdelivr.net/gh/lipis/flag-icons/flags/${ratio}/${cc}.svg`;
}

test("normalizeCountryCode normalizes alpha-2 and UK to GB", () => {
  assert.equal(normalizeCountryCode("sg"), "SG");
  assert.equal(normalizeCountryCode("us"), "US");
  assert.equal(normalizeCountryCode("uk"), "GB");
  assert.equal(normalizeCountryCode("GB"), "GB");
});

test("countryCodeFor extracts ISO code from region or names", () => {
  assert.equal(countryCodeFor({ region: "SG" }), "SG");
  assert.equal(countryCodeFor({ name: "Singapore 1" }), "SG");
  assert.equal(countryCodeFor({ name: "United States - California" }), "US");
  assert.equal(countryCodeFor({ slug: "us2" }), "US");
  assert.equal(countryCodeFor({ name: "Tokyo Premium", slug: "jp-tokyo" }), "JP");
});

test("flagSvgUrl creates CDN URLs from lipis/flag-icons", () => {
  assert.equal(
    flagSvgUrl("SG", "4x3"),
    "https://cdn.jsdelivr.net/gh/lipis/flag-icons/flags/4x3/sg.svg"
  );
  assert.equal(
    flagSvgUrl("US", "1x1"),
    "https://cdn.jsdelivr.net/gh/lipis/flag-icons/flags/1x1/us.svg"
  );
});
