/** ISO country helpers — mirrors android FlagIcon.kt */

const NAME_MATCHERS: Array<[RegExp, string]> = [
  [/\b(singapore|စင်္ကာပူ)\b/u, "SG"],
  [/\b(united\s*states|america|california|new\s*york|los\s*angeles)\b/, "US"],
  [/\b(japan|tokyo|osaka)\b/, "JP"],
  [/\b(korea|seoul)\b/, "KR"],
  [/\b(hong\s*kong)\b/, "HK"],
  [/\b(taiwan|taipei)\b/, "TW"],
  [/\b(myanmar|burma|yangon|mandalay)\b/, "MM"],
  [/\b(malaysia|kuala)\b/, "MY"],
  [/\b(thailand|bangkok)\b/, "TH"],
  [/\b(vietnam|hanoi|saigon|ho\s*chi)\b/, "VN"],
  [/\b(indonesia|jakarta)\b/, "ID"],
  [/\b(philippines|manila)\b/, "PH"],
  [/\b(india|mumbai|delhi)\b/, "IN"],
  [/\b(china|beijing|shanghai)\b/, "CN"],
  [/\b(germany|frankfurt|berlin)\b/, "DE"],
  [/\b(netherlands|amsterdam)\b/, "NL"],
  [/\b(united\s*kingdom|london|england)\b/, "GB"],
  [/\b(france|paris)\b/, "FR"],
  [/\b(australia|sydney|melbourne)\b/, "AU"],
  [/\b(canada|toronto|vancouver)\b/, "CA"],
  [/\b(uae|dubai|emirates)\b/, "AE"],
  [/\b(turkey|türkiye|istanbul)\b/u, "TR"],
  [/\b(russia|moscow)\b/, "RU"],
  [/\b(brazil|sao\s*paulo)\b/, "BR"],
  [/\b(finland|helsinki)\b/, "FI"],
  [/\b(sweden|stockholm)\b/, "SE"],
  [/\b(norway|oslo)\b/, "NO"],
  [/\b(poland|warsaw)\b/, "PL"],
  [/\b(italy|milan|rome)\b/, "IT"],
  [/\b(spain|madrid)\b/, "ES"],
  [/\b(switzerland|zurich)\b/, "CH"],
  [/\b(ireland|dublin)\b/, "IE"],
  [/\b(new\s*zealand)\b/, "NZ"],
];

const SHORT_CODE_RE =
  /(?:^|[\s\-_/])(sg|us|jp|kr|hk|tw|mm|my|th|vn|id|ph|in|cn|de|nl|gb|uk|fr|au|ca|ae|tr|ru|br)(?=$|[\s\-_/0-9])/i;

const COUNTRY_LABELS: Record<string, string> = {
  SG: "Singapore",
  US: "United States of America",
  JP: "Japan",
  KR: "South Korea",
  HK: "Hong Kong",
  TW: "Taiwan",
  MM: "Myanmar",
  MY: "Malaysia",
  TH: "Thailand",
  VN: "Vietnam",
  ID: "Indonesia",
  PH: "Philippines",
  IN: "India",
  CN: "China",
  DE: "Germany",
  NL: "Netherlands",
  GB: "United Kingdom",
  FR: "France",
  AU: "Australia",
  CA: "Canada",
  AE: "United Arab Emirates",
  TR: "Turkey",
  RU: "Russia",
  BR: "Brazil",
  FI: "Finland",
  SE: "Sweden",
  NO: "Norway",
  PL: "Poland",
  IT: "Italy",
  ES: "Spain",
  CH: "Switzerland",
  IE: "Ireland",
  NZ: "New Zealand",
};

export function normalizeCountryCode(code: string): string {
  const cc = code.trim().toUpperCase();
  if (cc === "UK") return "GB";
  return cc;
}

/** Prefer explicit ISO region; fall back to name / slug heuristics (e.g. sg1 → SG). */
export function countryCodeFor(input: {
  region?: string;
  name?: string;
  slug?: string;
  id?: string;
}): string | null {
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

export function countryLabel(code: string | null | undefined): string {
  if (!code) return "";
  const cc = normalizeCountryCode(code);
  return COUNTRY_LABELS[cc] || cc;
}

/** Regional-indicator emoji for an ISO alpha-2 code (e.g. US → 🇺🇸). */
export function flagEmoji(code: string | null | undefined): string {
  if (!code) return "🏳️";
  const cc = normalizeCountryCode(code);
  if (!/^[A-Z]{2}$/.test(cc)) return "🏳️";
  return String.fromCodePoint(...[...cc].map((ch) => 127397 + ch.charCodeAt(0)));
}

/** Direct SVG vector flag from lipis/flag-icons library */
export function flagSvgUrl(countryCode: string, ratio: "4x3" | "1x1" = "4x3"): string {
  const cc = countryCode.trim().toLowerCase();
  return `https://cdn.jsdelivr.net/gh/lipis/flag-icons/flags/${ratio}/${cc}.svg`;
}

export function flagImageUrl(countryCode: string): string {
  return flagSvgUrl(countryCode, "4x3");
}
