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

  // 🔒 V20-024: CSP moved to middleware (src/middleware.ts) for nonce-based
  // enforcement. The middleware generates a per-request nonce and sets the
  // CSP header with 'nonce-XXX' instead of 'unsafe-inline'.
  //
  // Security headers (HSTS, X-Frame-Options, etc.) also moved to middleware
  // so they're set on every response including API routes.
  //
  // Previous: CSP was in next.config.ts as Content-Security-Policy-Report-Only
  // with 'unsafe-inline'. Now: ENFORCED in middleware with nonce + strict-dynamic.
}

export default nextConfig
