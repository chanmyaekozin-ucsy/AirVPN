import { useState } from "react";
import { countryCodeFor, countryLabel, flagEmoji, flagImageUrl } from "@/lib/flags";

type FlagIconProps = {
  region?: string;
  name?: string;
  slug?: string;
  id?: string;
  size?: number;
  className?: string;
};

export function FlagIcon({
  region = "",
  name = "",
  slug = "",
  id = "",
  size = 28,
  className = "",
}: FlagIconProps) {
  const code = countryCodeFor({ region, name, slug, id });
  const label = countryLabel(code) || "Unknown";
  const [imgFailed, setImgFailed] = useState(false);
  const emoji = code ? flagEmoji(code) : "🏳️";

  return (
    <span
      className={`flag-icon ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}
      title={label}
      aria-label={label}
    >
      {code && !imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={flagImageUrl(code, Math.round(size * 2.5))}
          alt=""
          draggable={false}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="flag-emoji" aria-hidden>
          {emoji}
        </span>
      )}
    </span>
  );
}
