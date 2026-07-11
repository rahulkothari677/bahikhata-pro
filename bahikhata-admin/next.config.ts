import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  // 🔒 V7 Audit C4 FIX: Removed `typescript: { ignoreBuildErrors: true }`.
  // Type errors (which could include security bugs) are no longer silently
  // swallowed during build. If type errors exist, they must be fixed before
  // the admin panel can deploy.
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },

  // 🔒 SECURITY (Audit fix N4 + V7 H3): Content-Security-Policy + security headers
  // for the admin panel.
  //
  // 🔒 V7 Audit H3 FIX: Removed 'unsafe-eval' from script-src. The admin panel
  // doesn't use eval() or new Function() — unsafe-eval was a leftover from a
  // development config. Kept 'unsafe-inline' for now (switching to nonce-based
  // CSP requires middleware changes — deferred to a future hardening pass).
  //
  // 🔒 V7 Audit H3: CSP is still report-only. Switching to ENFORCED requires
  // testing all admin pages for violations first. This is a planned hardening
  // step before launch.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: blob: https:",
              "connect-src 'self' https://*.sentry.io",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
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
            // 🔒 V7 Audit: HSTS missing from admin panel
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            // 🔒 V7 Audit: Permissions-Policy missing from admin panel
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
}

export default nextConfig
