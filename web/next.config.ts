import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org https://*.telegram.org https://accounts.google.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob: https://cdn.jsdelivr.net",
      "font-src 'self' data:",
      "connect-src 'self' https://api.wathanpay.com https://pgw.flash-myanmar.com https://api.telegram.org https://cdn.jsdelivr.net https://accounts.google.com",
      "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://*.wathanpay.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ssh2"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

