import Image from "next/image";

interface AirVpnLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
}

export function AirVpnLogo({
  size = 32,
  className = "",
  showText = false,
}: AirVpnLogoProps) {
  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size > 40 ? 12 : 8,
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          position: "relative",
          borderRadius: Math.round(size * 0.22),
          overflow: "hidden",
          border: "1px solid var(--border)",
          backgroundColor: "#ffffff",
          flexShrink: 0,
        }}
      >
        <Image
          src="/logo.png"
          alt="AirVPN"
          width={size}
          height={size}
          style={{
            objectFit: "cover",
            width: "100%",
            height: "100%",
            display: "block",
          }}
          priority
        />
      </div>

      {showText ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              fontWeight: 700,
              fontSize: size > 40 ? 20 : 16,
              letterSpacing: "-0.03em",
              color: "var(--navy)",
              lineHeight: 1.1,
            }}
          >
            AirVPN
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              letterSpacing: "0.02em",
            }}
          >
            Admin Panel
          </span>
        </div>
      ) : null}
    </div>
  );
}
