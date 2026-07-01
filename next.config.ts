import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Disable source maps in production — saves ~5MB of transfer on first load.
  // Note: Sentry can still receive source maps if uploaded separately.
  productionBrowserSourceMaps: false,

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
