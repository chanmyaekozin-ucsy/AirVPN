"use client";

import { useState } from "react";
import { countryCodeFor, countryLabel, flagSvgUrl } from "@/lib/flags";

type FlagIconProps = {
  region?: string;
  name?: string;
  slug?: string;
  id?: string;
  size?: number;
  className?: string;
  ratio?: "4x3" | "1x1";
};

export function FlagIcon({
  region = "",
  name = "",
  slug = "",
  id = "",
  size = 28,
  className = "",
  ratio = "4x3",
}: FlagIconProps) {
  const code = countryCodeFor({ region, name, slug, id });
  const label = countryLabel(code) || name || "Location";
  const [imgFailed, setImgFailed] = useState(false);

  // Calculate proportional dimensions
  const width = size;
  const height = ratio === "4x3" ? Math.round((size * 3) / 4) : size;

  return (
    <span
      className={`flag-box ${className}`.trim()}
      style={{
        width,
        height,
        minWidth: width,
        minHeight: height,
      }}
      title={label}
      aria-label={label}
    >
      {code && !imgFailed ? (
        <img
          src={flagSvgUrl(code, ratio)}
          alt={label}
          className="flag-svg"
          draggable={false}
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="flag-fallback-text" aria-hidden>
          {code || (region.slice(0, 2) || "VPN").toUpperCase()}
        </span>
      )}
    </span>
  );
}
