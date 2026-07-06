import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

// 🔒 V9 1.7a: Reduced to one font (was: Inter + Plus Jakarta Sans).
// Plus Jakarta Sans was used for headings via --font-heading. Now --font-heading
// falls back to Inter (set in globals.css). Saves one font request on first load.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
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
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="antialiased bg-background text-foreground font-sans">
        <ErrorBoundary>
          <Providers>
            {children}
          </Providers>
        </ErrorBoundary>
        <Toaster />
        <SonnerToaster position="top-right" richColors closeButton />
        {/* Vercel Analytics — privacy-friendly, no cookies, GDPR compliant */}
        <Analytics />
        {/* Vercel Speed Insights — measures Core Web Vitals, helps us optimize */}
        <SpeedInsights />
      </body>
    </html>
  );
}
