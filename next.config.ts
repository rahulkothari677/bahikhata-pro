import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  // 🔒 AUDIT FIX L3: Enabled reactStrictMode — surfaces effect/concurrency
  // bugs in development (double-invokes effects/renders). Was: false.
  // Only affects development, not production builds.
  reactStrictMode: true,
  // Disable source maps in production — saves ~5MB of transfer on first load.
  // Note: Sentry can still receive source maps if uploaded separately.
  productionBrowserSourceMaps: false,

  // 🔒 SECURITY (Audit fix N3 + M11): Content-Security-Policy header.
  // Now ENFORCED (was report-only). Monitored for 1+ week with no violations.
  // If issues arise, temporarily switch back to "Content-Security-Policy-Report-Only".
  //
  // What this policy allows:
  // - Scripts: only from self, Vercel, and inline (Next.js needs inline scripts)
  // - Styles: self, inline (Tailwind/CSS modules need inline styles)
  // - Images: self, data: (base64), blob: (camera), and common CDN domains
  // - Fonts: self and Google Fonts CDN
  // - API calls: self (same-origin API routes)
  // - WebSocket: self (for HMR in dev, real-time features)
  // - Frame-ancestors: 'none' (prevents clickjacking — no iframes allowed)
  //
  // If you add a third-party service (e.g., a CDN, analytics), add its domain
  // to the relevant directive below.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: blob: https: https://*.cloudinary.com https://res.cloudinary.com",
              "media-src 'self' blob:",
              "connect-src 'self' https://*.sentry.io https://*.posthog.com https://vitals.vercel-insights.com https://api.groq.com https://generativelanguage.googleapis.com https://api.openai.com",
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
            key: "X-DNS-Prefetch-Control",
            value: "on",
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
