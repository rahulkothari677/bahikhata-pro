import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// 🔒 V20-015: Bundle analyzer — Next.js 16 ships `next experimental-analyze`
// (Turbopack-native interactive web UI). The legacy @next/bundle-analyzer
// package is NOT compatible with Turbopack builds (Next 16 default).
//
// Usage: `npm run analyze` → runs `next experimental-analyze` → opens
// interactive treemap at http://localhost:4000 showing every module's size.
// Or `npm run analyze:output` to write static analysis files to disk
// (for CI / commit-to-repo workflows).
//
// The auditor's §2.2 recommendation: "Run @next/bundle-analyzer and attack
// the top 5 chunks." This is the Next 16 equivalent — same purpose, native
// to the build toolchain, no extra dependency.
//
// (We intentionally did NOT install @next/bundle-analyzer — it prints a
// "not compatible with Turbopack" warning and produces no output.)

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
          {
            // 🔒 V7 Audit M1: Permissions-Policy restricts browser features.
            // camera=self allows the barcode scanner + bill scanner to use the camera.
            // microphone=() blocks all microphone access (not needed).
            // geolocation=() blocks all geolocation access (not needed).
            key: "Permissions-Policy",
            value: "camera=self, microphone=(), geolocation=()",
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
