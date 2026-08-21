import Image from "next/image";

interface AirVpnLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  textClassName?: string;
}

export function AirVpnLogo({
  size = 32,
  className = "",
  showText = false,
  textClassName = "",
}: AirVpnLogoProps) {
  return (
    <div
      className={`airvpn-logo-wrap ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size > 40 ? 12 : 8,
      }}
    >
      <div
        className="airvpn-logo-icon"
        style={{
          width: size,
          height: size,
          position: "relative",
          borderRadius: size * 0.25,
          overflow: "hidden",
          background: "linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(30, 58, 138, 0.4))",
          boxShadow: "0 0 20px rgba(14, 165, 233, 0.25)",
          flexShrink: 0,
        }}
      >
        <Image
          src="/logo.png"
          alt="AirVPN Logo"
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
        <div className={`airvpn-logo-text ${textClassName}`} style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 800, fontSize: size > 40 ? 22 : 17, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
            Air<span style={{ color: "#0ea5e9" }}>VPN</span>
          </span>
          <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Admin Panel
          </span>
        </div>
      ) : null}
    </div>
  );
}
