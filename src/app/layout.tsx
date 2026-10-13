import type { Metadata, Viewport } from "next";
import { Noto_Sans, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
/*
 * Business-card monogram typefaces. Imported HERE, not with an `@import` inside
 * globals.css: Turbopack's Tailwind pipeline silently dropped that import — the
 * emitted stylesheet contained none of the eleven @font-face rules, and because
 * a missing webfont just falls back to serif, every card still rendered. It was
 * only caught by measuring text widths against the fallback, which came out
 * identical to the pixel. A JS-side import cannot be dropped that quietly.
 */
import "./card-fonts.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/common/OfflineBanner";
import { ImpersonationBanner } from "@/components/common/ImpersonationBanner";
// 🔒 V20-007: Lazy-load analytics SDKs to reduce initial JS bundle.
// These SDKs only report metrics AFTER the page loads, so they don't
// need to be in the critical path. Using dynamic without ssr:false
// (layout.tsx is a Server Component).
import dynamic from "next/dynamic";
const Analytics = dynamic(() => import("@vercel/analytics/react").then(m => ({ default: m.Analytics })))
const SpeedInsights = dynamic(() => import("@vercel/speed-insights/next").then(m => ({ default: m.SpeedInsights })))

// 🔒 Phase 4d (Oct 2026): Noto Sans + Noto Sans Devanagari, set slightly
// narrow (font-stretch 87.5% in globals.css). Measured on 13 Oct against 12
// Hindi+English fonts: small letters 15% taller than Mukta (0.54 vs 0.47 of
// the size) while lines stay as long (+3% English, -1% Hindi), so text reads
// bigger and cards keep their size. Mukta (4a) made 12px look like ~10.4px.
// Both are variable fonts: weight and width come from one file each.
const notoSans = Noto_Sans({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-noto",
  display: "swap",
});
const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  axes: ["wdth"],
  variable: "--font-noto-dev",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EkBook — India's Smartest Ledger App",
  description: "Complete ledger, inventory, GST & AI bill scanner for Indian shop owners.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "EkBook",
  },
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
}

export const viewport: Viewport = {
  themeColor: "#c2410c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // viewportFit=cover enables safe-area-inset CSS env() variables
  // so the bottom nav isn't hidden behind iPhone home indicator or Android gesture bar
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${notoSans.variable} ${notoDevanagari.variable}`}>
      <body className="antialiased bg-background text-foreground font-sans">
        <ErrorBoundary>
          <OfflineBanner />
          <Providers>
            {/* 🐛 INTEGRATION PHASE D.3: Impersonation banner — shown when
                the current session was created via /api/impersonate.
                Rendered INSIDE Providers so useSession() works. Placed
                above children so it's the topmost element on every screen. */}
            <ImpersonationBanner />
            {children}
          </Providers>
        </ErrorBoundary>
        <Toaster />
        {/* 🔒 Phase 8a: Toasts positioned top-center on mobile (so keyboard
            doesn't cover them), top-right on desktop (standard position).
            Was: top-right everywhere → on mobile, toasts were hidden behind
            the keyboard when filling amount fields. */}
        <SonnerToaster
          position="top-center"
          /* Toasts land at the top on mobile, which on Android is behind the
             status bar. --safe-top is 0 everywhere else, so this is a no-op
             on desktop and in a browser. */
          offset="calc(1rem + var(--safe-top))"
          richColors
          closeButton
          toastOptions={{
            className: 'lg:!left-auto lg:!right-4 lg:!transform-none',
          }}
        />
        {/* Vercel Analytics — privacy-friendly, no cookies, GDPR compliant */}
        <Analytics />
        {/* Vercel Speed Insights — measures Core Web Vitals, helps us optimize */}
        <SpeedInsights />
      </body>
    </html>
  );
}
