import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: { ignoreBuildErrors: true },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
}

export default nextConfig
