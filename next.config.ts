import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // 🔒 V9 1.6: Removed `output: "standalone"` — we deploy on Vercel only
  // (not self-hosted with Bun). Vercel builds its own serverless output and
  // ignores standalone mode. Keeping it caused confusion (the `start` script
  // runs `bun .next/standalone/server.js` which never runs on Vercel).
  // reactStrictMode: Enabled — surfaces effect/concurrency bugs in development.
  reactStrictMode: true,
  // Disable source maps in production — saves ~5MB of transfer on first load.
  // Note: Sentry can still receive source maps if uploaded separately.
  productionBrowserSourceMaps: false,

  // 🔒 SECURITY (Audit fix N3 + M11 + V9 2.6): Content-Security-Policy header.
  // Now ENFORCED (was report-only). Monitored for 1+ week with no violations.
  //
  // 🔒 V9 2.6: CSP is now set in middleware (nonce-based). These headers
  // are a FALLBACK for static files (which middleware doesn't cover).
  // CSP is NOT set here — middleware sets it per-request with a nonce.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
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
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },

  // Performance: tree-shake large icon/component libraries so only the icons
  // actually used are included in the bundle (instead of all 1,000+ lucide icons).
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-switch",
      "@radix-ui/react-avatar",
      "@radix-ui/react-slot",
      "recharts",
    ],
  },
};

// Sentry configuration — wraps the Next.js config to add error tracking.
// If SENTRY_DSN is not set, Sentry is a no-op (safe for local dev).
export default withSentryConfig(nextConfig, {
  // Only upload source maps in production builds
  silent: true,

  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Don't upload source maps automatically — we'll do it manually if needed
  // to avoid build failures when SENTRY_AUTH_TOKEN isn't set
  sourcemaps: {
    disable: true,
  },
});
