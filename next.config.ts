import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Disable source maps in production — saves ~5MB of transfer on first load.
  // Source maps are only useful during development; users don't need them.
  productionBrowserSourceMaps: false,

  // Performance: tree-shake large icon/component libraries so only the icons
  // actually used are included in the bundle (instead of all 1,000+ lucide icons).
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-toast",
      "@radix-ui/react-switch",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-radio-group",
      "@radix-ui/react-avatar",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-separator",
      "@radix-ui/react-label",
      "@radix-ui/react-progress",
      "@radix-ui/react-slot",
      "recharts",
    ],
  },
};

export default nextConfig;
