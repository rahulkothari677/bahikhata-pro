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

  // 🔒 SECURITY (Audit fix N3 + M11 + V9 2.6): Content-Security-Policy header.
  // Now ENFORCED (was report-only). Monitored for 1+ week with no violations.
  //
  // 🔒 V9 2.6: Removed 'unsafe-eval' — was needed by some older libraries
  // but is not required in production Next.js. Keeping 'unsafe-inline' because
  // Next.js injects inline scripts for hydration. Moving to nonce-based CSP
  // would remove the need for 'unsafe-inline' too, but that requires middleware
  // changes and is a larger task.
  //
  // If issues arise after removing 'unsafe-eval', check the browser console
  // for CSP violation reports. If a dependency genuinely needs it, re-add it.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://vercel.live",
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
          {
            // 🔒 AUDIT FIX V5: HSTS — forces HTTPS, prevents SSL stripping
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
